# TinyVM Backend

HTTP API for the TinyVM platform: it assembles NASM code, runs it in the
sandboxed engine (see [engine/README.md](../engine/README.md)), serves tasks,
judges submissions and manages accounts.

```text
Browser ──HTTP──▶ Backend (Express 5) ──docker run──▶ tinyvm-nasm      (assembly)
                       │            └──docker run──▶ tinyvm-engine    (execution, JSON Lines)
                  PostgreSQL
```

## Requirements

- Node.js (a current LTS release), npm
- Docker (the backend starts containers through the `docker` CLI)
- PostgreSQL 17 (`database/compose.yaml` runs one)
- A built engine only if you use `TINYVM_SESSION_MODE=host`

## Setup

```bash
# 1. Database
cd database && docker compose up -d && cd ..

# 2. Images used by the backend
docker build -t tinyvm-nasm backend/nasm-image
docker build -t tinyvm-engine engine

# 3. Dependencies, configuration, schema
cd backend
npm install
# create backend/.env (see below), then:
npm run migrate

# 4. Run
npm run dev
```

Minimal `backend/.env`:

```text
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5433/DBNAME
```

`.env` files hold secrets and must never be committed.

## Configuration

All variables are validated at startup (`src/config.ts`); an invalid value stops the
server with a message naming the variable.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `PORT` | `3000` | HTTP port |
| `CORS_ORIGIN` | `http://localhost:5173` | The only allowed browser origin |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS so the session cookie is `Secure` |
| `TINYVM_SESSION_MODE` | `docker` | `docker` runs the engine in a container, `host` runs the binary directly (debugging only) |
| `TINYVM_SESSION_IMAGE` | `tinyvm-engine` | Engine image for `docker` mode |
| `TINYVM_SESSION_BIN` | `../engine/build/tinyvm-session` | Engine binary for `host` mode |
| `RATE_LIMIT_GENERAL_PER_MIN` | `300` | Requests per minute per IP for all of `/api` |
| `RATE_LIMIT_HEAVY_PER_MIN` | `30` | Requests per minute per user for `run`, session creation and `submit` (one shared counter) |
| `RATE_LIMIT_AUTH_PER_MIN` | `10` | Register and login requests per minute per IP |

Configuration changes need a manual restart: `tsx watch` does not watch `.env`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server with reload (`tsx watch`) |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run migrate` | Apply new SQL files from `migrations/` |
| `npm test` | Unit tests (no Docker, database or engine needed) |
| `TINYVM_E2E=1 npm test` | Also runs end-to-end tests against a running server |
| `npx tsc --noEmit`, `npx tsc -p tests --noEmit` | Type checks for sources and tests |

End-to-end tests need a running backend, Docker with both images, and a migrated
database. They create users and submissions. Start the server with
`RATE_LIMIT_AUTH_PER_MIN=1000 RATE_LIMIT_HEAVY_PER_MIN=1000 npm run dev` to avoid
rate limits during repeated runs. `TINYVM_E2E_URL` overrides the server address.

## API

All bodies are JSON. Successful responses contain `"status": "ok"`; failures contain
`"status": "error"` and an `error` code. Authentication uses the `tinyvm_sid` cookie
(`HttpOnly`, `SameSite=Lax`, 14 days). Browsers must send credentials
(`fetch(..., { credentials: 'include' })`). Unsafe requests with a foreign `Origin`
header get `403 forbidden_origin`.

Numbers that may exceed 53 bits (register values, addresses) are strings: decimal
(`"10"`) or `0x`-hex (`"0x110000"`). Register values in responses are
`"0x%016x"` strings. Octal does not exist: `"010"` is ten.

### Health

| Request | Response |
|---|---|
| `GET /api/health` | `{"status":"ok","service":"tinyvm-backend"}` |
| `GET /api/health/db` | `200` with `serverTime`, or `503` when the database is down |

### Accounts

| Request | Success | Errors |
|---|---|---|
| `POST /api/auth/register` `{email, password}` (password 10-128 chars) | `201 {user}` and the cookie | `400 invalid_request`, `409 email_taken` |
| `POST /api/auth/login` `{email, password}` | `200 {user}` and the cookie | `401 invalid_credentials` (same answer for a wrong password and an unknown email) |
| `POST /api/auth/logout` | `200` | |
| `GET /api/auth/me` | `200 {user: {id, email}}` | `401 unauthorized` |

### Tasks (public)

- `GET /api/tasks` returns `{tasks: [{slug, title, difficulty}]}`.
- `GET /api/tasks/:slug` returns the task: `title`, `description`, `starterCode`,
  `instructionLimit`, `difficulty`, `visibleTests` (`position`, `input`, `expected`)
  and `hiddenTestCount`. Hidden tests are filtered in the SQL query and never leave
  the server. Unknown slug: `404 task_not_found`.

### Submissions (login required)

`POST /api/tasks/:slug/submit` with `{"source": "..."}`.

The code is assembled once, then every test (hidden ones too) runs in a fresh engine
session; only the registers and memory listed in `expected` are compared. It stops at
the first failing test.

```json
{
  "status": "ok",
  "submissionId": 12,
  "verdict": "wrong_answer",
  "passed": 1,
  "total": 3,
  "instructionCount": 4,
  "failedTest": { "position": 2, "hidden": true }
}
```

Verdicts: `accepted`, `wrong_answer`, `runtime_error` (`failedTest.engineError` holds
the engine code), `limit_exceeded`, `assembly_error` (`message` holds the NASM error).
For a failed **visible** test, `failedTest.mismatches` lists `{what, expected, actual}`;
for a hidden test only the position is shown. Every verdict is HTTP 200 and is stored.
Infrastructure failures (`503 engine_unavailable`, `503 busy`) are not stored.

### Run code (login required)

`POST /api/run`:

```json
{
  "source": "mov rax, rdi\nadd rax, rsi",
  "registers": { "rdi": "2", "rsi": "3" },
  "memory": [{ "address": "0x110000", "data": "0a00000000000000" }],
  "instructionLimit": 1000,
  "readMemory": [{ "address": "0x110000", "size": 16 }]
}
```

Only `source` is required. Writable registers: `rax rbx rcx rdx rsi rdi rbp r8-r15`.
`instructionLimit` is 1 to 1 000 000 (default 1000). Memory data is hex bytes (up to
65536 bytes per area, 16 areas); `readMemory` reads up to 4096 bytes per area.

Response: `{codeSize, result: {status, instructionCount, registers, error}, memory: [...]}`.
A program error such as `instruction_limit_exceeded` is a normal `200` result.

| Status | Error | Meaning |
|---|---|---|
| `400` | `invalid_request` (with `issues`) | The body does not match the schema |
| `400` | `assembly_failed`, `forbidden_directive`, `source_too_large`, `code_too_large`, `empty_output` | The source cannot be assembled (`message` has details) |
| `400` | `setup_failed` (`stage`, `engineError`) | The engine rejected a register, memory area or limit |
| `429` | `rate_limited` | Too many requests |
| `503` | `busy`, `engine_unavailable` | No free run slot (4 at a time), or Docker/engine failure |

### Debug sessions (login required)

A session is one engine container with one loaded program. Limits: 2 per user, 8 in
total, 5 minutes idle, 30 minutes of life. A session belongs to its creator; other
users get `404`.

| Request | Response |
|---|---|
| `POST /api/sessions` (same body as `/api/run` without `readMemory`) | `201 {sessionId, codeSize, state, disassembly}`; the program is loaded but not started |
| `POST /api/sessions/:id/step` `{count?: 1-100}` | `{steps, state}`; stops early on error or finish |
| `POST /api/sessions/:id/run` | `{state}` |
| `GET /api/sessions/:id/state` | `{state, disassembly}`; instructions carry `is_current` |
| `POST /api/sessions/:id/memory` `{address, size}` | `{address, size, data, error}` |
| `DELETE /api/sessions/:id` | `{status: "ok"}` |

`state` is `{status, instructionCount, registers, error}`. Statuses: `ready`,
`running`, `finished`, `limit_exceeded`, `error`. Errors: `404 session_not_found`,
`410 session_lost` (the engine process died; the session is gone),
`429 too_many_user_sessions`, `503 too_many_sessions`.

### My submissions (login required)

- `GET /api/me/submissions` returns the last 50: `{id, task, verdict, instructionCount, createdAt}`.
- `GET /api/me/submissions/:id` returns one with `source` and `details`. Other users'
  submissions give `404`.

## Tasks

Tasks live in the database and are added by migrations (there is no admin interface).
Every task states its register/memory contract in its description. Seeded tasks:
`array-sum`, `array-max` (unsigned comparison), `array-reverse` (in place, memory is
checked), `factorial`.

A test is JSON: `input` has `registers` and `memory` in the `/api/run` format;
`expected` has `registers` and/or `memory` that must hold after the run.

## Security model

- NASM runs in a throwaway container: no network, read-only root, all capabilities
  dropped, 128 MB, 64 processes, 1 MB tmpfs, 5 s timeout. A coarse filter rejects
  `%include`, `incbin`, `%pathsearch`, `%depend` and `%use` first; it is a
  convenience, the container is the boundary.
- The engine runs in a container too: no network, read-only root, no capabilities,
  `no-new-privileges`, 256 MB without swap, 1 CPU, 64 processes. Killing a session
  kills the container by name.
- In `host` mode the engine process gets an empty environment, so it cannot see
  `DATABASE_URL`.
- Passwords are hashed with scrypt (salted, parameters stored with the hash).
  Login tokens are random, only their SHA-256 is stored, and logout revokes them.
- `helmet` headers, per-IP and per-user rate limits, a 256 KB body limit.

## Layout

```text
src/
  index.ts            app, health, /api/run, shutdown
  config.ts           environment (zod)
  db.ts               PostgreSQL pool
  migrate.ts          migration runner
  assemble.ts         NASM in a container
  session-client.ts   engine process client (docker or host)
  session-store.ts    debug sessions: owners, limits, cleanup
  sessions-router.ts  /api/sessions
  run-program.ts      request schema, prepare/run
  judge.ts            submission checking
  tasks-router.ts     /api/tasks, submit
  auth.ts, auth-middleware.ts, auth-router.ts, password.ts   accounts
  me-router.ts        /api/me
  limiter.ts          4 concurrent runs
  rate-limit.ts       request rate limits
migrations/           SQL files, applied in name order, each in a transaction
nasm-image/           Dockerfile and script of the tinyvm-nasm image
tests/                vitest: unit tests and optional e2e
```

## Known limitations

- No email confirmation, password reset or account deletion.
- Debug sessions live in memory and disappear on restart.
- Deployment is not covered: the backend needs the Docker CLI and daemon access,
  which is powerful; behind a reverse proxy set `trust proxy`, `COOKIE_SECURE=true`
  and `CORS_ORIGIN`.
- Any engine container death (including out-of-memory) is reported as
  `503 engine_unavailable`.
- Each submission starts one container per test, so a check takes 1-2 seconds.
- Images are based on `debian:stable-slim` and are not pinned.
