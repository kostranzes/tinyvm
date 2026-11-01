#define _POSIX_C_SOURCE 200809L

#include "sandbox.h"

#include "protocol_json.h"

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

#ifdef __linux__
#include <sys/prctl.h>
#endif

#define DEFAULT_CPU_LIMIT_SECONDS 120
#define MIN_CPU_LIMIT_SECONDS 1
#define MAX_CPU_LIMIT_SECONDS 3600

#define MIN_MEMORY_LIMIT_MB 64
#define MAX_MEMORY_LIMIT_MB 65536

#define OPEN_FILE_LIMIT 64

/*
 * Reads an optional numeric environment variable.
 * Returns 0 and stores the value (or `fallback` if unset), or 1 if the
 * variable is set to something invalid.
 */
static int read_environment_limit(
    const char *name,
    uint64_t minimum,
    uint64_t maximum,
    uint64_t fallback,
    uint64_t *value
)
{
    const char *text = getenv(name);

    if (text == NULL) {
        *value = fallback;
        return 0;
    }

    if (protocol_parse_u64(text, value) != 0 ||
        *value < minimum ||
        *value > maximum) {
        fprintf(
            stderr,
            "Invalid %s: expected an integer from %llu through %llu\n",
            name,
            (unsigned long long)minimum,
            (unsigned long long)maximum
        );
        return 1;
    }

    return 0;
}

static int lower_limit(int resource, const char *name, rlim_t wanted)
{
    struct rlimit current;

    if (getrlimit(resource, &current) != 0) {
        fprintf(stderr, "Cannot read %s limit: %s\n", name, strerror(errno));
        return 1;
    }

    /* RLIM_INFINITY is the largest value, so a plain comparison is enough. */
    rlim_t maximum = current.rlim_max < wanted ? current.rlim_max : wanted;
    rlim_t soft = current.rlim_cur < maximum ? current.rlim_cur : maximum;

    struct rlimit limit = {
        .rlim_cur = soft,
        .rlim_max = maximum
    };

    if (setrlimit(resource, &limit) != 0) {
        fprintf(stderr, "Cannot set %s limit: %s\n", name, strerror(errno));
        return 1;
    }

    return 0;
}

int sandbox_apply(void)
{
    uint64_t cpu_seconds = 0;
    uint64_t memory_mb = 0;

    if (read_environment_limit(
            "TINYVM_CPU_LIMIT_S",
            MIN_CPU_LIMIT_SECONDS,
            MAX_CPU_LIMIT_SECONDS,
            DEFAULT_CPU_LIMIT_SECONDS,
            &cpu_seconds
        ) != 0) {
        return 1;
    }

    /* A fallback of 0 means "no address-space limit". */
    int memory_limited = getenv("TINYVM_MEMORY_LIMIT_MB") != NULL;

    if (memory_limited &&
        read_environment_limit(
            "TINYVM_MEMORY_LIMIT_MB",
            MIN_MEMORY_LIMIT_MB,
            MAX_MEMORY_LIMIT_MB,
            0,
            &memory_mb
        ) != 0) {
        return 1;
    }

#ifdef __linux__
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        fprintf(stderr, "Cannot set no_new_privs: %s\n", strerror(errno));
        return 1;
    }
#endif

    if (lower_limit(RLIMIT_CORE, "core size", 0) != 0 ||
        lower_limit(RLIMIT_NOFILE, "open files", OPEN_FILE_LIMIT) != 0 ||
        lower_limit(
            RLIMIT_CPU, "CPU time", (rlim_t)cpu_seconds
        ) != 0) {
        return 1;
    }

    if (memory_limited &&
        lower_limit(
            RLIMIT_AS,
            "address space",
            (rlim_t)memory_mb * 1024 * 1024
        ) != 0) {
        return 1;
    }

    return 0;
}
