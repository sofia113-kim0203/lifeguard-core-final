# Blood Flow — Single Customer Trace

Customer: **A (QA 8002)** `a247a66f-a597-4ccf-9530-761b82518002`
Observed: 2026-06-27T12:24:08.726Z

## Upstream

Document: exists | Memory: exists | Analysis Job: exists

## Job lifecycle

```
queued (2026-06-27T12:12:41.218832+00:00)

↓ 2s
processing (2026-06-27T12:12:43.26+00:00)

↓ 97s
completed (2026-06-27T12:14:20.184+00:00)
```

Total: 99s

## Factory downstream

- coverage_gap: generated (items=13) — 3s
- underwriting: generated (items=9) — 2s
- recommendation: generated (items=13) — 3s

## Breakpoint

`none:flows` — blood_reaches_factory_panels

Flows through recommendation: **true**

