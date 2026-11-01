#include "protocol_json.h"
#include "vm.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

static void report_error(const char *error)
{
    protocol_send_response(protocol_make_error(error));
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

static int print_result(TinyVM *vm)
{
    VMRegisters registers;

    if (vm_get_registers(vm, &registers) != 0) {
        fprintf(stderr, "Cannot read VM registers\n");
        report_error("register_read_failed");
        return 1;
    }

    const char *error = protocol_execution_error(vm);

    if (error == NULL && vm->status != VM_STATUS_FINISHED) {
        error = "unexpected_execution_status";
    }

    protocol_send_response(protocol_make_response(vm, error));

    return vm->status == VM_STATUS_FINISHED ? 0 : 1;
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <binary_file>\n", argv[0]);
        report_error("invalid_arguments");
        return 1;
    }

    uint8_t code[VM_CODE_SIZE];
    size_t code_size = 0;

    if (load_binary(argv[1], code, sizeof(code), &code_size) != 0) {
        report_error("binary_load_failed");
        return 1;
    }

    TinyVM vm;

    if (vm_create(&vm) != 0) {
        fprintf(stderr, "Cannot initialize VM\n");
        report_error("vm_initialization_failed");
        return 1;
    }

    if (vm_load_code(&vm, code, code_size) != 0) {
        fprintf(stderr, "Cannot load code into VM\n");
        report_error("code_load_failed");
        vm_destroy(&vm);
        return 1;
    }

    vm_run(&vm);

    int result = print_result(&vm);

    vm_destroy(&vm);
    return result;
}
