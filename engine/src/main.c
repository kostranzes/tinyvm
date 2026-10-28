#include "vm.h"

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define MAX_CODE_SIZE 0x1000

static void print_error(const char *error)
{
    printf(
        "{\"status\":\"error\",\"error\":\"%s\","
        "\"instruction_count\":0,\"registers\":null}\n",
        error
    );
}

static int load_binary(const char *path, uint8_t *buffer, size_t capacity, size_t *size)
{
    FILE *file = fopen(path, "rb");

    if (file == NULL) {
        fprintf(stderr, "Cannot open binary file: %s\n", path);
        return -1;
    }

    size_t bytes_read = fread(buffer, 1, capacity, file);

    if (ferror(file)) {
        fprintf(stderr, "Cannot read binary file: %s\n", path);
        fclose(file);
        return -1;
    }

    if (bytes_read == 0) {
        fprintf(stderr, "Binary file is empty: %s\n", path);
        fclose(file);
        return -1;
    }

    if (bytes_read == capacity) {
        int extra_byte = fgetc(file);

        if (extra_byte != EOF) {
            fprintf(stderr, "Binary file exceeds the maximum size of %zu bytes\n", capacity);
            fclose(file);
            return -1;
        }

        if (ferror(file)) {
            fprintf(stderr, "Cannot read binary file: %s\n", path);
            fclose(file);
            return -1;
        }
    }

    if (fclose(file) != 0) {
        fprintf(stderr, "Cannot close binary file: %s\n", path);
        return -1;
    }

    *size = bytes_read;
    return 0;
}

static void print_register(const char *name, uint64_t value, int *first)
{
    printf("%s\"%s\":\"0x%016" PRIx64 "\"", *first ? "" : ",", name, value);
    *first = 0;
}

static int print_result(TinyVM *vm)
{
    VMRegisters registers;

    if (vm_get_registers(vm, &registers) != 0) {
        fprintf(stderr, "Cannot read VM registers\n");
        print_error("register_read_failed");
        return 1;
    }

    const char *status = vm_status_string(vm->status);
    const char *error = NULL;

    if (vm->status == VM_STATUS_LIMIT_EXCEEDED) {
        error = "instruction_limit_exceeded";
    } else if (vm->status == VM_STATUS_ERROR) {
        error = "execution_failed";
    } else if (vm->status != VM_STATUS_FINISHED) {
        error = "unexpected_execution_status";
    }

    printf("{\"status\":\"%s\",\"error\":", status);

    if (error == NULL) {
        printf("null");
    } else {
        printf("\"%s\"", error);
    }

    printf(",\"instruction_count\":%zu,\"registers\":{", vm->instruction_count);

    int first = 1;

    print_register("rax", registers.rax, &first);
    print_register("rbx", registers.rbx, &first);
    print_register("rcx", registers.rcx, &first);
    print_register("rdx", registers.rdx, &first);
    print_register("rsi", registers.rsi, &first);
    print_register("rdi", registers.rdi, &first);
    print_register("rbp", registers.rbp, &first);
    print_register("rsp", registers.rsp, &first);
    print_register("r8", registers.r8, &first);
    print_register("r9", registers.r9, &first);
    print_register("r10", registers.r10, &first);
    print_register("r11", registers.r11, &first);
    print_register("r12", registers.r12, &first);
    print_register("r13", registers.r13, &first);
    print_register("r14", registers.r14, &first);
    print_register("r15", registers.r15, &first);
    print_register("rip", registers.rip, &first);
    print_register("rflags", registers.rflags, &first);

    printf("}}\n");

    return vm->status == VM_STATUS_FINISHED ? 0 : 1;
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <binary_file>\n", argv[0]);
        print_error("invalid_arguments");
        return 1;
    }

    uint8_t code[MAX_CODE_SIZE];
    size_t code_size = 0;

    if (load_binary(argv[1], code, sizeof(code), &code_size) != 0) {
        print_error("binary_load_failed");
        return 1;
    }

    TinyVM vm;

    if (vm_create(&vm) != 0) {
        fprintf(stderr, "Cannot initialize VM\n");
        print_error("vm_initialization_failed");
        return 1;
    }

    if (vm_load_code(&vm, code, code_size) != 0) {
        fprintf(stderr, "Cannot load code into VM\n");
        print_error("code_load_failed");
        vm_destroy(&vm);
        return 1;
    }

    vm_run(&vm);

    int result = print_result(&vm);

    vm_destroy(&vm);
    return result;
}