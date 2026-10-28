#include "vm.h"
#include <stdio.h>

#define STACK_ADDRESS 0x200000
#define STACK_SIZE 0x10000

int vm_create(TinyVM *vm)
{
    if (vm == NULL) return 1;

    vm->uc = NULL;
    vm->code_address = 0;
    vm->code_end = 0;
    vm->instruction_count = 0;
    vm->instruction_limit = 1000;
    vm->stack_address = 0;
    vm->stack_size = 0;

    uc_err err = uc_open(UC_ARCH_X86, UC_MODE_64, &vm->uc);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to initialize VM: %s\n", uc_strerror(err));
        return 1;
    }

    return 0;
}

int vm_load_code(TinyVM *vm, const uint8_t *code, size_t code_size)
{
    const uint64_t code_address = 0x100000;
    const size_t memory_size = 0x1000;

    if (vm == NULL || vm->uc == NULL || code == NULL ||
        code_size == 0 || code_size > memory_size) {
        fprintf(stderr, "Invalid VM or code size\n");
        return 1;
    }

    uc_err err = uc_mem_map(vm->uc, code_address, memory_size, UC_PROT_ALL);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "uc_mem_map: %s\n", uc_strerror(err));
        return 1;
    }

    err = uc_mem_write(vm->uc, code_address, code, code_size);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "uc_mem_write: %s\n", uc_strerror(err));
        return 1;
    }

    vm->code_address = code_address;
    vm->code_end = code_address + code_size;

    // Выделяем 64 КиБ памяти под стек.
    err = uc_mem_map(vm->uc, STACK_ADDRESS, STACK_SIZE,
                     UC_PROT_READ | UC_PROT_WRITE);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to map stack: %s\n", uc_strerror(err));
        return 1;
    }

    // Стек x86-64 растёт вниз, поэтому RSP ставим в конец области.
    uint64_t rsp = STACK_ADDRESS + STACK_SIZE;

    err = uc_reg_write(vm->uc, UC_X86_REG_RSP, &rsp);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to initialize RSP: %s\n", uc_strerror(err));
        return 1;
    }

    vm->stack_address = STACK_ADDRESS;
    vm->stack_size = STACK_SIZE;

    // Устанавливаем адрес первой инструкции.
    uint64_t rip = code_address;

    err = uc_reg_write(vm->uc, UC_X86_REG_RIP, &rip);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to initialize RIP: %s\n", uc_strerror(err));
        return 1;
    }

    vm->instruction_count = 0;

    return 0;
}

int vm_step(TinyVM *vm)
{
    if (vm == NULL || vm->uc == NULL) return 1;

    if (vm->instruction_count >= vm->instruction_limit) {
        fprintf(stderr, "Instruction limit exceeded (%zu)\n",
                vm->instruction_limit);
        return 1;
    }

    uint64_t rip = 0;
    uc_err err = uc_reg_read(vm->uc, UC_X86_REG_RIP, &rip);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to read RIP: %s\n", uc_strerror(err));
        return 1;
    }

    if (rip < vm->code_address || rip >= vm->code_end) {
        fprintf(stderr, "RIP is outside the loaded code\n");
        return 1;
    }

    err = uc_emu_start(vm->uc, rip, vm->code_end, 0, 1);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "VM step failed: %s\n", uc_strerror(err));
        return 1;
    }

    vm->instruction_count++;

    return 0;
}

int vm_get_registers(TinyVM *vm, VMRegisters *registers)
{
    if (vm == NULL || vm->uc == NULL || registers == NULL) return 1;

    int ids[] = {
        UC_X86_REG_RAX, UC_X86_REG_RBX, UC_X86_REG_RCX, UC_X86_REG_RDX,
        UC_X86_REG_RSI, UC_X86_REG_RDI, UC_X86_REG_RBP, UC_X86_REG_RSP,
        UC_X86_REG_R8, UC_X86_REG_R9, UC_X86_REG_R10, UC_X86_REG_R11,
        UC_X86_REG_R12, UC_X86_REG_R13, UC_X86_REG_R14, UC_X86_REG_R15,
        UC_X86_REG_RIP, UC_X86_REG_EFLAGS
    };

    void *values[] = {
        &registers->rax, &registers->rbx, &registers->rcx, &registers->rdx,
        &registers->rsi, &registers->rdi, &registers->rbp, &registers->rsp,
        &registers->r8, &registers->r9, &registers->r10, &registers->r11,
        &registers->r12, &registers->r13, &registers->r14, &registers->r15,
        &registers->rip, &registers->rflags
    };

    uc_err err = uc_reg_read_batch(vm->uc, ids, values, 18);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to read registers: %s\n", uc_strerror(err));
        return 1;
    }

    return 0;
}

int vm_read_memory(TinyVM *vm, uint64_t address, void *buffer, size_t size)
{
    if (vm == NULL || vm->uc == NULL || buffer == NULL || size == 0)
        return 1;

    uc_err err = uc_mem_read(vm->uc, address, buffer, size);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to read memory: %s\n", uc_strerror(err));
        return 1;
    }

    return 0;
}

void vm_destroy(TinyVM *vm)
{
    if (vm == NULL) return;

    if (vm->uc != NULL) {
        uc_close(vm->uc);
        vm->uc = NULL;
    }

    vm->code_address = 0;
    vm->code_end = 0;
    vm->stack_address = 0;
    vm->stack_size = 0;
}