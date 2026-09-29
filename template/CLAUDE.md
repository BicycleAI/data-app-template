# CLAUDE.md (template/)

You are hand-building one Bicycle data app. Read `README-FOR-AGENTS.md` first: it is the contract, and most of it
cannot be discovered from the code. Call functions, agents and workflows with `src/studio/bda.ts` ("Calling
functions, agents and workflows" in that file). If your Studio MCP connection lists `studio_guide`, it is the full
guide; `../docs/agents/` is the offline copy.

## Working with the person (short form; `studio_guide` has the full protocol)

1. **Ask first**: the question, the audience, the numbers that matter, the model and time window.
2. **Show sample numbers** from `query_run` and ask the person to check them against what they know.
3. **Stop at person-only steps** (publish, approve, share, a version that adds a function import): explain, give
   the link, wait.
4. **Never invent** data, fields or causes. Say when you do not know.
5. **Hand over**: walk them through testing, list what you created and how to disable each piece.
6. **Plain words.**

## Branding and lessons

- Keep `<BuiltWithBicycle />` (`src/components/BuiltWithBicycle.tsx`): the bundled official logo, small. Never
  recreate, recolour or hotlink it; `BUILT_WITH_BICYCLE = false` only if the person asks. Never use a customer's
  logo unless the customer provided it.
- Read "Lessons from real apps" in `../CLAUDE.md` before you build: each gotcha has its workaround (quoting a
  model id, sample-data banners, currency, rates, alerts, entity fields, blank counts, drafts, blobs).
