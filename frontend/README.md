# TinyVM Frontend

Browser client for the TinyVM platform: sign in, read tasks, write NASM code in an
editor, run it, step through it in a debugger, submit solutions and review history.
The HTTP API it talks to is documented in [backend/README.md](../backend/README.md).

React 19, TypeScript, Vite, React Router, CodeMirror 6. Plain CSS, one dark theme,
no UI library.

## Requirements

- Node.js (a current LTS release), npm
- A running backend on `http://localhost:3000` (see the backend README)

## Run

```bash
cd frontend
npm install
npm run dev
```

The dev server must use port **5173**: the backend allows exactly one browser origin
(`CORS_ORIGIN`, default `http://localhost:5173`). `vite.config.ts` sets
`strictPort: true`, so Vite fails instead of silently moving to another port.

Open the site as `http://localhost:5173`, not `http://127.0.0.1:5173`. A different
origin is rejected by CORS and the browser reports it like an unreachable server.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Backend address. Requests go to it directly, there is no Vite proxy. |

Variables are read at build time. Restart `npm run dev` after changing `.env`.

`localhost:5173` and `localhost:3000` are the same *site* (ports do not count), so the
`SameSite=Lax` session cookie works. Every request uses `credentials: 'include'`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type check (`tsc -b`) and production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npx tsc -b` | Type check only |

There are no frontend tests yet. A change is checked by `tsc`, `lint` and by hand in
the browser.

## Pages

| Route | Page | Needs login |
|---|---|---|
| `/` | Task list | no |
| `/tasks/:slug` | Task: description, editor, run panel, debugger, submit, example tests | reading no, run/debug/submit yes |
| `/login`, `/register` | One page, `AuthPage`, with a `mode` prop | no |
| `/submissions` | Last 50 submissions | yes |
| `/submissions/:id` | One submission: code and details | yes |

## Layout

```text
src/
  main.tsx                 entry point
  App.tsx                  router and providers
  index.css                all styles (CSS variables, one dark theme)
  api.ts                   fetch wrapper, API types, ApiError, describeError
  auth/
    auth-context.ts        context and useAuth hook
    AuthProvider.tsx       asks /api/auth/me on start, login/register/logout
  components/
    Layout.tsx             header and <Outlet>
    RunPanel.tsx           inputs for registers/memory/limit, run, start a debug session
    DebugView.tsx          disassembly, registers, stepping, memory viewer
    SubmitPanel.tsx        submit button and verdict
    verdict-text.ts        verdict labels and formatDate
    format.ts              hexDump
  editor/
    CodeEditor.tsx         CodeMirror 6 wrapper
    nasm.ts                small NASM highlighter (StreamLanguage)
  pages/                   one file per route
```

## How it works

- **API client.** `api.ts` has one `request` function. Network failures become
  `ApiError` with `status` 0 and code `network_error`; HTTP errors carry the backend
  `error` code and the whole body. `describeError` turns a code into text for the user.
  Verdicts of submissions are HTTP 200 results, not errors.
- **Auth.** `AuthProvider` calls `/api/auth/me` once. A 401 or an unreachable server
  means "not signed in". Pages that need a login show a link to `/login` instead of
  sending a request that would fail.
- **Editor.** CodeMirror lives outside React: `EditorView` is created once in an effect
  and destroyed on unmount. The initial text is read only on creation, so `TaskView`
  gets `key={slug}` and the editor is recreated for another task.
- **Debugger.** "Debug" creates a session with the same registers, memory and limit as
  "Run". After every action the state is requested again, because `is_current` in the
  disassembly comes only from `GET /api/sessions/:id/state`. Registers that changed
  since the previous state are highlighted. The memory area you last read is re-read
  after each step. The session is deleted on "Close" and when the page is left; if the
  tab is just closed, the server removes it after 5 minutes of idleness.
- **Numbers.** Register values and addresses are strings (`"10"`, `"0x110000"`), as the
  backend requires.

## Known limitations

- Code is not saved: a reload brings back the starter code.
- A verdict stays on screen after the code is edited and refers to the code that was
  submitted.
- The task list does not show which tasks are solved.
- The history shows the last 50 submissions, without paging.
- The text for `invalid_request` in `describeError` speaks about email and password;
  the run panel replaces it with its own text.
- Only a few error codes have their own text, the rest show `status: code`.
- `npm audit` reports moderate vulnerabilities in dev dependencies; they have not been
  reviewed.