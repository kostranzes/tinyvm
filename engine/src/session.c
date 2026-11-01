#define _POSIX_C_SOURCE 200809L

#include "disasm.h"
#include "protocol_json.h"
#include "vm.h"

#include <errno.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define DEFAULT_IDLE_TIMEOUT_MS 60000
#define MIN_IDLE_TIMEOUT_MS 1000
#define MAX_IDLE_TIMEOUT_MS 300000

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

static int read_request_line(
    char *line,
    size_t capacity,
    int timeout_ms
)
{
    size_t length = 0;
    int oversized = 0;

    while (1) {
        struct pollfd input = {
            .fd = STDIN_FILENO,
            .events = POLLIN
        };

        int ready = poll(&input, 1, timeout_ms);

        if (ready < 0) {
            if (errno == EINTR) {
                continue;
            }

            return -1;
        }

        if (ready == 0) {
            return -2;
        }

        char character;
        ssize_t count = read(STDIN_FILENO, &character, 1);

        if (count == 0) {
            return length == 0 ? 0 : -3;
        }

        if (count < 0) {
            if (errno == EINTR) {
                continue;
            }

            return -1;
        }

        if (character == '\n') {
            if (oversized) {
                return -4;
            }

            line[length] = '\0';
            return 1;
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

int main(void)
{
    TinyVM vm = {0};

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
        int result = read_request_line(
            line,
            PROTOCOL_MAX_LINE_SIZE + 1,
            timeout_ms
        );

        if (result == 0) {
            break;
        }

        if (result == -2) {
            protocol_send_response(
                protocol_make_response(&vm, "session_timeout")
            );
            break;
        }

        if (result == -4) {
            protocol_send_response(
                protocol_make_response(&vm, "request_too_large")
            );
            continue;
        }

        if (result == -3) {
            protocol_send_response(
                protocol_make_response(&vm, "incomplete_request")
            );
            break;
        }

        if (result < 0) {
            break;
        }

        json_object *request = protocol_parse_request(line);

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
