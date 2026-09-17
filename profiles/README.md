# Model profiles

A profile is the bindings the interview needs for one semantic model: which metric columns to use as measures, which fields are useful cuts, whether an entity picker makes sense, and — optionally — which analysis family applies and which measures play its roles.

Profiles are **tenant data, not repository content**. `design_model_card` derives a draft profile from the semantic layer (`describe_model`, `search_fields`) every time; a reviewed profile is saved per tenant through `design_profile_save` and reused. Nothing under `profiles/examples/` is read by the runtime or the composer; the files are fixtures for tests and a worked example of the shape:

```json
{
  "model": "<id>", "name": "<display name>",
  "reviewed_by": "<who and when>",
  "time": { "column": "timestamp" },
  "entity": { "field": "...", "label": "...", "type": "number", "list": { "label": "...", "rank": "..." } },
  "measures": [ { "id": "...", "column": "...", "label": "...", "format": "number", "good": "up" } ],
  "dimensions": [ { "field": "...", "label": "..." } ],
  "family": { "kind": "ab_test", "arms": { }, "roles": { }, "context": { } }
}
```

`design_model_card` copies a profile's `time`, `entity`, `measures`, `dimensions` and `family` straight into the spec's `bindings`, so the interview never invents a field.
