#ifndef TINYVM_SANDBOX_H
#define TINYVM_SANDBOX_H

/*
 * Applies process-level restrictions to the session process.
 *
 * Must be called once, before the VM is created. Restrictions are applied
 * "fail closed": if any of them cannot be set, a message is written to stderr
 * and a non-zero value is returned, so the caller must not continue.
 *
 * Applied restrictions:
 *   - PR_SET_NO_NEW_PRIVS (Linux): the process can never gain privileges.
 *   - RLIMIT_CORE = 0: no core dumps.
 *   - RLIMIT_NOFILE = 64: no descriptor exhaustion.
 *   - RLIMIT_CPU: CPU-time limit in seconds, default 120.
 *     Override with TINYVM_CPU_LIMIT_S (1..3600).
 *   - RLIMIT_AS: address-space limit, disabled by default.
 *     Enable with TINYVM_MEMORY_LIMIT_MB (64..65536). Unicorn reserves a lot
 *     of virtual memory, so choose a generous value and verify it.
 *
 * Limits are only ever lowered; an already stricter limit is kept.
 */
int sandbox_apply(void);

#endif
