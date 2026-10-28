#ifndef TINYVM_VM_H
#define TINYVM_VM_H

#include <stddef.h>
#include <stdint.h>
#include <unicorn/unicorn.h>

typedef struct {
    uint64_t rax;
    uint64_t rbx;
    uint64_t rcx;
    uint64_t rdx;
    uint64_t rsi;
    uint64_t rdi;
    uint64_t rbp;
    uint64_t rsp;
    uint64_t r8;
    uint64_t r9;
    uint64_t r10;
    uint64_t r11;
    uint64_t r12;
    uint64_t r13;
    uint64_t r14;
    uint64_t r15;
    uint64_t rip;
    uint64_t rflags;
} VMRegisters;

typedef struct {
    uc_engine *uc;
    uint64_t code_address;
    uint64_t code_end;
    size_t instruction_count;
    size_t instruction_limit;
    uint64_t stack_address;
    size_t stack_size;
} TinyVM;

int vm_create(TinyVM *vm);
int vm_load_code(TinyVM *vm, const uint8_t *code, size_t code_size);
int vm_step(TinyVM *vm);
int vm_get_registers(TinyVM *vm, VMRegisters *registers);
int vm_read_memory(TinyVM *vm, uint64_t address, void *buffer, size_t size);
void vm_destroy(TinyVM *vm);

#endif