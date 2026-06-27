# SERVICE_ROLE Infra Audit

Observed: 2026-06-27T12:06:23.298Z
Staging ref: `inwswsruvvzaeioqkelq`
Preview: `https://lifeguard-core-final-f2dr3qccw-70sofia113-1918s-projects.vercel.app`

## Local env fingerprints

```json
[
  {
    "label": "local_merged_env",
    "supabase_url_ref": "inwswsruvvzaeioqkelq",
    "service_role": {
      "set": true,
      "prefix12": "eyJhbGciOiJI",
      "suffix8": "289zpt4k",
      "len": 219,
      "jwt_ref": "inwswsruvvzaeioqkelq",
      "jwt_role": "service_role"
    },
    "pair_status": "paired",
    "paired_with_staging": true,
    "vite_supabase_url_ref": "inwswsruvvzaeioqkelq",
    "vite_server_mismatch": false,
    "aliases": {
      "SERVICE_ROLE_KEY_set": true,
      "SUPABASE_SERVICE_ROLE_KEY_set": true
    }
  },
  {
    "label": "supabase_url_primary",
    "supabase_url_ref": "inwswsruvvzaeioqkelq",
    "service_role": {
      "set": true,
      "prefix12": "eyJhbGciOiJI",
      "suffix8": "289zpt4k",
      "len": 219,
      "jwt_ref": "inwswsruvvzaeioqkelq",
      "jwt_role": "service_role"
    },
    "pair_status": "paired",
    "paired_with_staging": true,
    "vite_supabase_url_ref": "inwswsruvvzaeioqkelq",
    "vite_server_mismatch": false,
    "aliases": {
      "SERVICE_ROLE_KEY_set": true,
      "SUPABASE_SERVICE_ROLE_KEY_set": true
    }
  }
]
```

## Preview serverless probe

```json
{
  "status": 200,
  "payload": {
    "ok": true,
    "probe": "preview_serverless_env_binding",
    "bindings": {
      "SUPABASE_URL": {
        "set": true,
        "ref": "inwswsruvvzaeioqkelq"
      },
      "SUPABASE_ANON_KEY": {
        "set": true,
        "len": 208
      },
      "VITE_SUPABASE_URL": {
        "set": true,
        "ref": "fhvlxcguvjvtftttfrix"
      },
      "VITE_SUPABASE_ANON_KEY": {
        "set": true,
        "len": 46
      }
    },
    "serverless_alias_ready": true
  }
}
```

## Verdict

- **note**: Live Preview probe lacks service_role_pairing — using trigger-audit Invalid API key as corroboration.
- **break**: Deployed Preview: SUPABASE_URL=staging but VITE_SUPABASE_URL=production residual.
- **break**: Job-insert APIs on deployed Preview returned Invalid API key (SERVICE_ROLE likely wrong for staging URL).
- **ok**: Vercel env-run simulated serverless: pair_status=paired, fingerprint prefix12=eyJhbGciOiJI suffix8=289zpt4k, jwt_ref=inwswsruvvzaeioqkelq.

**infra_break_likely:** true

