#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <unicorn/unicorn.h>
#include <capstone/capstone.h>

#define CODE_ADDRESS 0x100000
#define MEMORY_SIZE  0x1000
#define MAX_INSTRUCTIONS 1000

static void print_registers(uc_engine *uc)
{
    uint64_t rax = 0;
    uint64_t rip = 0;

    uc_reg_read(uc, UC_X86_REG_RAX, &rax);
    uc_reg_read(uc, UC_X86_REG_RIP, &rip);

    printf("RAX = %" PRIu64 ", RIP = 0x%" PRIx64 "\n", rax, rip);
}

static int print_instruction(csh handle, uc_engine *uc, uint64_t rip)
{
    uint8_t buffer[15] = {0};

    uc_err err = uc_mem_read(uc, rip, buffer, sizeof(buffer));
    if (err != UC_ERR_OK) {
        fprintf(stderr, "Cannot read instruction: %s\n", uc_strerror(err));
        return 1;
    }

    cs_insn *instructions = NULL;

    size_t count = cs_disasm(
        handle,
        buffer,
        sizeof(buffer),
        rip,
        1,
        &instructions
    );

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

int main(void)
{
    const uint8_t code[] = {
        0x48, 0xC7, 0xC0, 0x64, 0x00, 0x00, 0x00,
        0x48, 0x83, 0xC0, 0x05,
        0x48, 0x83, 0xE8, 0x0A,
        0x48, 0x83, 0xC0, 0x01
    };

    csh handle;

    cs_err cs_error = cs_open(CS_ARCH_X86, CS_MODE_64, &handle);

    if (cs_error != CS_ERR_OK) {
        fprintf(stderr, "Failed to initialize Capstone\n");
        return 1;
    }

    printf("Capstone initialized successfully!\n");

    uc_engine *uc = NULL;
    uc_err err = uc_open(UC_ARCH_X86, UC_MODE_64, &uc);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "uc_open: %s\n", uc_strerror(err));
        return 1;
    }

    err = uc_mem_map(uc, CODE_ADDRESS, MEMORY_SIZE, UC_PROT_ALL);
    if (err != UC_ERR_OK) {
        fprintf(stderr, "uc_mem_map: %s\n", uc_strerror(err));
        uc_close(uc);
        return 1;
    }

    err = uc_mem_write(uc, CODE_ADDRESS, code, sizeof(code));
    if (err != UC_ERR_OK) {
        fprintf(stderr, "uc_mem_write: %s\n", uc_strerror(err));
        uc_close(uc);
        return 1;
    }

    uint64_t rip = CODE_ADDRESS;
    uint64_t rax = 0;

    uc_reg_write(uc, UC_X86_REG_RIP, &rip);
    uc_reg_write(uc, UC_X86_REG_RAX, &rax);

    printf("Initial state:\n");
    print_registers(uc);

    const uint64_t code_end = CODE_ADDRESS + sizeof(code);

    int step = 0;

    while (1) {
        err = uc_reg_read(uc, UC_X86_REG_RIP, &rip);

        if (err != UC_ERR_OK) {
            fprintf(stderr, "Failed to read RIP: %s\n", uc_strerror(err));
            uc_close(uc);
            return 1;
        }

        if (rip >= code_end) {
            break;
        }
        
        if (step >= MAX_INSTRUCTIONS) {
            fprintf(stderr, "Instruction limit exceeded (%d)\n",
                    MAX_INSTRUCTIONS);
            cs_close(&handle);
            uc_close(uc);
            return 1;
        }

        if (print_instruction(handle, uc, rip) != 0) {
            cs_close(&handle);
            uc_close(uc);
            return 1;
        }

        err = uc_emu_start(uc, rip, code_end, 0, 1);

        if (err != UC_ERR_OK) {
            fprintf(stderr, "Step failed: %s\n", uc_strerror(err));
            uc_close(uc);
            return 1;
        }

        step++;
        printf("After step %d:\n", step);
        print_registers(uc);
    }

    cs_close(&handle);
    uc_close(uc);
    return 0;
}
