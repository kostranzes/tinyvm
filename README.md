# TinyVM

TinyVM is a browser-based x86-64 assembly learning and debugging platform.

## Project goals

- Write and run NASM x86-64 assembly in the browser.
- Inspect CPU registers and memory.
- Step through instructions with a visual debugger.
- Practice assembly through programming challenges with hidden tests.
- Track challenge results and instruction counts per user.

## How it works

```text
Browser (React) ──HTTP──▶ Backend (Node.js) ──docker run──▶ tinyvm-nasm
                               │        └────docker run──▶ tinyvm-engine ──▶ tinyvm-session (C)
                          PostgreSQL                                          Unicorn + Capstone
```

1. The frontend sends NASM source code to the backend, which requires a signed-in
   user for anything that runs code.
2. The backend assembles the source with NASM inside a throwaway container (no
   network, read-only filesystem, tight resource limits).
3. The backend starts the engine in another container and drives it with JSON
   Lines commands: load the program, set input registers and memory, step or run,
   read registers and memory, disassemble.
4. For challenges, the backend runs every test (visible and hidden) in a fresh
   engine session, compares the result with the expected one and stores the
   verdict.

The engine is a separate process on purpose: it executes untrusted programs, so
the backend can isolate it, limit its resources and terminate it independently.

## Technology stack

- C (engine), Unicorn Engine, Capstone, json-c
- NASM
- Node.js, Express 5, TypeScript, `zod`, vitest
- PostgreSQL
- Docker (isolation of NASM and the engine)
- React and TypeScript with Vite (frontend)

## Repository layout

| Directory | Contents |
|---|---|
| [`engine/`](engine/) | The C engine: VM core, disassembler, session protocol, tests, `Dockerfile` |
| [`backend/`](backend/) | Node.js and TypeScript API: accounts, running code, debug sessions, tasks, judging |
| `frontend/` | React and TypeScript web client (Vite) |
| `database/` | PostgreSQL setup (Docker Compose) |

## Status

| Component | State |
|---|---|
| Engine | Complete: VM, disassembler, session protocol 1.2, process restrictions, 4 test suites |
| Backend | Complete for the MVP: accounts, `/api/run`, debug sessions, 4 tasks with hidden tests, submission history, rate limits, unit and end-to-end tests |
| Frontend | Not started (Vite template) |
| Database | PostgreSQL 17 with SQL migrations |

## Quick start

Requirements: Docker, Node.js (current LTS), npm. Building the engine on the host
is optional (it is only needed for its tests and for `TINYVM_SESSION_MODE=host`).

```bash
# 1. Database
cd database
# create database/.env with POSTGRES_PASSWORD=...
docker compose up -d
cd ..

# 2. Images used by the backend
docker build -t tinyvm-nasm backend/nasm-image
docker build -t tinyvm-engine engine

# 3. Backend
cd backend
npm install
# create backend/.env with DATABASE_URL=postgresql://tinyvm:PASSWORD@127.0.0.1:5433/tinyvm
npm run migrate
npm run dev          # http://localhost:3000

# 4. Frontend (in another terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Check that the backend works:

```bash
curl -s localhost:3000/api/health
curl -s localhost:3000/api/tasks
```

`.env` files contain secrets and must never be committed.

## Tests

```bash
# Engine (from engine/): needs a C toolchain, Unicorn, Capstone, json-c, NASM, Python 3
cmake -S . -B build && cmake --build build && ctest --test-dir build --output-on-failure

# Backend unit tests (from backend/): no Docker or database needed
npm test

# Backend end-to-end tests: needs a running backend, both images and a migrated database
TINYVM_E2E=1 npm test
```

## Documentation

- [`backend/README.md`](backend/README.md): setup, configuration, the complete HTTP API,
  tasks, security model
- [`engine/README.md`](engine/README.md): building, testing, sanitizers, configuration
  and the engine security model
- [`engine/PROTOCOL.md`](engine/PROTOCOL.md): the session protocol the backend uses to
  control the engine

## Security

The engine executes untrusted machine code, and NASM processes untrusted source.
Both run in containers without network or host file access, with read-only root
filesystems, dropped capabilities and memory, CPU and process limits. Emulation alone
is not a security boundary, so the container is. The backend adds accounts, per-user
session and rate limits, and keeps hidden test data on the server. Deployment
(HTTPS, secure cookies, access to the Docker daemon) is not covered yet; see the
known limitations in [`backend/README.md`](backend/README.md).
