# Factory Availability Audit

Customer: `a247a66f-a597-4ccf-9530-761b82518002`
Supabase ref: `inwswsruvvzaeioqkelq`
Observed: 2026-06-27T12:22:02.088Z

## Axes

| Axis | State | Records | Latest |
|------|-------|---------|--------|
| memory | **exists** | 1 | 3 |
| coverage_gap | **exists** | 1 | 2026-06-27T12:12:41.218832+00:00 |
| underwriting | **exists** | 0 | 2026-06-27T12:12:41.218832+00:00 |
| recommendation | **exists** | 13 | 2026-06-27T12:12:41.218832+00:00 |

## Summary

- Judgment validation ready: **true**
- Blocker: none

## Interpretation

- **exists** — factory payload present for KEY to use
- **missing** — no payload; KEY judgment test would be inconclusive
- **stale** — payload present but older than 90d
- **unavailable** — probe failed (auth/RLS/error)