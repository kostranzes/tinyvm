#include "disasm.h"

#include <capstone/capstone.h>
#include <stdlib.h>
#include <string.h>

static void copy_text(char *destination, size_t capacity, const char *source)
{
    if (capacity == 0) {
        return;
    }

    size_t length = strlen(source);

    if (length >= capacity) {
        length = capacity - 1;
    }

    memcpy(destination, source, length);
    destination[length] = '\0';
}

void disasm_result_destroy(DisasmResult *result)
{
    if (result == NULL) {
        return;
    }

    free(result->instructions);
    memset(result, 0, sizeof(*result));
}

int disasm_decode(
    TinyVM *vm,
    size_t maximum_instructions,
    DisasmResult *result
)
{
    if (vm == NULL ||
        result == NULL ||
        vm->uc == NULL ||
        vm->code_address == 0 ||
        vm->code_end <= vm->code_address ||
        maximum_instructions == 0 ||
        maximum_instructions > DISASM_MAX_INSTRUCTIONS) {
        return 1;
    }

    memset(result, 0, sizeof(*result));

    uint64_t code_length = vm->code_end - vm->code_address;

    if (code_length > SIZE_MAX) {
        return 1;
    }

    size_t code_size = (size_t)code_length;
    uint8_t *code = malloc(code_size);

    if (code == NULL) {
        return 1;
    }

    if (vm_read_memory(
            vm,
            vm->code_address,
            code,
            code_size
        ) != 0) {
        free(code);
        return 1;
    }

    VMRegisters registers = {0};

    if (vm_get_registers(vm, &registers) != 0) {
        free(code);
        return 1;
    }

    csh handle = 0;

    if (cs_open(CS_ARCH_X86, CS_MODE_64, &handle) != CS_ERR_OK) {
        free(code);
        return 1;
    }

    cs_option(handle, CS_OPT_DETAIL, CS_OPT_OFF);

    cs_insn *decoded = NULL;

    size_t count = cs_disasm(
        handle,
        code,
        code_size,
        vm->code_address,
        maximum_instructions,
        &decoded
    );

    if (count == 0) {
        cs_close(&handle);
        free(code);
        return 1;
    }

    DisasmInstruction *instructions = calloc(
        count,
        sizeof(*instructions)
    );

    if (instructions == NULL) {
        cs_free(decoded, count);
        cs_close(&handle);
        free(code);
        return 1;
    }

    result->code_address = vm->code_address;
    result->code_end = vm->code_end;
    result->rip = registers.rip;
    result->instructions = instructions;
    result->count = count;

    for (size_t i = 0; i < count; i++) {
        const cs_insn *source = &decoded[i];
        DisasmInstruction *destination = &instructions[i];

        destination->address = source->address;
        destination->size = source->size;

        memcpy(
            destination->bytes,
            source->bytes,
            source->size
        );

        copy_text(
            destination->mnemonic,
            sizeof(destination->mnemonic),
            source->mnemonic
        );

        copy_text(
            destination->operands,
            sizeof(destination->operands),
            source->op_str
        );

        destination->is_current =
            source->address == registers.rip;

        if (destination->is_current) {
            result->current_found = 1;
        }
    }

    const cs_insn *last = &decoded[count - 1];

    result->complete =
        last->address + last->size == vm->code_end;

    cs_free(decoded, count);
    cs_close(&handle);
    free(code);

    return 0;
}