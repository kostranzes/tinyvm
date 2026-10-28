#ifndef TINYVM_DISASM_H
#define TINYVM_DISASM_H

#include "vm.h"

#include <stddef.h>
#include <stdint.h>

#define DISASM_MAX_INSTRUCTIONS 4096

typedef struct {
    uint64_t address;
    uint16_t size;
    uint8_t bytes[15];
    char mnemonic[32];
    char operands[160];
    int is_current;
} DisasmInstruction;

typedef struct {
    uint64_t code_address;
    uint64_t code_end;
    uint64_t rip;
    DisasmInstruction *instructions;
    size_t count;
    int current_found;
    int complete;
} DisasmResult;

int disasm_decode(
    TinyVM *vm,
    size_t maximum_instructions,
    DisasmResult *result
);

void disasm_result_destroy(DisasmResult *result);

#endif