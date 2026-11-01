#ifndef TINYVM_PROTOCOL_JSON_H
#define TINYVM_PROTOCOL_JSON_H

#include "disasm.h"
#include "vm.h"

#include <json-c/json.h>
#include <stddef.h>
#include <stdint.h>

/* Protocol limits (see PROTOCOL.md, section 6). */
#define PROTOCOL_MAX_LINE_SIZE    262144
#define PROTOCOL_MAX_CODE_SIZE    VM_CODE_SIZE
#define PROTOCOL_MAX_MEMORY_READ  4096
#define PROTOCOL_MAX_MEMORY_INPUT 65536

/*
 * Request parsing.
 *
 * protocol_parse_request() returns a new JSON object (caller releases it with
 * json_object_put) or NULL if the line is not a single valid JSON object.
 */
json_object *protocol_parse_request(const char *line);

/*
 * Argument helpers. All return 0 on success and 1 on invalid input.
 */
int protocol_get_string(json_object *request, const char *key,
                        const char **value);
int protocol_get_u64(json_object *request, const char *key, uint64_t *value);
int protocol_parse_u64(const char *text, uint64_t *value);

/* Optional "max_instructions" argument of the disassemble command. */
int protocol_get_disassembly_limit(json_object *request, size_t *maximum);

/* Hexadecimal conversion. */
int protocol_decode_hex(const char *text, uint8_t **buffer, size_t *size,
                        size_t maximum);
char *protocol_encode_hex(const uint8_t *buffer, size_t size);

/*
 * Response construction.
 *
 * Every response contains: status, instruction_count, registers, error.
 * Functions return a new object (or NULL on allocation failure).
 */
json_object *protocol_make_response(TinyVM *vm, const char *error);

/* Response for failures that happen before a VM exists (status "error"). */
json_object *protocol_make_error(const char *error);

/*
 * Error code describing the terminal VM state: "instruction_limit_exceeded"
 * or "execution_failed". Returns NULL for every other status.
 */
const char *protocol_execution_error(const TinyVM *vm);
json_object *protocol_disassembly_to_json(const DisasmResult *result);

/* Writes one response line to stdout and releases the object. */
void protocol_send_response(json_object *response);

#endif
