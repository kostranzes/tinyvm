#include "vm.h"

#include <stdio.h>
#include <string.h>

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

static const struct {
    const char *name;
    int id;
} initial_registers[] = {
    {"rax", UC_X86_REG_RAX},
    {"rbx", UC_X86_REG_RBX},
    {"rcx", UC_X86_REG_RCX},
    {"rdx", UC_X86_REG_RDX},
    {"rsi", UC_X86_REG_RSI},
    {"rdi", UC_X86_REG_RDI},
    {"rbp", UC_X86_REG_RBP},
    {"r8", UC_X86_REG_R8},
    {"r9", UC_X86_REG_R9},
    {"r10", UC_X86_REG_R10},
    {"r11", UC_X86_REG_R11},
    {"r12", UC_X86_REG_R12},
    {"r13", UC_X86_REG_R13},
    {"r14", UC_X86_REG_R14},
    {"r15", UC_X86_REG_R15}
};

#define INITIAL_REGISTER_COUNT \
    (sizeof(initial_registers) / sizeof(initial_registers[0]))

int vm_register_from_name(const char *name)
{
    if (name == NULL) {
        return UC_X86_REG_INVALID;
    }

    for (size_t i = 0; i < INITIAL_REGISTER_COUNT; i++) {
        if (strcmp(name, initial_registers[i].name) == 0) {
            return initial_registers[i].id;
        }
    }

    return UC_X86_REG_INVALID;
}

static int is_initial_register_allowed(int register_id)
{
    for (size_t i = 0; i < INITIAL_REGISTER_COUNT; i++) {
        if (initial_registers[i].id == register_id) {
            return 1;
        }
    }

    return 0;
}

static int vm_has_loaded_code(const TinyVM *vm)
{
    return vm != NULL &&
           vm->uc != NULL &&
           vm->code_address != 0 &&
           vm->code_end > vm->code_address;
}

static int address_is_writable(
    const TinyVM *vm,
    uint64_t address,
    size_t size
)
{
    return address_in_region(
        address, size, vm->data_address, vm->data_size
    ) || address_in_region(
        address, size, vm->stack_address, vm->stack_size
    );
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

static int map_region(
    uc_engine *uc,
    uint64_t address,
    size_t size,
    uint32_t permissions,
    const char *name
)
{
    uc_err err = uc_mem_map(uc, address, size, permissions);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to map %s: %s\n", name, uc_strerror(err));
        return 1;
    }

    return 0;
}

static int initialize_register(
    uc_engine *uc,
    int register_id,
    uint64_t value,
    const char *name
)
{
    uc_err err = uc_reg_write(uc, register_id, &value);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to initialize %s: %s\n",
                name, uc_strerror(err));
        return 1;
    }

    return 0;
}

int vm_load_code(TinyVM *vm, const uint8_t *code, size_t code_size)
{
    uc_err err;

    if (vm == NULL || vm->uc == NULL || code == NULL ||
        code_size == 0 || code_size > VM_CODE_SIZE ||
        vm->code_address != 0 ||
        vm->status != VM_STATUS_READY) {
        fprintf(stderr, "Invalid VM state or code size\n");
        return 1;
    }

    if (map_region(vm->uc, VM_CODE_ADDRESS, VM_CODE_SIZE,
                   UC_PROT_READ | UC_PROT_EXEC, "code") != 0) {
        goto error;
    }

    err = uc_mem_write(vm->uc, VM_CODE_ADDRESS, code, code_size);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to load code: %s\n", uc_strerror(err));
        goto error;
    }

    if (map_region(vm->uc, VM_DATA_ADDRESS, VM_DATA_SIZE,
                   UC_PROT_READ | UC_PROT_WRITE, "data") != 0 ||
        map_region(vm->uc, VM_STACK_ADDRESS, VM_STACK_SIZE,
                   UC_PROT_READ | UC_PROT_WRITE, "stack") != 0) {
        goto error;
    }

    if (initialize_register(vm->uc, UC_X86_REG_RSP,
                            VM_STACK_ADDRESS + VM_STACK_SIZE, "RSP") != 0 ||
        initialize_register(vm->uc, UC_X86_REG_RIP,
                            VM_CODE_ADDRESS, "RIP") != 0) {
        goto error;
    }

    vm->code_address = VM_CODE_ADDRESS;
    vm->code_end = VM_CODE_ADDRESS + code_size;
    vm->data_address = VM_DATA_ADDRESS;
    vm->data_size = VM_DATA_SIZE;
    vm->stack_address = VM_STACK_ADDRESS;
    vm->stack_size = VM_STACK_SIZE;
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

int vm_set_register(TinyVM *vm, int register_id, uint64_t value)
{
    if (!vm_has_loaded_code(vm) ||
        vm->status != VM_STATUS_READY ||
        vm->instruction_count != 0) {
        fprintf(stderr, "Cannot set register in current VM state\n");
        return 1;
    }

    if (!is_initial_register_allowed(register_id)) {
        fprintf(stderr, "Register cannot be initialized through this API\n");
        return 1;
    }

    uc_err err = uc_reg_write(vm->uc, register_id, &value);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to set register: %s\n", uc_strerror(err));
        return 1;
    }

    return 0;
}

int vm_initialize_memory(
    TinyVM *vm,
    uint64_t address,
    const void *buffer,
    size_t size
)
{
    if (!vm_has_loaded_code(vm) ||
        vm->status != VM_STATUS_READY ||
        vm->instruction_count != 0 ||
        buffer == NULL ||
        size == 0) {
        fprintf(stderr, "Cannot initialize memory in current VM state\n");
        return 1;
    }

    if (!address_is_writable(vm, address, size)) {
        fprintf(stderr, "Initial data is outside writable memory regions\n");
        return 1;
    }

    uc_err err = uc_mem_write(vm->uc, address, buffer, size);

    if (err != UC_ERR_OK) {
        fprintf(stderr, "Failed to initialize memory: %s\n", uc_strerror(err));
        return 1;
    }

    return 0;
}

/*
 * Validates RIP against the loaded code. Reaching code_end marks the program
 * as finished; any other address outside the code is an error.
 * Returns 0 if RIP is acceptable and 1 if the VM entered the error state.
 */
static int vm_check_rip(TinyVM *vm, uint64_t rip)
{
    if (rip == vm->code_end) {
        vm->status = VM_STATUS_FINISHED;
        return 0;
    }

    if (rip < vm->code_address || rip > vm->code_end) {
        fprintf(stderr, "RIP is outside the loaded code\n");
        vm->status = VM_STATUS_ERROR;
        return 1;
    }

    return 0;
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

    if (!vm_has_loaded_code(vm)) {
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

    /* Nothing left to execute, or RIP is invalid. */
    if (vm_check_rip(vm, rip) != 0 || vm->status == VM_STATUS_FINISHED) {
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

    return vm_check_rip(vm, rip);
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
    if (!vm_has_loaded_code(vm) || buffer == NULL || size == 0) {
        return 1;
    }

    int allowed =
        address_in_region(
            address, size, vm->code_address,
            (size_t)(vm->code_end - vm->code_address)
        ) ||
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
    if (!vm_has_loaded_code(vm) || buffer == NULL || size == 0) {
        return 1;
    }

    if (!address_is_writable(vm, address, size)) {
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
