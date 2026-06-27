# Blood Flow Audit v2

Observed: 2026-06-27T09:45:56.718Z
Auth: service_role

## Comparison

| Customer | Document | Memory | Analysis Job | Gap | UW | Rec | Breakpoint |
|----------|----------|--------|--------------|-----|----|----|------------|
| A | exists | exists | missing | skip | skip | skip | analysis_job:missing |
| B | exists | missing | missing | skip | skip | skip | memory:missing |
| C | missing | missing | missing | skip | skip | skip | document:missing |

## Failure mode

- **systemic** — All audited customers have zero analysis_jobs — likely system/trigger path issue.

## Customer IDs

- A: `a247a66f-a597-4ccf-9530-761b82518002`
- B: `b421626e-2dda-49e0-93ed-da34c658a3d3`
- C: `d845f1a1-54d4-41e4-a3f1-c77dedc7ee81`