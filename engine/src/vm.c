#include "vm.h"

#include <stdio.h>
#include <string.h>

#define CODE_ADDRESS 0x100000
#define CODE_SIZE 0x1000
#define DATA_ADDRESS 0x110000
#define DATA_SIZE 0x10000
#define STACK_ADDRESS 0x200000
#define STACK_SIZE 0x10000

static int address_in_region(
    uint64_t address,
    size_t size,
    uint64_t region_address,
    size_t region_size
)
{
    if (size == 0 || address < region_address) {
        return 0;
    }

    uint64_t offset = address - region_address;

    return offset < region_size && size <= region_size - offset;
}

int vm_create(TinyVM *vm)
{
    if (vm == NULL) {
        return 1;
    }

    memset(vm, 0, sizeof(*vm));

    vm->instruction_limit = 1000;
    vm->status = VM_STATUS_READY;

    uc_err err = uc_open(UC_ARCH_X86, UC_MODE_64, &vm->uc);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to initialize VM: %s\n", uc_strerror(err));
        vm->uc = NULL;
        return 1;
    }

    return 0;
}

int vm_load_code(TinyVM *vm, const uint8_t *code, size_t code_size)
{
    if (vm == NULL || vm->uc == NULL || code == NULL ||
        code_size == 0 || code_size > CODE_SIZE || vm->code_address != 0 ||
        vm->status != VM_STATUS_READY) {
        fprintf(stderr, "Invalid VM state or code size\n");
        return 1;
    }

    uc_err err = uc_mem_map(
        vm->uc,
        CODE_ADDRESS,
        CODE_SIZE,
        UC_PROT_READ | UC_PROT_EXEC
    );

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to map code: %s\n", uc_strerror(err));
        goto error;
    }

    err = uc_mem_write(vm->uc, CODE_ADDRESS, code, code_size);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to load code: %s\n", uc_strerror(err));
        goto error;
    }

    err = uc_mem_map(
        vm->uc,
        DATA_ADDRESS,
        DATA_SIZE,
        UC_PROT_READ | UC_PROT_WRITE
    );

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to map data: %s\n", uc_strerror(err));
        goto error;
    }

    err = uc_mem_map(
        vm->uc,
        STACK_ADDRESS,
        STACK_SIZE,
        UC_PROT_READ | UC_PROT_WRITE
    );

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to map stack: %s\n", uc_strerror(err));
        goto error;
    }

    uint64_t rsp = STACK_ADDRESS + STACK_SIZE;
    err = uc_reg_write(vm->uc, UC_X86_REG_RSP, &rsp);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to initialize RSP: %s\n", uc_strerror(err));
        goto error;
    }

    uint64_t rip = CODE_ADDRESS;
    err = uc_reg_write(vm->uc, UC_X86_REG_RIP, &rip);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to initialize RIP: %s\n", uc_strerror(err));
        goto error;
    }

    vm->code_address = CODE_ADDRESS;
    vm->code_end = CODE_ADDRESS + code_size;
    vm->data_address = DATA_ADDRESS;
    vm->data_size = DATA_SIZE;
    vm->stack_address = STACK_ADDRESS;
    vm->stack_size = STACK_SIZE;
    vm->instruction_count = 0;
    vm->status = VM_STATUS_READY;

    return 0;

error:
    uc_close(vm->uc);
    vm->uc = NULL;
    vm->code_address = 0;
    vm->code_end = 0;
    vm->data_address = 0;
    vm->data_size = 0;
    vm->stack_address = 0;
    vm->stack_size = 0;
    vm->status = VM_STATUS_ERROR;

    return 1;
}

int vm_step(TinyVM *vm)
{
    if (vm == NULL || vm->uc == NULL) {
        return 1;
    }

    if (vm->status == VM_STATUS_FINISHED ||
        vm->status == VM_STATUS_LIMIT_EXCEEDED ||
        vm->status == VM_STATUS_ERROR) {
        return 1;
    }

    if (vm->code_address == 0 || vm->code_end <= vm->code_address) {
        fprintf(stderr, "No code loaded into VM\n");
        vm->status = VM_STATUS_ERROR;
        return 1;
    }

    uint64_t rip = 0;
    uc_err err = uc_reg_read(vm->uc, UC_X86_REG_RIP, &rip);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to read RIP: %s\n", uc_strerror(err));
        vm->status = VM_STATUS_ERROR;
        return 1;
    }

    if (rip == vm->code_end) {
        vm->status = VM_STATUS_FINISHED;
        return 1;
    }

    if (rip < vm->code_address || rip > vm->code_end) {
        fprintf(stderr, "RIP is outside the loaded code\n");
        vm->status = VM_STATUS_ERROR;
        return 1;
    }

    if (vm->instruction_count >= vm->instruction_limit) {
        fprintf(stderr, "Instruction limit exceeded (%zu)\n",
                vm->instruction_limit);
        vm->status = VM_STATUS_LIMIT_EXCEEDED;
        return 1;
    }

    vm->status = VM_STATUS_RUNNING;

    err = uc_emu_start(vm->uc, rip, vm->code_end, 0, 1);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "VM step failed: %s\n", uc_strerror(err));
        vm->status = VM_STATUS_ERROR;
        return 1;
    }

    vm->instruction_count++;

    err = uc_reg_read(vm->uc, UC_X86_REG_RIP, &rip);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to read RIP: %s\n", uc_strerror(err));
        vm->status = VM_STATUS_ERROR;
        return 1;
    }

    if (rip == vm->code_end) {
        vm->status = VM_STATUS_FINISHED;
    } else if (rip < vm->code_address || rip > vm->code_end) {
        fprintf(stderr, "RIP is outside the loaded code\n");
        vm->status = VM_STATUS_ERROR;
        return 1;
    }

    return 0;
}

int vm_run(TinyVM *vm)
{
    if (vm == NULL || vm->uc == NULL) {
        return 1;
    }

    while (vm->status == VM_STATUS_READY ||
           vm->status == VM_STATUS_RUNNING) {
        if (vm_step(vm) != 0) {
            break;
        }
    }

    return vm->status == VM_STATUS_FINISHED ? 0 : 1;
}

const char *vm_status_string(VMStatus status)
{
    switch (status) {
        case VM_STATUS_READY:
            return "ready";
        case VM_STATUS_RUNNING:
            return "running";
        case VM_STATUS_FINISHED:
            return "finished";
        case VM_STATUS_LIMIT_EXCEEDED:
            return "limit_exceeded";
        case VM_STATUS_ERROR:
            return "error";
        default:
            return "unknown";
    }
}

int vm_get_registers(TinyVM *vm, VMRegisters *registers)
{
    if (vm == NULL || vm->uc == NULL || registers == NULL) {
        return 1;
    }

    memset(registers, 0, sizeof(*registers));

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
    if (vm == NULL || vm->uc == NULL || buffer == NULL || size == 0) {
        return 1;
    }

    int allowed =
        address_in_region(address, size, vm->code_address,
                          (size_t)(vm->code_end - vm->code_address)) ||
        address_in_region(address, size, vm->data_address, vm->data_size) ||
        address_in_region(address, size, vm->stack_address, vm->stack_size);

    if (!allowed) {
        fprintf(stderr, "Memory read is outside allowed regions\n");
        return 1;
    }

    uc_err err = uc_mem_read(vm->uc, address, buffer, size);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to read memory: %s\n", uc_strerror(err));
        return 1;
    }

    return 0;
}

int vm_write_memory(TinyVM *vm, uint64_t address, const void *buffer, size_t size)
{
    if (vm == NULL || vm->uc == NULL || buffer == NULL || size == 0) {
        return 1;
    }

    int allowed =
        address_in_region(address, size, vm->data_address, vm->data_size) ||
        address_in_region(address, size, vm->stack_address, vm->stack_size);

    if (!allowed) {
        fprintf(stderr, "Memory write is outside writable regions\n");
        return 1;
    }

    uc_err err = uc_mem_write(vm->uc, address, buffer, size);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to write memory: %s\n", uc_strerror(err));
        return 1;
    }

    return 0;
}

void vm_destroy(TinyVM *vm)
{
    if (vm == NULL) {
        return;
    }

    if (vm->uc != NULL) {
        uc_close(vm->uc);
    }

    memset(vm, 0, sizeof(*vm));
}
