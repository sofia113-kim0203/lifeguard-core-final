# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

LIFEGUARD Core is a design-first Korean insurance AI consultation platform. The runnable code today is a **Vite + React admin dashboard** (`npm run dev` on port **5173**) backed by **Supabase** (Postgres, Auth, Storage, RPCs). Serverless API handlers live in `api/` but are **not** proxied by Vite — `/api/*` calls return 404 unless you deploy or add a proxy.

### Services

| Service | Port | Start command |
|---------|------|---------------|
| Vite frontend | 5173 | `npm run dev` |
| Supabase API (Kong) | 54321 | `npx supabase start` (requires Docker) |
| Supabase Postgres | 54322 | started with `supabase start` |
| Supabase Studio | 54323 | started with `supabase start` |
| Mailpit (auth emails) | 54324 | started with `supabase start` |

### Prerequisites

- **Node.js 22** (matches `docs/ARCHITECTURE.md`)
- **Docker** — required for local Supabase. Cloud VMs need `fuse-overlayfs` storage driver and `iptables-legacy` (see setup notes in the environment bootstrap).
- **Supabase CLI** — installed as an npm devDependency (`npx supabase`).

### Environment file

Copy `.env.example` to `.env.local` and fill in Supabase credentials:

```bash
cp .env.example .env.local
```

For local Supabase, run `sudo npx supabase status -o env` and set:

- `VITE_SUPABASE_URL` → `API_URL` (e.g. `http://127.0.0.1:54321`)
- `VITE_SUPABASE_ANON_KEY` → `ANON_KEY`

### Supabase local startup (important)

1. **Missing seed file**: `supabase/config.toml` references `supabase/seed.sql`. Create an empty file if absent: `touch supabase/seed.sql`.

2. **Migration 001 ordering bug**: `001_initial_schema.sql` defines `lifeguard_auth_customer_id()` before `customer_profiles` exists, so `supabase start` fails when auto-applying migrations. Workaround for local dev:
   - Temporarily set `[db.migrations] enabled = false` in `supabase/config.toml` (do not commit).
   - Run `sudo npx supabase start`.
   - Apply migrations manually via `docker exec` into `supabase_db_lifeguard-core-final`, reordering the function block in 001 to after `customer_profiles` is created (or use the fixed SQL pattern from the setup agent).

3. **Docker permissions**: On cloud VMs, prefix Supabase CLI with `sudo` or add the user to the `docker` group.

4. **Restore config**: Revert any local `config.toml` migration toggle before committing.

### Standard commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Preview build | `npm run preview` |
| Start Supabase | `sudo npx supabase start` |
| Supabase status / keys | `sudo npx supabase status -o env` |
| Stop Supabase | `sudo npx supabase stop` |

There are **no** lint or test scripts in `package.json`.

### API / Claude routes

`api/claude-grounded-execution.js` and `api/customer-ai-conversation-execution.js` need `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) plus Supabase server vars. They are not started by `npm run dev`; deploy as serverless or mount on a Node server and proxy from Vite if needed.

### Gotchas

- Admin panels require `users.role = 'admin'` in the database.
- Phase 11–13 SQL scripts referenced in docs may be absent from the repo; only Phase 14 scripts and Phase 15 patches exist under `supabase/scripts/`.
- `policyEmbeddingPipeline.js` calls `/api/policy-embedding-pipeline`, which is not implemented in this repo.
