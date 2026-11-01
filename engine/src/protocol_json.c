#include "protocol_json.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

/* ------------------------------------------------------------------ */
/* Request parsing                                                     */
/* ------------------------------------------------------------------ */

json_object *protocol_parse_request(const char *line)
{
    size_t length = strlen(line);

    if (length == 0 || length > PROTOCOL_MAX_LINE_SIZE) {
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

/* ------------------------------------------------------------------ */
/* Argument helpers                                                    */
/* ------------------------------------------------------------------ */

int protocol_get_string(
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

int protocol_parse_u64(const char *text, uint64_t *value)
{
    unsigned int base = 10;

    if (text == NULL) {
        return 1;
    }

    if (text[0] == '0' && (text[1] == 'x' || text[1] == 'X')) {
        base = 16;
        text += 2;
    }

    if (*text == '\0') {
        return 1;
    }

    uint64_t result = 0;

    for (; *text != '\0'; text++) {
        int digit = hex_digit(*text);

        if (digit < 0 || (unsigned int)digit >= base) {
            return 1;
        }

        if (result > (UINT64_MAX - (uint64_t)digit) / base) {
            return 1;
        }

        result = result * base + (uint64_t)digit;
    }

    *value = result;

    return 0;
}

int protocol_get_u64(
    json_object *request,
    const char *key,
    uint64_t *value
)
{
    const char *text = NULL;

    if (protocol_get_string(request, key, &text) != 0) {
        return 1;
    }

    return protocol_parse_u64(text, value);
}

int protocol_get_disassembly_limit(json_object *request, size_t *maximum)
{
    json_object *field = NULL;

    *maximum = DISASM_MAX_INSTRUCTIONS;

    if (!json_object_object_get_ex(request, "max_instructions", &field)) {
        return 0;
    }

    if (!json_object_is_type(field, json_type_int)) {
        return 1;
    }

    int64_t requested = json_object_get_int64(field);

    if (requested <= 0 || requested > DISASM_MAX_INSTRUCTIONS) {
        return 1;
    }

    *maximum = (size_t)requested;

    return 0;
}

/* ------------------------------------------------------------------ */
/* Hexadecimal conversion                                              */
/* ------------------------------------------------------------------ */

int protocol_decode_hex(
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

char *protocol_encode_hex(const uint8_t *buffer, size_t size)
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

/* ------------------------------------------------------------------ */
/* Response construction                                               */
/* ------------------------------------------------------------------ */

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

json_object *protocol_make_response(TinyVM *vm, const char *error)
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

json_object *protocol_make_error(const char *error)
{
    json_object *response = json_object_new_object();

    if (response == NULL) {
        return NULL;
    }

    json_object_object_add(
        response, "status", json_object_new_string("error")
    );

    json_object_object_add(
        response, "instruction_count", json_object_new_int64(0)
    );

    json_object_object_add(
        response, "error", json_object_new_string(error)
    );

    json_object_object_add(
        response, "registers", json_object_new_null()
    );

    return response;
}

const char *protocol_execution_error(const TinyVM *vm)
{
    if (vm->status == VM_STATUS_LIMIT_EXCEEDED) {
        return "instruction_limit_exceeded";
    }

    if (vm->status == VM_STATUS_ERROR) {
        return "execution_failed";
    }

    return NULL;
}

json_object *protocol_disassembly_to_json(const DisasmResult *result)
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

        bytes = protocol_encode_hex(source->bytes, source->size);

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

void protocol_send_response(json_object *response)
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
