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

Short rules learned building apps for people. New ones are added here.

- **Quote a model id that is not a plain identifier.** An id that starts with a digit (`7Abc1234`) must be
  double-quoted: `FROM "7Abc1234"`; bare, it does not parse. `query_describe_model` prints the `FROM` to copy.
- **Sample data says so.** An app on demo or sample data shows a visible "Sample data — illustrative" banner.
- **Money in the tenant's currency.** Indian tenants: ₹ with lakh and crore (₹4.2 L, ₹1.3 Cr), never `$` or
  4,200,000. Otherwise the tenant's own currency.
- **Rates to one decimal**: 3.1%, not 3.14% or 3%.
- **Curate alerts, do not list them.** Merge metrics that describe the same event into one alert, fold a problem
  that repeats every day into one ongoing issue (since when, for how many days), and rank by impact.

Composed apps: the kit runtime does not draw a sample-data banner or format ₹ yet, and shows rates to two
decimals. Hand-build when an app needs them.
