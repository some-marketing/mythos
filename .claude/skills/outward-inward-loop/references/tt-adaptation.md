# `/tt` adaptation reference

| `/tt` phase | outward-inward concern | minimum receipt |
| --- | --- | --- |
| ORIENT | source count, purpose, scope, stop conditions | normalized source manifest |
| TICK | source retrieval | per-source retrieval receipt and hash |
| OBSERVE | raw extraction | atomic observation id |
| TEXT | provenance normalization | claim-to-source links |
| RESEARCH | corroboration and falsifiers | independent source or explicit gap |
| TOCK | comparison | convergence/conflict record |
| IMPROVE | internal mapping | path plus current-state evidence |
| SHIP | gated proposal or patch | reviewer disposition and diff/test evidence |
| SCHEDULE | next attention | trigger and owner, never activation |

## Source envelope

```json
{
  "source_id": "src-01",
  "kind": "file|url|note|framework|artifact",
  "locator": "provider-specific locator",
  "authority": "operator|official|secondary|unknown",
  "retrieved_at": "ISO-8601 UTC",
  "content_sha256": "hash of retrieved bytes or normalized text",
  "access": "read-only",
  "limitations": []
}
```

The envelope is provenance, not proof. A high-authority source can still be stale or wrong; the comparison phase must preserve that possibility.
