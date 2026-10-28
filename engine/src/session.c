#define _POSIX_C_SOURCE 200809L

#include "vm.h"
#include "disasm.h"

#include <errno.h>
#include <inttypes.h>
#include <json-c/json.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_LINE_SIZE 262144
#define MAX_CODE_SIZE 4096
#define MAX_MEMORY_READ 4096
#define MAX_MEMORY_INPUT 65536

#define DEFAULT_IDLE_TIMEOUT_MS 60000
#define MIN_IDLE_TIMEOUT_MS 1000
#define MAX_IDLE_TIMEOUT_MS 300000

static void add_hex(json_object *object, const char *name, uint64_t value)
{
    char buffer[32];

    snprintf(buffer, sizeof(buffer), "0x%016" PRIx64, value);

    json_object_object_add(
        object,
        name,
        json_object_new_string(buffer)
    );
}

static json_object *registers_to_json(const VMRegisters *r)
{
    json_object *object = json_object_new_object();

    if (object == NULL) {
        return NULL;
    }

    add_hex(object, "rax", r->rax);
    add_hex(object, "rbx", r->rbx);
    add_hex(object, "rcx", r->rcx);
    add_hex(object, "rdx", r->rdx);
    add_hex(object, "rsi", r->rsi);
    add_hex(object, "rdi", r->rdi);
    add_hex(object, "rbp", r->rbp);
    add_hex(object, "rsp", r->rsp);
    add_hex(object, "r8", r->r8);
    add_hex(object, "r9", r->r9);
    add_hex(object, "r10", r->r10);
    add_hex(object, "r11", r->r11);
    add_hex(object, "r12", r->r12);
    add_hex(object, "r13", r->r13);
    add_hex(object, "r14", r->r14);
    add_hex(object, "r15", r->r15);
    add_hex(object, "rip", r->rip);
    add_hex(object, "rflags", r->rflags);

    return object;
}

static json_object *make_response(TinyVM *vm, const char *error)
{
    json_object *response = json_object_new_object();
    VMRegisters registers = {0};

    if (response == NULL) {
        return NULL;
    }

    json_object_object_add(
        response,
        "status",
        json_object_new_string(vm_status_string(vm->status))
    );

    json_object_object_add(
        response,
        "instruction_count",
        json_object_new_int64((int64_t)vm->instruction_count)
    );

    json_object_object_add(
        response,
        "error",
        error == NULL
            ? json_object_new_null()
            : json_object_new_string(error)
    );

    if (vm_get_registers(vm, &registers) == 0) {
        json_object *register_object = registers_to_json(&registers);

        if (register_object == NULL) {
            json_object_put(response);
            return NULL;
        }

        json_object_object_add(
            response,
            "registers",
            register_object
        );
    } else {
        json_object_object_add(
            response,
            "registers",
            json_object_new_null()
        );
    }

    return response;
}

static int get_string(
    json_object *request,
    const char *key,
    const char **value
)
{
    json_object *field = NULL;

    if (!json_object_object_get_ex(request, key, &field) ||
        !json_object_is_type(field, json_type_string)) {
        return 1;
    }

    *value = json_object_get_string(field);

    return *value == NULL ? 1 : 0;
}

static int parse_u64(const char *text, uint64_t *value)
{
    if (text == NULL || *text == '\0' ||
        *text == '-' || *text == '+' ||
        *text == ' ' || *text == '\t') {
        return 1;
    }

    errno = 0;

    char *end = NULL;
    unsigned long long parsed = strtoull(text, &end, 0);

    if (errno != 0 || end == text || *end != '\0') {
        return 1;
    }

    *value = (uint64_t)parsed;

    return 0;
}

static int get_u64(
    json_object *request,
    const char *key,
    uint64_t *value
)
{
    const char *text = NULL;

    if (get_string(request, key, &text) != 0) {
        return 1;
    }

    return parse_u64(text, value);
}

static int hex_digit(char character)
{
    if (character >= '0' && character <= '9') {
        return character - '0';
    }

    if (character >= 'a' && character <= 'f') {
        return character - 'a' + 10;
    }

    if (character >= 'A' && character <= 'F') {
        return character - 'A' + 10;
    }

    return -1;
}

static int decode_hex(
    const char *text,
    uint8_t **buffer,
    size_t *size,
    size_t maximum
)
{
    size_t length = strlen(text);

    if (length == 0 ||
        length % 2 != 0 ||
        length / 2 > maximum) {
        return 1;
    }

    *size = length / 2;
    *buffer = malloc(*size);

    if (*buffer == NULL) {
        *size = 0;
        return 1;
    }

    for (size_t i = 0; i < *size; i++) {
        int high = hex_digit(text[i * 2]);
        int low = hex_digit(text[i * 2 + 1]);

        if (high < 0 || low < 0) {
            free(*buffer);
            *buffer = NULL;
            *size = 0;
            return 1;
        }

        (*buffer)[i] = (uint8_t)((high << 4) | low);
    }

    return 0;
}

static char *encode_hex(const uint8_t *buffer, size_t size)
{
    static const char digits[] = "0123456789abcdef";

    char *text = malloc(size * 2 + 1);

    if (text == NULL) {
        return NULL;
    }

    for (size_t i = 0; i < size; i++) {
        text[i * 2] = digits[buffer[i] >> 4];
        text[i * 2 + 1] = digits[buffer[i] & 15];
    }

    text[size * 2] = '\0';

    return text;
}

static int register_id(const char *name)
{
    static const struct {
        const char *name;
        int id;
    } registers[] = {
        {"rax", UC_X86_REG_RAX},
        {"rbx", UC_X86_REG_RBX},
        {"rcx", UC_X86_REG_RCX},
        {"rdx", UC_X86_REG_RDX},
        {"rsi", UC_X86_REG_RSI},
        {"rdi", UC_X86_REG_RDI},
        {"rbp", UC_X86_REG_RBP},
        {"r8", UC_X86_REG_R8},
        {"r9", UC_X86_REG_R9},
        {"r10", UC_X86_REG_R10},
        {"r11", UC_X86_REG_R11},
        {"r12", UC_X86_REG_R12},
        {"r13", UC_X86_REG_R13},
        {"r14", UC_X86_REG_R14},
        {"r15", UC_X86_REG_R15}
    };

    for (size_t i = 0; i < sizeof(registers) / sizeof(registers[0]); i++) {
        if (strcmp(name, registers[i].name) == 0) {
            return registers[i].id;
        }
    }

    return UC_X86_REG_INVALID;
}

static const char *execution_error(const TinyVM *vm)
{
    if (vm->status == VM_STATUS_LIMIT_EXCEEDED) {
        return "instruction_limit_exceeded";
    }

    if (vm->status == VM_STATUS_ERROR) {
        return "execution_failed";
    }

    return NULL;
}

static json_object *disassembly_to_json(const DisasmResult *result)
{
    json_object *response = json_object_new_object();
    json_object *instructions = json_object_new_array();

    if (response == NULL || instructions == NULL) {
        if (response != NULL) {
            json_object_put(response);
        }

        if (instructions != NULL) {
            json_object_put(instructions);
        }

        return NULL;
    }

    add_hex(response, "code_address", result->code_address);
    add_hex(response, "code_end", result->code_end);
    add_hex(response, "rip", result->rip);

    json_object_object_add(
        response,
        "current_found",
        json_object_new_boolean(result->current_found)
    );

    json_object_object_add(
        response,
        "complete",
        json_object_new_boolean(result->complete)
    );

    for (size_t i = 0; i < result->count; i++) {
        const DisasmInstruction *source = &result->instructions[i];
        json_object *instruction = json_object_new_object();
        char *bytes = NULL;

        if (instruction == NULL) {
            json_object_put(instructions);
            json_object_put(response);
            return NULL;
        }

        bytes = encode_hex(source->bytes, source->size);

        if (bytes == NULL) {
            json_object_put(instruction);
            json_object_put(instructions);
            json_object_put(response);
            return NULL;
        }

        add_hex(instruction, "address", source->address);

        json_object_object_add(
            instruction,
            "size",
            json_object_new_int(source->size)
        );

        json_object_object_add(
            instruction,
            "bytes",
            json_object_new_string(bytes)
        );

        json_object_object_add(
            instruction,
            "mnemonic",
            json_object_new_string(source->mnemonic)
        );

        json_object_object_add(
            instruction,
            "operands",
            json_object_new_string(source->operands)
        );

        json_object_object_add(
            instruction,
            "is_current",
            json_object_new_boolean(source->is_current)
        );

        free(bytes);

        if (json_object_array_add(instructions, instruction) != 0) {
            json_object_put(instruction);
            json_object_put(instructions);
            json_object_put(response);
            return NULL;
        }
    }

    json_object_object_add(response, "instructions", instructions);

    return response;
}

static json_object *process_disassemble(
    TinyVM *vm,
    json_object *request
)
{
    size_t maximum = DISASM_MAX_INSTRUCTIONS;
    json_object *field = NULL;
    DisasmResult result = {0};

    if (json_object_object_get_ex(
            request,
            "max_instructions",
            &field
        )) {
        if (!json_object_is_type(field, json_type_int)) {
            return make_response(vm, "invalid_disassembly_arguments");
        }

        int64_t requested = json_object_get_int64(field);

        if (requested <= 0 || requested > DISASM_MAX_INSTRUCTIONS) {
            return make_response(vm, "invalid_disassembly_arguments");
        }

        maximum = (size_t)requested;
    }

    if (disasm_decode(vm, maximum, &result) != 0) {
        disasm_result_destroy(&result);
        return make_response(vm, "disassembly_failed");
    }

    json_object *disassembly = disassembly_to_json(&result);
    disasm_result_destroy(&result);

    if (disassembly == NULL) {
        return make_response(vm, "allocation_failed");
    }

    json_object *response = make_response(vm, NULL);

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

    if (get_string(request, "command", &command) != 0) {
        return make_response(vm, "invalid_command");
    }

    if (strcmp(command, "state") == 0) {
        return make_response(vm, NULL);
    }

    if (strcmp(command, "close") == 0) {
        *closed = 1;
        return make_response(vm, NULL);
    }

    if (strcmp(command, "disassemble") == 0) {
        return process_disassemble(vm, request);
    }

    if (strcmp(command, "load") == 0) {
        const char *hex = NULL;
        uint8_t *code = NULL;
        size_t size = 0;

        if (get_string(request, "code", &hex) != 0 ||
            decode_hex(hex, &code, &size, MAX_CODE_SIZE) != 0) {
            return make_response(vm, "invalid_code");
        }

        int result = vm_load_code(vm, code, size);
        free(code);

        return make_response(
            vm,
            result == 0 ? NULL : "load_failed"
        );
    }

    if (strcmp(command, "set_register") == 0) {
        const char *name = NULL;
        uint64_t value = 0;

        if (get_string(request, "register", &name) != 0 ||
            get_u64(request, "value", &value) != 0) {
            return make_response(vm, "invalid_register_arguments");
        }

        int id = register_id(name);

        if (id == UC_X86_REG_INVALID ||
            vm_set_register(vm, id, value) != 0) {
            return make_response(vm, "register_write_failed");
        }

        return make_response(vm, NULL);
    }

    if (strcmp(command, "initialize_memory") == 0) {
        const char *hex = NULL;
        uint64_t address = 0;
        uint8_t *buffer = NULL;
        size_t size = 0;

        if (get_u64(request, "address", &address) != 0 ||
            get_string(request, "data", &hex) != 0 ||
            decode_hex(hex, &buffer, &size, MAX_MEMORY_INPUT) != 0) {
            return make_response(vm, "invalid_memory_arguments");
        }

        int result = vm_initialize_memory(vm, address, buffer, size);
        free(buffer);

        return make_response(
            vm,
            result == 0 ? NULL : "memory_initialization_failed"
        );
    }

    if (strcmp(command, "step") == 0) {
        if (vm->status == VM_STATUS_FINISHED) {
            return make_response(vm, "session_finished");
        }

        if (vm->status == VM_STATUS_LIMIT_EXCEEDED ||
            vm->status == VM_STATUS_ERROR) {
            return make_response(vm, execution_error(vm));
        }

        int result = vm_step(vm);

        if (result == 0 || vm->status == VM_STATUS_FINISHED) {
            return make_response(vm, NULL);
        }

        if (vm->status == VM_STATUS_LIMIT_EXCEEDED) {
            return make_response(vm, "instruction_limit_exceeded");
        }

        return make_response(vm, "step_failed");
    }

    if (strcmp(command, "run") == 0) {
        if (vm->status == VM_STATUS_FINISHED) {
            return make_response(vm, NULL);
        }

        if (vm_run(vm) == 0) {
            return make_response(vm, NULL);
        }

        if (vm->status == VM_STATUS_LIMIT_EXCEEDED) {
            return make_response(vm, "instruction_limit_exceeded");
        }

        return make_response(vm, "execution_failed");
    }

    if (strcmp(command, "read_memory") == 0) {
        uint64_t address = 0;
        uint64_t requested_size = 0;

        if (get_u64(request, "address", &address) != 0 ||
            get_u64(request, "size", &requested_size) != 0 ||
            requested_size == 0 ||
            requested_size > MAX_MEMORY_READ) {
            return make_response(vm, "invalid_memory_arguments");
        }

        size_t size = (size_t)requested_size;
        uint8_t *buffer = malloc(size);

        if (buffer == NULL) {
            return make_response(vm, "allocation_failed");
        }

        if (vm_read_memory(vm, address, buffer, size) != 0) {
            free(buffer);
            return make_response(vm, "memory_read_failed");
        }

        char *hex = encode_hex(buffer, size);
        free(buffer);

        if (hex == NULL) {
            return make_response(vm, "allocation_failed");
        }

        json_object *response = make_response(vm, NULL);

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

    return make_response(vm, "unknown_command");
}

static void send_response(json_object *response)
{
    if (response == NULL) {
        puts("{\"status\":\"error\",\"instruction_count\":0,"
             "\"registers\":null,\"error\":\"allocation_failed\"}");
        fflush(stdout);
        return;
    }

    const char *text = json_object_to_json_string_ext(
        response,
        JSON_C_TO_STRING_PLAIN
    );

    puts(text);
    fflush(stdout);

    json_object_put(response);
}

static int get_idle_timeout(void)
{
    const char *text = getenv("TINYVM_IDLE_TIMEOUT_MS");
    uint64_t value = 0;

    if (text == NULL || parse_u64(text, &value) != 0 ||
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

static json_object *parse_request(const char *line)
{
    size_t length = strlen(line);

    if (length == 0 || length > MAX_LINE_SIZE) {
        return NULL;
    }

    json_tokener *tokener = json_tokener_new();

    if (tokener == NULL) {
        return NULL;
    }

    json_tokener_set_flags(tokener, JSON_TOKENER_STRICT);

    json_object *request = json_tokener_parse_ex(
        tokener,
        line,
        (int)length
    );

    enum json_tokener_error error = json_tokener_get_error(tokener);

    if (error != json_tokener_success ||
        request == NULL ||
        !json_object_is_type(request, json_type_object)) {
        if (request != NULL) {
            json_object_put(request);
        }

        json_tokener_free(tokener);
        return NULL;
    }

    json_tokener_free(tokener);

    return request;
}

int main(void)
{
    TinyVM vm = {0};

    if (vm_create(&vm) != 0) {
        return 1;
    }

    char *line = malloc(MAX_LINE_SIZE + 1);

    if (line == NULL) {
        vm_destroy(&vm);
        return 1;
    }

    int timeout_ms = get_idle_timeout();
    int closed = 0;

    while (!closed) {
        int result = read_request_line(
            line,
            MAX_LINE_SIZE + 1,
            timeout_ms
        );

        if (result == 0) {
            break;
        }

        if (result == -2) {
            send_response(make_response(&vm, "session_timeout"));
            break;
        }

        if (result == -4) {
            send_response(make_response(&vm, "request_too_large"));
            continue;
        }

        if (result == -3) {
            send_response(make_response(&vm, "incomplete_request"));
            break;
        }

        if (result < 0) {
            break;
        }

        json_object *request = parse_request(line);

        if (request == NULL) {
            send_response(make_response(&vm, "invalid_json"));
            continue;
        }

        json_object *response = process_command(
            &vm,
            request,
            &closed
        );

        send_response(response);
        json_object_put(request);
    }

    free(line);
    vm_destroy(&vm);

    return 0;
}
