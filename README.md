# TinyVM

TinyVM is a browser-based x86-64 assembly learning and debugging platform.

## Project goals

- Write and run NASM x86-64 assembly in the browser.
- Inspect CPU registers and memory.
- Step through instructions with a visual debugger.
- Practice assembly through programming challenges.
- Track challenge results and instruction counts.

## How it works

```text
Browser (React)  ──HTTP──▶  Backend (Node.js)  ──JSON Lines──▶  tinyvm-session (C)
                                   │                                  │
                              PostgreSQL                      Unicorn + Capstone
```

1. The frontend sends NASM source code to the backend.
2. The backend assembles it into machine code and starts an isolated
   `tinyvm-session` process.
3. The backend drives the session with JSON commands: load the program, set
   input registers and memory, step or run, read registers and memory,
   disassemble.
4. Results, such as the final state and the instruction count, are stored in
   the database.

The engine is a separate process on purpose: it executes untrusted programs, so
the backend can isolate it, limit its resources and terminate it independently.

## Technology stack

- C (engine)
- NASM
- Unicorn Engine
- Capstone
- json-c
- React and TypeScript
- Node.js and Express
- PostgreSQL

## Repository layout

| Directory | Contents |
|---|---|
| [`engine/`](engine/) | The C engine: VM core, disassembler, session protocol and tests |
| `backend/` | Node.js and TypeScript API |
| `frontend/` | React and TypeScript web client (Vite) |
| `database/` | Database setup (Docker Compose) |

## Status

| Component | State |
|---|---|
| Engine | Complete: VM, disassembler, session protocol 1.2, process restrictions, 4 test suites |
| Backend | Initial scaffolding; engine integration not started |
| Frontend | Initial scaffolding (Vite template) |
| Database | Initial setup |

## Engine quick start

Requirements: a C11 compiler, CMake 3.20+, `pkg-config`, Unicorn 2.x,
Capstone 5.x, json-c, NASM and Python 3.

```bash
cd engine
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

More details:

- [`engine/README.md`](engine/README.md): building, testing, sanitizers,
  configuration and the security model
- [`engine/PROTOCOL.md`](engine/PROTOCOL.md): the session protocol the backend
  uses to control the engine

## Security

The engine executes untrusted machine code. It restricts its own process
(`no_new_privs`, resource limits, bounded input), but emulation is not a
complete security boundary. The backend must run it in an isolated environment
without network or host file access, and apply authentication, quotas and
wall-clock limits. See [`engine/README.md`](engine/README.md) and section 8 of
[`engine/PROTOCOL.md`](engine/PROTOCOL.md).
