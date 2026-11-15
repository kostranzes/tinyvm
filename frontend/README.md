# TinyVM Frontend

Browser client for the TinyVM platform: sign in, read tasks, write NASM code in an
editor, run it, step through it in a debugger, submit solutions, review history and
talk in the support chat. The HTTP API it talks to is documented in
[backend/README.md](../backend/README.md), the chat protocol is in the same file.

React 19, TypeScript, Vite, React Router, CodeMirror 6. Plain CSS, no UI library, one
dark "retro terminal" theme (green on black, amber values).

## Requirements

- Node.js (a current LTS release), npm
- A running backend: HTTP on `http://localhost:3000`, chat on `ws://localhost:8080`

## Run

```bash
cd frontend
npm install
npm run dev
```

The dev server must use port **5173**: the backend allows exactly one browser origin
(`CORS_ORIGIN`, default `http://localhost:5173`) for HTTP and for the chat handshake.
`vite.config.ts` sets `strictPort: true`, so Vite fails instead of silently moving to
another port.

Open the site as `http://localhost:5173`, not `http://127.0.0.1:5173`. A different
origin is rejected and the browser reports it like an unreachable server.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Backend HTTP address. Requests go to it directly, there is no Vite proxy. |
| `VITE_CHAT_URL` | `ws://localhost:8080` | Chat WebSocket address |

Variables are read at build time. Restart `npm run dev` after changing `.env`.

`localhost:5173` and `localhost:3000` are the same *site* (ports do not count), so the
`SameSite=Lax` session cookie works. Every HTTP request uses `credentials: 'include'`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type check (`tsc -b`) and production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npx tsc -b` | Type check only |

There are no frontend tests. A change is checked by `tsc`, `lint` and by hand in the
browser.

## Pages

| Route | Page | Needs login |
|---|---|---|
| `/` | Task list | no |
| `/tasks/:slug` | Task: description, workspace (editor, registers, memory, output, log), example tests | reading no, run/debug/submit yes |
| `/login`, `/register` | One page, `AuthPage`, with a `mode` prop | no |
| `/submissions` | Last 50 submissions | yes |
| `/submissions/:id` | One submission: code and details | yes |
| `/support` | Support chat | no (guests type a name) |

## Layout

```text
src/
  main.tsx                 entry point
  App.tsx                  router and providers
  index.css                all styles (CSS variables, scan lines, theme)
  api.ts                   fetch wrapper, API types, ApiError, describeError
  auth/
    auth-context.ts        context and useAuth hook
    AuthProvider.tsx       asks /api/auth/me on start, login/register/logout
  chat/
    useChat.ts             WebSocket connection and chat state
  components/
    Layout.tsx             header and <Outlet>; the task page uses a wide <main>
    Workspace.tsx          toolbar, three columns, output and log; owns run, debug and submit
    InputsPanel.tsx        initial registers, memory and instruction limit
    RegistersPanel.tsx     registers by group, rip, flags from rflags
    MemoryPanel.tsx        memory address/size, IP and SP buttons, hex dump with ASCII
    VerdictView.tsx        verdict of a submission
    inputs.ts              input state and the /api/run request builder
    disasm.ts              disassembly parser (toRows)
    format.ts              dumpRows for the memory dump
    verdict-text.ts        verdict labels and formatDate
  editor/
    CodeEditor.tsx         CodeMirror 6 wrapper and theme
    nasm.ts                small NASM highlighter (StreamLanguage)
  pages/                   one file per route
```

## How it works

- **API client.** `api.ts` has one `request` function. Network failures become
  `ApiError` with `status` 0 and code `network_error`; HTTP errors carry the backend
  `error` code and the whole body. `describeError` turns a code into text for the user.
  Verdicts of submissions are HTTP 200 results, not errors.
- **Auth.** `AuthProvider` calls `/api/auth/me` once. A 401 or an unreachable server
  means "not signed in". Buttons that need a login are replaced by a link to `/login`.
  Signing out in another tab is not noticed until a request fails with 401.
- **Workspace.** The task page has a toolbar (Run, Debug, Step, Step x10, To the end,
  Reset, Submit) and three columns: editor with the disassembly below it, registers,
  memory. Below are the output panel (run result or verdict) and an event log.
  `Workspace` keeps all state, so the same initial registers, memory and limit feed
  both Run and Debug.
- **Editor.** CodeMirror lives outside React: `EditorView` is created once in an effect
  and destroyed on unmount. The initial text is read only on creation, so `TaskView`
  gets `key={slug}` and the workspace is recreated for another task. Colors come from
  CSS variables of the page, token colors from a `HighlightStyle` in `CodeEditor.tsx`.
- **Debugger.** "Debug" creates a session. After every action the state is requested
  again, because `is_current` in the disassembly comes only from
  `GET /api/sessions/:id/state`. Registers that changed since the previous state are
  highlighted. The memory area you last read is re-read after each step and after a
  run. The "SP" button reads an area that fits into the stack, because the initial
  `rsp` (`0x210000`) is already the end of it. The session is deleted on "Reset" and
  when the page is left; if the tab is just closed, the server removes it after
  5 minutes of idleness.
- **Numbers.** Register values and addresses are strings (`"10"`, `"0x110000"`), as the
  backend requires.
- **Chat.** `useChat` creates the socket in the "Join" handler (not in an effect), sends
  `join`, and keeps messages, online users and typing users in state. The typing
  indicator follows the lab requirement: `typing: true` is repeated at most every
  1.5 s while the user types, and `false` is sent 2 s after the last keystroke;
  receivers also drop a name after 4 s as a fallback. Private messages use
  `/pm Name text`; the name is matched against the online list (longest match, so names
  with spaces work), and `/pm` text does not trigger the typing indicator. Message text
  is rendered as plain text, never as HTML.

## Known limitations

- Code is not saved: a reload brings back the starter code.
- A verdict stays on screen after the code is edited and refers to the code that was
  submitted.
- The task list does not show which tasks are solved.
- The history shows the last 50 submissions, without paging.
- The text for `invalid_request` in `describeError` speaks about email and password;
  `Workspace` replaces it with its own text.
- Only a few error codes have their own text, the rest show `status: code`.
- The chat does not reconnect by itself; "Reconnect" re-enters with the same name.
- `npm audit` reports moderate vulnerabilities in dev dependencies; they have not been
  reviewed.