# TinyVM Session Protocol

Version: 1.1

## 1. Overview

`tinyvm-session` is a persistent subprocess that owns one TinyVM instance.

Communication uses newline-delimited JSON:

- **stdin** — one JSON request per line.
- **stdout** — one JSON response per request.
- **stderr** — diagnostic messages only.
- **Encoding** — UTF-8.
- **Session model** — one process loads at most one program.

The backend must not expose this process directly to untrusted clients. It is responsible for authentication, authorization, request validation, process isolation, and resource limits.

## 2. Request and response format

Every request must be a JSON object containing a `command` string.

Example:

```json
{"command":"state"}
```

Every response contains these fields:

| Field | Type | Description |
|---|---|---|
| `status` | string | Current VM status |
| `instruction_count` | integer | Number of executed instructions |
| `registers` | object or null | Register values |
| `error` | string or null | Error code, or `null` on success |

Register values are represented as hexadecimal strings to preserve full 64-bit precision.

The `registers` field is `null` when register state is unavailable.

Additional commands may return extra fields, documented below.

## 3. Commands

### 3.1. `load`

Loads machine code from a hexadecimal byte string.

Request:

```json
{"command":"load","code":"4889f84801f0"}
```

Fields:

- `code` — hexadecimal representation of the machine code.

Rules:

- The string must contain hexadecimal characters only.
- The string must contain complete bytes, with two characters per byte.
- Maximum machine-code size is 4096 bytes.
- A program can be loaded only once per session.

A second load attempt returns `load_failed`. Create a new session to load another program.

### 3.2. `set_register`

Initializes a permitted general-purpose register.

Request:

```json
{"command":"set_register","register":"rdi","value":"0x110000"}
```

Fields:

- `register` — register name.
- `value` — unsigned 64-bit integer represented as a string.

Values may use decimal notation or a `0x` prefix for hexadecimal notation.

The command is intended for setting up input state before execution. `RIP`, `RSP`, and `RFLAGS` are not accepted by the session register-write command.

The VM may reject writes after execution has begun.

### 3.3. `initialize_memory`

Initializes a writable virtual-memory region.

Request:

```json
{"command":"initialize_memory","address":"0x110000","data":"0a00000000000000"}
```

Fields:

- `address` — starting address represented as a string.
- `data` — hexadecimal bytes to write.

The data must contain complete bytes and must not exceed 65536 bytes per request.

The entire requested range must be inside a permitted writable memory region. Memory initialization is intended for program input and is rejected after execution begins.

### 3.4. `step`

Executes one machine instruction.

Request:

```json
{"command":"step"}
```

A successful step increments `instruction_count`.

If the instruction reaches the end of the loaded program, the response reports `finished`.

A subsequent step after successful completion returns `session_finished`.

If an execution limit or VM error is reached, the response contains the corresponding error.

### 3.5. `run`

Continues execution until the program finishes or an execution limit or error stops it.

Request:

```json
{"command":"run"}
```

Execution is subject to the VM's configured instruction limit and other safeguards.

Calling `run` on an already finished VM returns its finished state without restarting the program.

### 3.6. `state`

Returns the current VM state without executing instructions.

Request:

```json
{"command":"state"}
```

The response includes the standard fields:

- `status`
- `instruction_count`
- `registers`
- `error`

### 3.7. `disassemble`

Disassembles the loaded machine code using Capstone.

Request:

```json
{"command":"disassemble"}
```

An optional `max_instructions` field limits the number of decoded instructions:

```json
{"command":"disassemble","max_instructions":100}
```

Rules:

- `max_instructions` must be an integer from 1 through 4096.
- If omitted, the maximum is 4096.
- An invalid value returns `invalid_disassembly_arguments`.

The response contains the standard session fields and an additional `disassembly` object.

#### Disassembly object

| Field | Type | Description |
|---|---|---|
| `code_address` | string | Start address of the loaded code |
| `code_end` | string | Address immediately after the loaded code |
| `rip` | string | Current instruction pointer |
| `current_found` | boolean | Whether RIP matches a decoded instruction |
| `complete` | boolean | Whether the decoded output covers the full code range |
| `instructions` | array | Decoded machine instructions |

Each entry in `instructions` contains:

| Field | Type | Description |
|---|---|---|
| `address` | string | Instruction address in hexadecimal |
| `size` | integer | Instruction length in bytes |
| `bytes` | string | Instruction bytes encoded as hexadecimal |
| `mnemonic` | string | Instruction mnemonic |
| `operands` | string | Formatted instruction operands |
| `is_current` | boolean | Whether the instruction address matches RIP |

The frontend can use `is_current` to highlight the instruction corresponding to the current instruction pointer.

If `max_instructions` truncates the decoded output, `complete` may be false. If RIP does not match any decoded instruction, `current_found` is false.

If decoding fails, the command returns `disassembly_failed`.

### 3.8. `read_memory`

Reads a permitted virtual-memory region.

Request:

```json
{"command":"read_memory","address":"0x110000","size":"40"}
```

Fields:

- `address` — starting address represented as a string.
- `size` — number of bytes to read, represented as a string.

The maximum read size is 4096 bytes per request.

A successful response contains an additional `data` field: a hexadecimal string representing the bytes read.

Reads outside mapped memory or across an invalid range fail.

### 3.9. `close`

Returns the current state and requests termination of the session.

Request:

```json
{"command":"close"}
```

After receiving the response, the caller should close stdin and wait for the process to exit.

## 4. VM statuses

The VM status is returned in the `status` field.

| Status | Meaning |
|---|---|
| `ready` | Session is initialized and no program has started running |
| `running` | A loaded program has not finished |
| `finished` | Program execution has completed |
| `limit_exceeded` | An execution limit has been reached |
| `error` | Execution failed |

The exact terminal status depends on the execution outcome and VM implementation.

## 5. Error codes

| Error | Meaning |
|---|---|
| `invalid_json` | Request is not valid JSON |
| `invalid_command` | Request is missing a valid command field |
| `unknown_command` | Command name is not recognized |
| `invalid_code` | Machine-code input is invalid |
| `load_failed` | Program could not be loaded |
| `invalid_register_arguments` | Register name or value is invalid |
| `register_write_failed` | Register could not be initialized |
| `invalid_memory_arguments` | Memory address, size, or data is invalid |
| `memory_initialization_failed` | Memory could not be initialized |
| `memory_read_failed` | Requested memory could not be read |
| `allocation_failed` | Required memory allocation failed |
| `step_failed` | Single-instruction execution failed |
| `execution_failed` | Continued execution failed |
| `instruction_limit_exceeded` | Instruction limit prevented further execution |
| `session_finished` | A step was requested after the program finished |
| `invalid_disassembly_arguments` | Disassembly limit is invalid |
| `disassembly_failed` | Machine code could not be disassembled |
| `request_too_large` | Request exceeds the permitted size |
| `incomplete_request` | Input ended before a complete request was received |
| `session_timeout` | Session exceeded its idle timeout |

A command validation error does not necessarily terminate the process.

A VM execution error may leave the loaded program in a terminal state. Create a new session to execute another program.

## 6. Resource limits

| Resource | Limit |
|---|---:|
| Maximum JSON request line | 262144 bytes |
| Maximum machine-code size | 4096 bytes |
| Maximum memory read | 4096 bytes |
| Maximum memory initialization request | 65536 bytes |
| Maximum disassembly instructions | 4096 |
| Default idle timeout | 60000 ms |

The idle timeout can be configured using the `TINYVM_IDLE_TIMEOUT_MS` environment variable.

The session process also enforces the VM's configured instruction limit. The backend should additionally apply wall-clock, concurrency, and operating-system resource limits.

## 7. Virtual-memory layout

The current VM layout is:

| Region | Base address | Size | Permissions |
|---|---:|---:|---|
| Code | `0x100000` | `0x1000` | Read and execute |
| Data | `0x110000` | `0x10000` | Read and write |
| Stack | `0x200000` | `0x10000` | Read and write |

The initial stack pointer is set to the top of the mapped stack region.

Program input should be initialized in the data region. The input register convention and expected result must be defined by the contract for each challenge.

## 8. Security requirements

The session process processes untrusted input and must not be exposed directly to arbitrary clients.

The backend and deployment should:

- Authenticate and authorize users before creating or using sessions.
- Apply CPU, memory, instruction-count, and wall-clock limits.
- Limit concurrent sessions.
- Terminate abandoned sessions.
- Prevent user programs from accessing the host filesystem and network.
- Keep hidden challenge test data separate from user-visible responses.
- Run the engine with restricted operating-system permissions and appropriate isolation.
- Avoid exposing internal diagnostics or sensitive server information.

Unicorn emulation alone is not a complete security boundary for the host application.
