
#include "disasm.h"
#include "vm.h"
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define MAX_CODE_SIZE 0x1000

static int print_registers(TinyVM *vm)
{
    VMRegisters r = {0};

    if (vm_get_registers(vm, &r) != 0) return 1;

    printf("RAX = 0x%016" PRIx64 "  RBX = 0x%016" PRIx64 "\n", r.rax, r.rbx);
    printf("RCX = 0x%016" PRIx64 "  RDX = 0x%016" PRIx64 "\n", r.rcx, r.rdx);
    printf("RSI = 0x%016" PRIx64 "  RDI = 0x%016" PRIx64 "\n", r.rsi, r.rdi);
    printf("RBP = 0x%016" PRIx64 "  RSP = 0x%016" PRIx64 "\n", r.rbp, r.rsp);
    printf("R8  = 0x%016" PRIx64 "  R9  = 0x%016" PRIx64 "\n", r.r8, r.r9);
    printf("R10 = 0x%016" PRIx64 "  R11 = 0x%016" PRIx64 "\n", r.r10, r.r11);
    printf("R12 = 0x%016" PRIx64 "  R13 = 0x%016" PRIx64 "\n", r.r12, r.r13);
    printf("R14 = 0x%016" PRIx64 "  R15 = 0x%016" PRIx64 "\n", r.r14, r.r15);
    printf("RIP = 0x%016" PRIx64 "  RFLAGS = 0x%016" PRIx64 "\n",
           r.rip, r.rflags);

    return 0;
}

static int load_binary(const char *path, uint8_t *buffer, size_t *code_size)
{
    FILE *file = fopen(path, "rb");

    if (file == NULL) {
        perror("Cannot open binary file");
        return 1;
    }

    size_t size = fread(buffer, 1, MAX_CODE_SIZE, file);

    if (ferror(file)) {
        fprintf(stderr, "Failed to read binary file\n");
        fclose(file);
        return 1;
    }

    if (size == 0) {
        fprintf(stderr, "Binary file is empty\n");
        fclose(file);
        return 1;
    }

    // Проверяем, что файл не превышает допустимый размер.
    if (fgetc(file) != EOF) {
        fprintf(stderr, "Binary file exceeds %d bytes\n", MAX_CODE_SIZE);
        fclose(file);
        return 1;
    }

    if (ferror(file)) {
        fprintf(stderr, "Failed to check binary file size\n");
        fclose(file);
        return 1;
    }

    fclose(file);
    *code_size = size;

    return 0;
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <binary-file>\n", argv[0]);
        return 1;
    }

    uint8_t code[MAX_CODE_SIZE] = {0};
    size_t code_size = 0;

    if (load_binary(argv[1], code, &code_size) != 0) return 1;

    csh handle;
    cs_err cs_error = cs_open(CS_ARCH_X86, CS_MODE_64, &handle);

    if (cs_error != CS_ERR_OK) {
        fprintf(stderr, "Failed to initialize Capstone\n");
        return 1;
    }

    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, code_size) != 0) goto cleanup;

    printf("Loaded %zu bytes from %s\n", code_size, argv[1]);

    printf("Initial state:\n");
    if (print_registers(&vm) != 0) goto cleanup;

    while (1) {
        VMRegisters registers = {0};

        if (vm_get_registers(&vm, &registers) != 0) goto cleanup;

        uint64_t rip = registers.rip;

        if (rip == vm.code_end) break;

        if (rip < vm.code_address || rip > vm.code_end) {
            fprintf(stderr, "RIP is outside the loaded code\n");
            goto cleanup;
        }

        if (vm.instruction_count >= vm.instruction_limit) {
            fprintf(stderr, "Instruction limit exceeded (%zu)\n",
                    vm.instruction_limit);
            goto cleanup;
        }

        if (disasm_print_instruction(handle, vm.uc, rip, vm.code_end) != 0)
            goto cleanup;

        if (vm_step(&vm) != 0) goto cleanup;

        printf("After step %zu:\n", vm.instruction_count);

        if (print_registers(&vm) != 0) goto cleanup;
    }

    printf("Execution finished successfully (%zu instructions)\n",
           vm.instruction_count);

    result = 0;

cleanup:
    vm_destroy(&vm);
    cs_close(&handle);

    return result;
}
