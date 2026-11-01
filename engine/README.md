# TinyVM Engine

The engine executes x86-64 machine code inside a sandboxed virtual machine
(Unicorn) and can disassemble it (Capstone). It is written in C11 and exposes
two executables:

| Executable | Purpose |
|---|---|
| `tinyvm-session` | Persistent process driven by JSON Lines over stdin/stdout. This is what the backend uses. See [PROTOCOL.md](PROTOCOL.md). |
| `tinyvm-engine` | One-shot CLI: runs a raw binary and prints the final state as one JSON line. Useful for manual checks. |

## Requirements

- A C11 compiler, CMake 3.20 or newer, `pkg-config`
- Unicorn 2.x, Capstone 5.x, json-c
- Python 3 and NASM (tests only)

On Debian/Ubuntu:

```bash
sudo apt install build-essential cmake pkg-config \
    libunicorn-dev libcapstone-dev libjson-c-dev nasm python3
```

## Build and test

Run from the `engine/` directory:

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

The test suites are:

| Test | What it checks |
|---|---|
| `vm-tests` | VM core: execution, limits, memory rules, register rules |
| `cli-tests` | `tinyvm-engine` output format and error handling |
| `input-tests` | Programs that read input from registers and memory |
| `session-tests` | The full session protocol, input handling, timeouts, process restrictions |

### Sanitizers and leak checking

Build with AddressSanitizer and UBSan (this also reports memory leaks when a
process exits):

```bash
cmake -S . -B build-asan -DTINYVM_SANITIZE=ON
cmake --build build-asan
ctest --test-dir build-asan --output-on-failure
```

Valgrind can check the unit tests and a scripted session. The session applies
a file-descriptor limit at startup; if Valgrind interferes with it in your
environment, use the AddressSanitizer build above for the session instead.

```bash
valgrind --leak-check=full --error-exitcode=1 ./build/tinyvm-tests

printf '%s\n' \
    '{"command":"load","code":"4889f84801f0"}' \
    '{"command":"run"}' \
    '{"command":"close"}' \
  | valgrind --leak-check=full --error-exitcode=1 ./build/tinyvm-session
```

## Manual use

```bash
# One-shot CLI
nasm -f bin tests/sample.asm -o sample.bin
./build/tinyvm-engine sample.bin

# Interactive session
./build/tinyvm-session
{"command":"load","code":"4889f84801f0"}
{"command":"run"}
{"command":"close"}
```

## Configuration

`tinyvm-session` is configured through environment variables. Per-program
settings, such as the instruction limit, are set with protocol commands
instead.

| Variable | Default | Range | Meaning |
|---|---|---|---|
| `TINYVM_IDLE_TIMEOUT_MS` | `60000` | 1000–300000 | Deadline for receiving each request line |
| `TINYVM_CPU_LIMIT_S` | `120` | 1–3600 | CPU-time limit for the whole process |
| `TINYVM_MEMORY_LIMIT_MB` | unset | 64–65536 | Address-space limit; disabled when unset |

An invalid `TINYVM_CPU_LIMIT_S` or `TINYVM_MEMORY_LIMIT_MB` makes the process
exit with status 1 and an explanatory message on stderr. An invalid
`TINYVM_IDLE_TIMEOUT_MS` falls back to the default.

Unicorn reserves a large amount of virtual memory, so a low
`TINYVM_MEMORY_LIMIT_MB` can make VM creation fail. Use a generous value
(the tests use 8192) and verify it with your deployment. Prefer a container
or cgroup memory limit for strict memory accounting.

## Layout

```text
include/
  vm.h              VM core API and memory layout constants
  disasm.h          Capstone disassembly API
  protocol_json.h   JSON layer used by the session and the CLI
  sandbox.h         Process restrictions
src/
  vm.c              VM core (Unicorn)
  disasm.c          Disassembler (Capstone)
  protocol_json.c   Request parsing, argument checks, response building
  session.c         Session loop and command execution
  sandbox.c         Process restrictions for the session
  main.c            One-shot CLI
tests/              Unit, CLI and session tests, NASM sample programs
PROTOCOL.md         Session protocol specification
```

## Security model

The session process handles untrusted input, but it is **not** a complete
security boundary. Guest code runs inside Unicorn, and a bug in the emulator
would be a bug in the host process.

The session itself applies these restrictions at startup, before reading any
input, and refuses to start if one of them cannot be set:

- `no_new_privs`, so the process can never gain privileges
- no core dumps
- at most 64 open file descriptors
- a CPU-time limit
- optionally, an address-space limit

Input handling is bounded: request lines are limited to 256 KiB, NUL bytes are
rejected, and each request must arrive before the idle deadline.

The backend remains responsible for authentication, per-user quotas, wall-clock
limits, the number of concurrent sessions, and running the process in an
isolated environment (a container or a user namespace) without network access
or access to host files. See section 8 of [PROTOCOL.md](PROTOCOL.md).
