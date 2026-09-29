# CLAUDE.md

**Building an app for someone?** Connect the Bicycle Studio MCP and call `studio_guide` first: it is the full,
current guide (data apps, functions, agents, workflows, Detect and Explain). Without it, read
`docs/agents/INDEX.md`. Then follow the routing table at the top of `AGENTS.md`.

**Changing this kit** (recipes, families, runtime, composer, schema)? Read `AGENTS.md`.

## Working with the person (short form; `studio_guide` has the full protocol)

The people asking for apps are usually not engineers. Hold their hand:

1. **Ask first.** Before building, ask what question the app answers, for whom, which numbers matter and what
   "good" looks like. Confirm the model and the time window.
2. **Show sample numbers and ask them to check.** Run the key queries and show a few real figures ("last week:
   1,240 orders, 3.1% refunds"). Ask whether that matches what they know before you build on it.
3. **Stop at the person-only steps.** Publishing, approving a send, sharing, exposing to agents, and a version
   that adds a function import are theirs. Explain what the step changes, give the link, and wait.
4. **Never invent.** No made-up data, fields, causes or explanations. If a query returns nothing or you do not
   know why a number moved, say so.
5. **Hand over properly.** After building, walk them through testing it, list everything you created (app,
   versions, functions, workflows, schedules) and say how to disable or remove each one.
6. **Plain words.** No jargon, ids or stack traces unless they ask.

## Branding

- Every app shows the official Bicycle logo, small: "Built with Bicycle". Use the bundled file. Composed apps draw
  it by default (`theme.builtWithBicycle: false` hides it, only if the person asks); hand-built apps keep
  `<BuiltWithBicycle />` (`template/src/components/`).
- Never recreate, redraw, recolour, stretch or hotlink the logo. Its wordmark is white, so it sits on its own dark
  chip in both themes.
- Never put a customer's logo in an app unless the customer provided the file for it.

## Lessons from real apps

Short rules learned building apps for people, each with its workaround. New ones are added here.

- **Quote a model id that is not a plain identifier**: `FROM "7Abc1234"` for an id that starts with a digit.
  `query_describe_model` prints the `FROM` to copy.
- **Sample data says so.** Composed: `"sampleData": true` shows a "Sample data — illustrative" banner. Hand-built:
  put that banner at the top.
- **Money in the tenant's currency.** Composed: `"currency": "INR"` (ISO 4217) gives ₹12,34,567, ₹4.2 L and
  ₹1.3 Cr. Hand-built: format the same way (`fmtMoney` in the kit's `runtime/src/format.ts`). Never `$` for a
  non-US tenant.
- **Rates to one decimal** (3.1%). The kit does this by default.
- **Curate alerts, do not list them.** Merge metrics for the same event into one alert. Fold a daily repeat into
  one ongoing issue (since when, how many days). Rank by impact.
- **One property per entity per query.** Two or more properties of the same entity (`Store.city, Store.zone`) can
  come back under each other's names, aliased or not. Split them across queries and spot-check the values against
  `query_dimension_values`.
- **Day series with entity fields: use `date_trunc('day', …)` over several days.** A one-day window without it has
  returned two days. Pick the days you need in the app.
- **No `ORDER BY … LIMIT` when metrics span backend queries** (`query_compile` shows more than one line). The top N
  comes back with blank metrics. Fetch without LIMIT, then sort and cut in the app.
- **A blank metric (`—`, `null`) is a row the backend did not return.** For a count, that means 0: treat `null` as
  0 in code, and count rows to find the zeros.
- **Detect and Explain takes the entity, not its property**: dimension `Sku`, not `Sku.name`.
- **A draft version cannot run its queries in the hosted page until it is published.** QA with `npm run dev`
  (`template/`) or a local mock host. Publishing stays the person's call.
- **Hand-built apps read blobs and the cache with `src/studio/store.ts`.** Declare them in the manifest first.
- **Plot colours: resolve tokens first.** A `fill` function that returns `var(--bda-…)` is read as a category,
  not a colour. Use `token('--bda-…')` from `components/Chart.tsx`.
- **Keep native roles.** A `<button role="cell">` stops being a button for tests and screen readers. Put the
  `<button>` inside the cell.
- **Keep blobs small** (compact CSV or JSON, a few KB): `design_blob_upload` sends the content inline.
