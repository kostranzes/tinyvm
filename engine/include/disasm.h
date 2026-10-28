#ifndef TINYVM_DISASM_H
#define TINYVM_DISASM_H

#include <stdint.h>
#include <capstone/capstone.h>
#include <unicorn/unicorn.h>

int disasm_print_instruction(csh handle, uc_engine *uc, uint64_t rip, uint64_t code_end);

#endif