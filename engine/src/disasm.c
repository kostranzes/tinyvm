#include "disasm.h"
#include <inttypes.h>
#include <stdio.h>

int disasm_print_instruction(csh handle, uc_engine *uc, uint64_t rip, uint64_t code_end)
{
    if (rip >= code_end) {
        fprintf(stderr, "RIP is outside the loaded code\n");
        return 1;
    }

    uint8_t buffer[15] = {0};

    size_t available = (size_t)(code_end - rip);
    size_t read_size = available < sizeof(buffer) ? available : sizeof(buffer);

    uc_err err = uc_mem_read(uc, rip, buffer, read_size);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Cannot read instruction: %s\n", uc_strerror(err));
        return 1;
    }

    cs_insn *instructions = NULL;
    size_t count = cs_disasm(handle, buffer, read_size, rip, 1, &instructions);

    if (count == 0) {
        fprintf(stderr, "Cannot disassemble instruction at 0x%" PRIx64 "\n", rip);
        return 1;
    }

    printf("0x%" PRIx64 ": %s %s\n",
           instructions[0].address,
           instructions[0].mnemonic,
           instructions[0].op_str);

    cs_free(instructions, count);
    return 0;
}