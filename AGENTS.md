# AGENTS.md

Guidance for cloud agents working in the LIFEGUARD Core repository.

## Project overview

LIFEGUARD Core (`lifeguard-core`) is a Vite + React 19 SPA backed by Supabase (Postgres, Auth, Storage, Edge Functions). Serverless API handlers live in `api/` with shared logic in `server/`.

## Cursor Cloud specific instructions

### Services

| Service | Command | Port | Required for |
|---------|---------|------|--------------|
| Vite dev server | `npm run dev` | 5173 | Frontend development |
| Supabase (remote) | — | — | Auth, DB, storage, workers |
| Supabase local (`supabase start`) | Requires Docker | 54321/54322 | Optional; Docker is not available in Cloud Agent VMs |

There is no ESLint or Prettier script in `package.json`. Linting is not configured for this repo.

### Environment variables

Copy `.env.example` to `.env.local` (gitignored). Required for the SPA:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If these secrets are not pre-provisioned, fetch them with the Supabase CLI (requires `SUPABASE_ACCESS_TOKEN`):

```bash
npx supabase projects list
npx supabase projects api-keys --project-ref <lifeguard-core-ref>
```

The `lifeguard-core` project ref is `fhvlxcguvjvtftttfrix` (URL: `https://fhvlxcguvjvtftttfrix.supabase.co`).

Server-side tests and workers additionally need `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`), `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`.

### Common commands

```bash
npm install
npm run dev                    # SPA at http://127.0.0.1:5173
npm run build                  # Production build → dist/
npm run preview                # Serve dist/ on :5173
npm run test:phase22d-step4-unit   # Unit tests (no external services)
npm run test:phase22d-step4        # Integration test (needs Supabase + keys)
npm run test:phase23-step1c-smoke    # Memory-builder worker smoke (needs Supabase)
```

### Gotchas

- Vite does **not** proxy `/api/*`. The three routes in `api/` must be deployed separately (e.g. Vercel) or imported directly in Node test scripts.
- Without `.env.local`, the app still renders but Supabase auth/DB calls fail; check the browser console for the warning from `src/lib/supabase.js`.
- Integration and smoke tests hit the remote Supabase project and external AI APIs; they are not part of the default dev loop.
- Long-running dev servers should be started in a tmux session (e.g. session name `vite-dev-server`).
