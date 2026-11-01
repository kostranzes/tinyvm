#include "vm.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int load_binary(
    const char *path,
    uint8_t *buffer,
    size_t capacity,
    size_t *size
)
{
    FILE *file = fopen(path, "rb");

    if (file == NULL) {
        fprintf(stderr, "Cannot open NASM test binary: %s\n", path);
        return 1;
    }

    *size = fread(buffer, 1, capacity, file);

    if (*size == 0 || ferror(file)) {
        fclose(file);
        return 1;
    }

    if (*size == capacity && fgetc(file) != EOF) {
        fclose(file);
        fprintf(stderr, "NASM test binary is too large\n");
        return 1;
    }

    fclose(file);
    return 0;
}

static int test_array_sum(
    const uint8_t *code,
    size_t code_size,
    const uint64_t *numbers,
    size_t count,
    uint64_t expected
)
{
    TinyVM vm = {0};
    VMRegisters registers = {0};
    uint64_t actual[5] = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, code_size) != 0) goto cleanup;

    if (count > 0) {
        if (vm_initialize_memory(
                &vm,
                vm.data_address,
                numbers,
                count * sizeof(uint64_t)
            ) != 0) {
            goto cleanup;
        }
    }

    if (vm_set_register(&vm, UC_X86_REG_RDI, vm.data_address) != 0) {
        goto cleanup;
    }

    if (vm_set_register(&vm, UC_X86_REG_RSI, count) != 0) {
        goto cleanup;
    }

    if (vm_run(&vm) != 0) goto cleanup;
    if (vm_get_registers(&vm, &registers) != 0) goto cleanup;

    if (vm.status != VM_STATUS_FINISHED ||
        registers.rax != expected ||
        registers.rip != vm.code_end ||
        vm.instruction_count == 0) {
        fprintf(stderr, "Array sum returned an unexpected result\n");
        goto cleanup;
    }

    if (count > 0) {
        if (vm_read_memory(
                &vm,
                vm.data_address,
                actual,
                count * sizeof(uint64_t)
            ) != 0) {
            goto cleanup;
        }

        if (memcmp(actual, numbers, count * sizeof(uint64_t)) != 0) {
            fprintf(stderr, "Array input was unexpectedly modified\n");
            goto cleanup;
        }
    }

    result = 0;

cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_memory_initialization_rules(void)
{
    const uint8_t code[] = {0x90, 0x90};
    const uint64_t value = 0x123456789ABCDEF0ULL;

    TinyVM vm = {0};
    uint64_t actual = 0;
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;

    if (vm_initialize_memory(&vm, VM_DATA_ADDRESS, &value, sizeof(value)) == 0) {
        fprintf(stderr, "Memory initialized before code loading\n");
        goto cleanup;
    }

    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;

    if (vm_initialize_memory(
            &vm, vm.data_address, &value, sizeof(value)
        ) != 0) {
        goto cleanup;
    }

    if (vm_initialize_memory(
            &vm, vm.stack_address, &value, sizeof(value)
        ) != 0) {
        goto cleanup;
    }

    if (vm_read_memory(
            &vm, vm.data_address, &actual, sizeof(actual)
        ) != 0 || actual != value) {
        fprintf(stderr, "Data initialization failed\n");
        goto cleanup;
    }

    actual = 0;

    if (vm_read_memory(
            &vm, vm.stack_address, &actual, sizeof(actual)
        ) != 0 || actual != value) {
        fprintf(stderr, "Stack initialization failed\n");
        goto cleanup;
    }

    if (vm_initialize_memory(
            &vm, vm.code_address, &value, sizeof(value)
        ) == 0) {
        fprintf(stderr, "Code memory initialization was allowed\n");
        goto cleanup;
    }

    if (vm_initialize_memory(
            &vm,
            vm.data_address + vm.data_size - 4,
            &value,
            sizeof(value)
        ) == 0) {
        fprintf(stderr, "Out-of-bounds initialization was allowed\n");
        goto cleanup;
    }

    if (vm_initialize_memory(
            &vm, vm.data_address, &value, 0
        ) == 0) {
        fprintf(stderr, "Empty initialization was allowed\n");
        goto cleanup;
    }

    if (vm_initialize_memory(
            &vm, vm.data_address, NULL, sizeof(value)
        ) == 0) {
        fprintf(stderr, "NULL input buffer was allowed\n");
        goto cleanup;
    }

    if (vm_step(&vm) != 0 || vm.status != VM_STATUS_RUNNING) {
        goto cleanup;
    }

    if (vm_initialize_memory(
            &vm, vm.data_address, &value, sizeof(value)
        ) == 0) {
        fprintf(stderr, "Initialization after execution was allowed\n");
        goto cleanup;
    }

    if (vm_step(&vm) != 0 || vm.status != VM_STATUS_FINISHED) {
        goto cleanup;
    }

    if (vm_initialize_memory(
            &vm, vm.data_address, &value, sizeof(value)
        ) == 0) {
        fprintf(stderr, "Initialization after finish was allowed\n");
        goto cleanup;
    }

    result = 0;

cleanup:
    vm_destroy(&vm);
    return result;
}

static int run_test(const char *name, int result)
{
    printf("[%s] %s\n", result == 0 ? "PASS" : "FAIL", name);
    return result != 0;
}

int main(int argc, char **argv)
{
    uint8_t code[VM_CODE_SIZE];
    size_t code_size = 0;

    const uint64_t numbers[] = {10, 20, 30, 40, 50};
    const uint64_t single[] = {42};
    const uint64_t mixed[] = {10, (uint64_t)-20, 30};

    int failed = 0;

    if (argc != 2) {
        fprintf(stderr, "Usage: tinyvm-input-tests <array_sum.bin>\n");
        return 1;
    }

    if (load_binary(
            argv[1], code, sizeof(code), &code_size
        ) != 0) {
        return 1;
    }

    failed += run_test(
        "Array sum",
        test_array_sum(code, code_size, numbers, 5, 150)
    );

    failed += run_test(
        "Single element",
        test_array_sum(code, code_size, single, 1, 42)
    );

    failed += run_test(
        "Empty array",
        test_array_sum(code, code_size, NULL, 0, 0)
    );

    failed += run_test(
        "Signed values",
        test_array_sum(code, code_size, mixed, 3, 20)
    );

    failed += run_test(
        "Memory initialization rules",
        test_memory_initialization_rules()
    );

    printf("\nInput tests failed: %d\n", failed);

    return failed == 0 ? 0 : 1;
}
