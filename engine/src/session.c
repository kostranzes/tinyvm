#define _POSIX_C_SOURCE 200809L

#include "disasm.h"
#include "protocol_json.h"
#include "sandbox.h"
#include "vm.h"

#include <errno.h>
#include <limits.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define DEFAULT_IDLE_TIMEOUT_MS 60000
#define MIN_IDLE_TIMEOUT_MS 1000
#define MAX_IDLE_TIMEOUT_MS 300000

#define INPUT_BUFFER_SIZE 65536

/* ------------------------------------------------------------------ */
/* Command execution                                                   */
/* ------------------------------------------------------------------ */

static json_object *process_disassemble(
    TinyVM *vm,
    json_object *request
)
{
    size_t maximum = 0;
    DisasmResult result = {0};

    if (protocol_get_disassembly_limit(request, &maximum) != 0) {
        return protocol_make_response(vm, "invalid_disassembly_arguments");
    }

    if (disasm_decode(vm, maximum, &result) != 0) {
        disasm_result_destroy(&result);
        return protocol_make_response(vm, "disassembly_failed");
    }

    json_object *disassembly = protocol_disassembly_to_json(&result);
    disasm_result_destroy(&result);

    if (disassembly == NULL) {
        return protocol_make_response(vm, "allocation_failed");
    }

    json_object *response = protocol_make_response(vm, NULL);

    if (response == NULL) {
        json_object_put(disassembly);
        return NULL;
    }

    json_object_object_add(response, "disassembly", disassembly);

    return response;
}

static json_object *process_set_instruction_limit(
    TinyVM *vm,
    json_object *request
)
{
    uint64_t limit = 0;

    if (protocol_get_u64(request, "limit", &limit) != 0 ||
        limit == 0 ||
        limit > VM_MAX_INSTRUCTION_LIMIT) {
        return protocol_make_response(vm, "invalid_limit_arguments");
    }

    if (vm_set_instruction_limit(vm, (size_t)limit) != 0) {
        return protocol_make_response(vm, "limit_change_failed");
    }

    json_object *response = protocol_make_response(vm, NULL);

    if (response == NULL) {
        return NULL;
    }

    json_object_object_add(
        response,
        "instruction_limit",
        json_object_new_int64((int64_t)vm->instruction_limit)
    );

    return response;
}

static json_object *process_command(
    TinyVM *vm,
    json_object *request,
    int *closed
)
{
    const char *command = NULL;

    if (protocol_get_string(request, "command", &command) != 0) {
        return protocol_make_response(vm, "invalid_command");
    }

    if (strcmp(command, "state") == 0) {
        return protocol_make_response(vm, NULL);
    }

    if (strcmp(command, "close") == 0) {
        *closed = 1;
        return protocol_make_response(vm, NULL);
    }

    if (strcmp(command, "disassemble") == 0) {
        if (!vm_has_loaded_code(vm)) {
            return protocol_make_response(vm, "program_not_loaded");
        }

        return process_disassemble(vm, request);
    }

    if (strcmp(command, "load") == 0) {
        const char *hex = NULL;
        uint8_t *code = NULL;
        size_t size = 0;

        if (protocol_get_string(request, "code", &hex) != 0 ||
            protocol_decode_hex(
                hex, &code, &size, PROTOCOL_MAX_CODE_SIZE
            ) != 0) {
            return protocol_make_response(vm, "invalid_code");
        }

        int result = vm_load_code(vm, code, size);
        free(code);

        return protocol_make_response(
            vm,
            result == 0 ? NULL : "load_failed"
        );
    }

    if (strcmp(command, "set_instruction_limit") == 0) {
        return process_set_instruction_limit(vm, request);
    }

    if (strcmp(command, "set_register") == 0) {
        const char *name = NULL;
        uint64_t value = 0;

        if (protocol_get_string(request, "register", &name) != 0 ||
            protocol_get_u64(request, "value", &value) != 0) {
            return protocol_make_response(
                vm, "invalid_register_arguments"
            );
        }

        int id = vm_register_from_name(name);

        if (id == UC_X86_REG_INVALID ||
            vm_set_register(vm, id, value) != 0) {
            return protocol_make_response(vm, "register_write_failed");
        }

        return protocol_make_response(vm, NULL);
    }

    if (strcmp(command, "initialize_memory") == 0) {
        const char *hex = NULL;
        uint64_t address = 0;
        uint8_t *buffer = NULL;
        size_t size = 0;

        if (protocol_get_u64(request, "address", &address) != 0 ||
            protocol_get_string(request, "data", &hex) != 0 ||
            protocol_decode_hex(
                hex, &buffer, &size, PROTOCOL_MAX_MEMORY_INPUT
            ) != 0) {
            return protocol_make_response(vm, "invalid_memory_arguments");
        }

        int result = vm_initialize_memory(vm, address, buffer, size);
        free(buffer);

        return protocol_make_response(
            vm,
            result == 0 ? NULL : "memory_initialization_failed"
        );
    }

    if (strcmp(command, "step") == 0) {
        if (!vm_has_loaded_code(vm)) {
            return protocol_make_response(vm, "program_not_loaded");
        }

        if (vm->status == VM_STATUS_FINISHED) {
            return protocol_make_response(vm, "session_finished");
        }

        if (vm->status == VM_STATUS_LIMIT_EXCEEDED ||
            vm->status == VM_STATUS_ERROR) {
            return protocol_make_response(vm, protocol_execution_error(vm));
        }

        int result = vm_step(vm);

        if (result == 0 || vm->status == VM_STATUS_FINISHED) {
            return protocol_make_response(vm, NULL);
        }

        if (vm->status == VM_STATUS_LIMIT_EXCEEDED) {
            return protocol_make_response(
                vm, "instruction_limit_exceeded"
            );
        }

        return protocol_make_response(vm, "step_failed");
    }

    if (strcmp(command, "run") == 0) {
        if (!vm_has_loaded_code(vm)) {
            return protocol_make_response(vm, "program_not_loaded");
        }

        if (vm->status == VM_STATUS_FINISHED) {
            return protocol_make_response(vm, NULL);
        }

        if (vm_run(vm) == 0) {
            return protocol_make_response(vm, NULL);
        }

        if (vm->status == VM_STATUS_LIMIT_EXCEEDED) {
            return protocol_make_response(
                vm, "instruction_limit_exceeded"
            );
        }

        return protocol_make_response(vm, "execution_failed");
    }

    if (strcmp(command, "read_memory") == 0) {
        uint64_t address = 0;
        uint64_t requested_size = 0;

        if (protocol_get_u64(request, "address", &address) != 0 ||
            protocol_get_u64(request, "size", &requested_size) != 0 ||
            requested_size == 0 ||
            requested_size > PROTOCOL_MAX_MEMORY_READ) {
            return protocol_make_response(vm, "invalid_memory_arguments");
        }

        size_t size = (size_t)requested_size;
        uint8_t *buffer = malloc(size);

        if (buffer == NULL) {
            return protocol_make_response(vm, "allocation_failed");
        }

        if (vm_read_memory(vm, address, buffer, size) != 0) {
            free(buffer);
            return protocol_make_response(vm, "memory_read_failed");
        }

        char *hex = protocol_encode_hex(buffer, size);
        free(buffer);

        if (hex == NULL) {
            return protocol_make_response(vm, "allocation_failed");
        }

        json_object *response = protocol_make_response(vm, NULL);

        if (response == NULL) {
            free(hex);
            return NULL;
        }

        json_object_object_add(
            response,
            "data",
            json_object_new_string(hex)
        );

        free(hex);

        return response;
    }

    return protocol_make_response(vm, "unknown_command");
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

typedef enum {
    LINE_EOF = 0,
    LINE_OK = 1,
    LINE_ERROR = -1,
    LINE_TIMEOUT = -2,
    LINE_INCOMPLETE = -3,
    LINE_TOO_LARGE = -4,
    LINE_INVALID = -5
} LineResult;

typedef struct {
    char data[INPUT_BUFFER_SIZE];
    size_t position;
    size_t length;
} InputBuffer;

static InputBuffer input_buffer;

static int get_idle_timeout(void)
{
    const char *text = getenv("TINYVM_IDLE_TIMEOUT_MS");
    uint64_t value = 0;

    if (text == NULL || protocol_parse_u64(text, &value) != 0 ||
        value < MIN_IDLE_TIMEOUT_MS ||
        value > MAX_IDLE_TIMEOUT_MS) {
        return DEFAULT_IDLE_TIMEOUT_MS;
    }

    return (int)value;
}

static int64_t now_ms(void)
{
    struct timespec now;

    clock_gettime(CLOCK_MONOTONIC, &now);

    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

/*
 * Refills the input buffer. Returns LINE_OK when data is available,
 * LINE_EOF at end of input, LINE_TIMEOUT when the deadline passed and
 * LINE_ERROR on I/O failure.
 */
static LineResult fill_input_buffer(InputBuffer *input, int64_t deadline)
{
    while (1) {
        int64_t remaining = deadline - now_ms();

        if (remaining <= 0) {
            return LINE_TIMEOUT;
        }

        struct pollfd descriptor = {
            .fd = STDIN_FILENO,
            .events = POLLIN
        };

        int ready = poll(
            &descriptor,
            1,
            remaining > INT_MAX ? INT_MAX : (int)remaining
        );

        if (ready < 0) {
            if (errno == EINTR) {
                continue;
            }

            return LINE_ERROR;
        }

        if (ready == 0) {
            return LINE_TIMEOUT;
        }

        ssize_t count = read(
            STDIN_FILENO,
            input->data,
            sizeof(input->data)
        );

        if (count == 0) {
            return LINE_EOF;
        }

        if (count < 0) {
            if (errno == EINTR) {
                continue;
            }

            return LINE_ERROR;
        }

        input->position = 0;
        input->length = (size_t)count;

        return LINE_OK;
    }
}

/*
 * Reads one newline-terminated request into `line` (NUL-terminated).
 *
 * The idle timeout is a deadline for the whole line: a client that sends a
 * request slowly, byte by byte, cannot keep the session alive indefinitely.
 */
static LineResult read_request_line(
    InputBuffer *input,
    char *line,
    size_t capacity,
    int timeout_ms
)
{
    size_t length = 0;
    size_t consumed = 0;
    int oversized = 0;
    int contains_nul = 0;
    int64_t deadline = now_ms() + timeout_ms;

    while (1) {
        if (input->position == input->length) {
            LineResult status = fill_input_buffer(input, deadline);

            if (status == LINE_EOF) {
                return consumed == 0 ? LINE_EOF : LINE_INCOMPLETE;
            }

            if (status != LINE_OK) {
                return status;
            }
        }

        char character = input->data[input->position++];

        if (character == '\n') {
            if (oversized) {
                return LINE_TOO_LARGE;
            }

            if (contains_nul) {
                return LINE_INVALID;
            }

            line[length] = '\0';
            return LINE_OK;
        }

        consumed++;

        if (character == '\0') {
            contains_nul = 1;
            continue;
        }

        if (length + 1 >= capacity) {
            oversized = 1;
            continue;
        }

        if (!oversized) {
            line[length++] = character;
        }
    }
}

/* ------------------------------------------------------------------ */
/* Session loop                                                        */
/* ------------------------------------------------------------------ */

int main(void)
{
    TinyVM vm = {0};

    /* Restrict the process before it touches any untrusted input. */
    if (sandbox_apply() != 0) {
        return 1;
    }

    if (vm_create(&vm) != 0) {
        return 1;
    }

    char *line = malloc(PROTOCOL_MAX_LINE_SIZE + 1);

    if (line == NULL) {
        vm_destroy(&vm);
        return 1;
    }

    int timeout_ms = get_idle_timeout();
    int closed = 0;

    while (!closed) {
        LineResult result = read_request_line(
            &input_buffer,
            line,
            PROTOCOL_MAX_LINE_SIZE + 1,
            timeout_ms
        );

        if (result == LINE_EOF || result == LINE_ERROR) {
            break;
        }

        if (result == LINE_TIMEOUT) {
            protocol_send_response(
                protocol_make_response(&vm, "session_timeout")
            );
            break;
        }

        if (result == LINE_INCOMPLETE) {
            protocol_send_response(
                protocol_make_response(&vm, "incomplete_request")
            );
            break;
        }

        if (result == LINE_TOO_LARGE) {
            protocol_send_response(
                protocol_make_response(&vm, "request_too_large")
            );
            continue;
        }

        json_object *request = NULL;

        if (result == LINE_OK) {
            request = protocol_parse_request(line);
        }

        if (request == NULL) {
            protocol_send_response(
                protocol_make_response(&vm, "invalid_json")
            );
            continue;
        }

        json_object *response = process_command(
            &vm,
            request,
            &closed
        );

        protocol_send_response(response);
        json_object_put(request);
    }

    free(line);
    vm_destroy(&vm);

    return 0;
}
