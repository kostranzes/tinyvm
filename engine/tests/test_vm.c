#include "vm.h"
#include <stdint.h>
#include <stdio.h>

static int test_arithmetic(void)
{
    const uint8_t code[] = {
        0x48, 0xC7, 0xC0, 0x64, 0x00, 0x00, 0x00,
        0x48, 0x83, 0xC0, 0x05,
        0x48, 0x83, 0xE8, 0x0A,
        0x48, 0x83, 0xC0, 0x01
    };

    TinyVM vm = {0};
    VMRegisters r = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;

    for (int i = 0; i < 4; i++) {
        if (vm_step(&vm) != 0) goto cleanup;
    }

    if (vm_get_registers(&vm, &r) != 0) goto cleanup;

    if (r.rax != 96 || r.rip != vm.code_end ||
        vm.instruction_count != 4) {
        fprintf(stderr, "Arithmetic test failed\n");
        goto cleanup;
    }

    result = 0;

cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_conditional_jump(void)
{
    const uint8_t code[] = {
        0x48, 0xC7, 0xC0, 0x05, 0x00, 0x00, 0x00,
        0x48, 0x83, 0xF8, 0x05,
        0x74, 0x07,
        0x48, 0xC7, 0xC0, 0x63, 0x00, 0x00, 0x00,
        0x48, 0x83, 0xC0, 0x01
    };

    TinyVM vm = {0};
    VMRegisters r = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;

    for (int i = 0; i < 4; i++) {
        if (vm_step(&vm) != 0) goto cleanup;
    }

    if (vm_get_registers(&vm, &r) != 0) goto cleanup;

    if (r.rax != 6 || r.rip != vm.code_end ||
        vm.instruction_count != 4) {
        fprintf(stderr, "Conditional jump test failed\n");
        goto cleanup;
    }

    result = 0;

cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_instruction_limit(void)
{
    const uint8_t code[] = {
        0xEB, 0xFE
    };

    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;

    vm.instruction_limit = 5;

    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;

    for (int i = 0; i < 5; i++) {
        if (vm_step(&vm) != 0) goto cleanup;
    }

    if (vm.instruction_count != 5) goto cleanup;

    if (vm_step(&vm) == 0) {
        fprintf(stderr, "Instruction limit was bypassed\n");
        goto cleanup;
    }

    if (vm.instruction_count != 5) goto cleanup;

    result = 0;

cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_stack(void)
{
    const uint8_t code[] = {
        0x48, 0xC7, 0xC0, 0x2A, 0x00, 0x00, 0x00, // mov rax, 42
        0x50,                                     // push rax
        0x58                                      // pop rax
    };

    TinyVM vm = {0};
    VMRegisters r = {0};
    uint64_t value = 0;
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;

    uint64_t initial_rsp = vm.stack_address + vm.stack_size;

    if (vm_step(&vm) != 0) goto cleanup;
    if (vm_step(&vm) != 0) goto cleanup;

    if (vm_get_registers(&vm, &r) != 0) goto cleanup;

    if (r.rsp != initial_rsp - 8) goto cleanup;

    if (vm_read_memory(&vm, r.rsp, &value, sizeof(value)) != 0)
        goto cleanup;

    if (value != 42) goto cleanup;

    if (vm_step(&vm) != 0) goto cleanup;
    if (vm_get_registers(&vm, &r) != 0) goto cleanup;

    if (r.rax != 42 || r.rsp != initial_rsp ||
        r.rip != vm.code_end || vm.instruction_count != 3) {
        goto cleanup;
    }

    result = 0;

cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_invalid_memory(void)
{
    // mov rax, [0x300000]
    const uint8_t code[] = {
        0x48, 0xA1,
        0x00, 0x00, 0x30, 0x00,
        0x00, 0x00, 0x00, 0x00
    };

    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;

    // Первая инструкция должна завершиться ошибкой Unicorn.
    if (vm_step(&vm) == 0) {
        fprintf(stderr, "Invalid memory access was allowed\n");
        goto cleanup;
    }

    if (vm.instruction_count != 0) {
        fprintf(stderr, "Failed instruction was counted\n");
        goto cleanup;
    }

    result = 0;

cleanup:
    vm_destroy(&vm);
    return result;
}

int main(void)
{
    int failed = 0;

    if (test_arithmetic() != 0) {
        printf("[FAIL] Arithmetic\n");
        failed++;
    } else {
        printf("[PASS] Arithmetic\n");
    }

    if (test_conditional_jump() != 0) {
        printf("[FAIL] Conditional jump\n");
        failed++;
    } else {
        printf("[PASS] Conditional jump\n");
    }

    if (test_instruction_limit() != 0) {
        printf("[FAIL] Instruction limit\n");
        failed++;
    } else {
        printf("[PASS] Instruction limit\n");
    }

    if (test_stack() != 0) {
        printf("[FAIL] Stack\n");
        failed++;
    } else {
        printf("[PASS] Stack\n");
    }

    if (test_invalid_memory() != 0) {
        printf("[FAIL] Invalid memory\n");
        failed++;
    } else {
        printf("[PASS] Invalid memory\n");
    }

    printf("\nTests failed: %d\n", failed);

    return failed == 0 ? 0 : 1;
}
