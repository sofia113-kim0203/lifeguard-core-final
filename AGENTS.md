# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

LIFEGUARD Core is a Korean insurance AI consultation platform (React + Vite frontend, Supabase backend). See `README.md` and `package.json` scripts for standard commands.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Vite dev server | `npm run dev` | 5173 | Frontend only; does **not** serve `/api/*` routes |
| Local Supabase | `sg docker -c "npx supabase start"` | API 54321, DB 54322, Studio 54323 | Requires Docker daemon (see below) |
| Vercel dev (optional) | `vercel dev` | varies | Needed for `/api/claude-*` serverless routes |

### Docker in Cloud Agent VMs

Docker is not pre-installed. The daemon must be started manually in each fresh VM:

```bash
sudo dockerd > /tmp/dockerd.log 2>&1 &
```

Use `sg docker -c "..."` (user is in the `docker` group) for all Docker/Supabase CLI commands.

### Local Supabase setup caveat

`supabase start` applies migrations statement-by-statement. Migration `001_initial_schema.sql` defines `lifeguard_auth_customer_id()` **before** `customer_profiles` exists, so `supabase start` fails on a fresh DB.

**Workaround (do not modify migration files):**

1. Temporarily move `supabase/migrations/*.sql` out of the folder.
2. Run `sg docker -c "npx supabase start"` (bare stack).
3. Apply migrations via `docker exec` psql — for `001`, move the `lifeguard_auth_customer_id()` function block to after the `customer_profiles` table is created (same content, reordered).
4. Apply `002`–`020` in order via `docker exec -i supabase_db_lifeguard-core-final psql -U postgres -d postgres -v ON_ERROR_STOP=1 < migration.sql`.
5. Restore migration files to `supabase/migrations/`.

Get local keys: `sg docker -c "npx supabase status -o env"` → copy `API_URL` and `ANON_KEY` into `.env.local`.

### Environment file

Copy `.env.example` to `.env.local` (gitignored). Minimum for UI + auth:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<from supabase status -o env>
```

Integration tests also need `SUPABASE_SERVICE_ROLE_KEY` from the same command.

### Lint / test / build

| Task | Command | Notes |
|------|---------|-------|
| Lint | *(none configured)* | No ESLint/Prettier in repo |
| Unit tests | `npm run test:phase22d-step4-unit` | No Supabase required |
| Smoke test | `npm run test:phase23-step1c-smoke` | Requires local Supabase + `SERVICE_ROLE_KEY` |
| Build | `npm run build` | Output in `dist/` |
| Dev | `npm run dev` | Binds `0.0.0.0:5173` |

### External API keys (optional)

Full AI/RAG/OCR flows need `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `CLOVA_OCR_*` secrets plus deployed Edge Functions. These are **not** required for UI, auth, or unit tests.
