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
    if (r.rax != 96 || r.rip != vm.code_end || vm.instruction_count != 4) {
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
    if (r.rax != 6 || r.rip != vm.code_end || vm.instruction_count != 4) {
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
    const uint8_t code[] = { 0xEB, 0xFE };
    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    vm.instruction_limit = 5;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;
    for (int i = 0; i < 5; i++) {
        if (vm_step(&vm) != 0) goto cleanup;
    }
    if (vm.instruction_count != 5) goto cleanup;
    if (vm_step(&vm) == 0 || vm.status != VM_STATUS_LIMIT_EXCEEDED) {
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
        0x48, 0xC7, 0xC0, 0x2A, 0x00, 0x00, 0x00,
        0x50,
        0x58
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
    if (vm_read_memory(&vm, r.rsp, &value, sizeof(value)) != 0) goto cleanup;
    if (value != 42) goto cleanup;
    if (vm_step(&vm) != 0) goto cleanup;
    if (vm_get_registers(&vm, &r) != 0) goto cleanup;
    if (r.rax != 42 || r.rsp != initial_rsp ||
        r.rip != vm.code_end || vm.instruction_count != 3) goto cleanup;
    result = 0;
cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_invalid_memory(void)
{
    const uint8_t code[] = {
        0x48, 0xA1, 0x00, 0x00, 0x30, 0x00,
        0x00, 0x00, 0x00, 0x00
    };
    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;
    if (vm_step(&vm) == 0 || vm.status != VM_STATUS_ERROR) {
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

static int test_vm_run(void)
{
    const uint8_t code[] = {
        0xB8, 0x64, 0x00, 0x00, 0x00,
        0x48, 0x83, 0xC0, 0x05,
        0x48, 0x83, 0xE8, 0x0A,
        0x48, 0x83, 0xC0, 0x01
    };
    TinyVM vm = {0};
    VMRegisters r = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;
    if (vm.status != VM_STATUS_READY) goto cleanup;
    if (vm_run(&vm) != 0) goto cleanup;
    if (vm_get_registers(&vm, &r) != 0) goto cleanup;
    if (vm.status != VM_STATUS_FINISHED || vm.instruction_count != 4 ||
        r.rax != 96 || r.rip != vm.code_end) {
        fprintf(stderr, "VM run test failed\n");
        goto cleanup;
    }
    result = 0;
cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_memory(void)
{
    const uint8_t code[] = { 0x90 };
    const uint64_t original = 0x123456789ABCDEF0;
    uint64_t actual = 0;
    uint8_t byte = 0xAA;
    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;
    if (vm_write_memory(&vm, vm.data_address, &original, sizeof(original)) != 0) goto cleanup;
    if (vm_read_memory(&vm, vm.data_address, &actual, sizeof(actual)) != 0) goto cleanup;
    if (actual != original) goto cleanup;
    if (vm_write_memory(&vm, vm.stack_address, &original, sizeof(original)) != 0) goto cleanup;
    if (vm_read_memory(&vm, vm.stack_address, &actual, sizeof(actual)) != 0) goto cleanup;
    if (actual != original) goto cleanup;
    if (vm_write_memory(&vm, vm.code_address, &byte, sizeof(byte)) == 0) {
        fprintf(stderr, "Writing to code memory was allowed\n");
        goto cleanup;
    }
    if (vm_read_memory(&vm, 0x300000, &actual, sizeof(actual)) == 0) {
        fprintf(stderr, "Reading unmapped memory was allowed\n");
        goto cleanup;
    }
    if (vm_write_memory(&vm, vm.data_address + vm.data_size - 4,
                        &original, sizeof(original)) == 0) {
        fprintf(stderr, "Out-of-bounds memory write was allowed\n");
        goto cleanup;
    }
    result = 0;
cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_jump_to_code_end(void)
{
    const uint8_t code[] = { 0xEB, 0x00 };
    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;
    if (vm_step(&vm) != 0 || vm.status != VM_STATUS_FINISHED ||
        vm.instruction_count != 1) {
        fprintf(stderr, "Jump to code end test failed\n");
        goto cleanup;
    }
    result = 0;
cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_jump_past_code_end(void)
{
    const uint8_t code[] = { 0xEB, 0x01 };
    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;
    if (vm_step(&vm) == 0 || vm.status != VM_STATUS_ERROR ||
        vm.instruction_count != 1) {
        fprintf(stderr, "Jump past code end test failed\n");
        goto cleanup;
    }
    result = 0;
cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_step_without_code(void)
{
    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_step(&vm) == 0 || vm.status != VM_STATUS_ERROR ||
        vm.instruction_count != 0) {
        fprintf(stderr, "Step without code test failed\n");
        goto cleanup;
    }
    result = 0;
cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_run_without_code(void)
{
    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_run(&vm) == 0 || vm.status != VM_STATUS_ERROR ||
        vm.instruction_count != 0) {
        fprintf(stderr, "Run without code test failed\n");
        goto cleanup;
    }
    result = 0;
cleanup:
    vm_destroy(&vm);
    return result;
}

static int test_step_after_finish(void)
{
    const uint8_t code[] = { 0x90 };
    TinyVM vm = {0};
    int result = 1;

    if (vm_create(&vm) != 0) goto cleanup;
    if (vm_load_code(&vm, code, sizeof(code)) != 0) goto cleanup;
    if (vm_step(&vm) != 0 || vm.status != VM_STATUS_FINISHED ||
        vm.instruction_count != 1) goto cleanup;
    if (vm_step(&vm) == 0 || vm.status != VM_STATUS_FINISHED ||
        vm.instruction_count != 1) {
        fprintf(stderr, "Step after finish test failed\n");
        goto cleanup;
    }
    result = 0;
cleanup:
    vm_destroy(&vm);
    return result;
}

static int run_test(const char *name, int (*test)(void))
{
    int failed = test();
    printf("[%s] %s\n", failed == 0 ? "PASS" : "FAIL", name);
    return failed != 0;
}

int main(void)
{
    int failed = 0;

    failed += run_test("Arithmetic", test_arithmetic);
    failed += run_test("Conditional jump", test_conditional_jump);
    failed += run_test("Instruction limit", test_instruction_limit);
    failed += run_test("Stack", test_stack);
    failed += run_test("Invalid memory", test_invalid_memory);
    failed += run_test("VM run", test_vm_run);
    failed += run_test("Memory", test_memory);
    failed += run_test("Jump to code end", test_jump_to_code_end);
    failed += run_test("Jump past code end", test_jump_past_code_end);
    failed += run_test("Step without code", test_step_without_code);
    failed += run_test("Run without code", test_run_without_code);
    failed += run_test("Step after finish", test_step_after_finish);

    printf("\nTests failed: %d\n", failed);
    return failed == 0 ? 0 : 1;
}
