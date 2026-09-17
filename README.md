# Data app kit

The way Bicycle data apps are created. Two paths exist: **compose from a spec** (default—no code required) or **hand-build from `template/`** (when a recipe cannot express what you need).

## Two ways to build a data app

**Compose from a spec (recommended).** Load `skills/ask-show-ship/SKILL.md`, interview a user to produce a `DataAppSpec`, validate and compose it with `kit compose` or the `design_*` tools on the bicycle-studio MCP. The runtime reads the spec; no per-app code.

**Hand-build from `template/`** (escape hatch). Engineers who need something the recipes cannot express start here. Rules and patterns are in `template/README-FOR-AGENTS.md`.

## Repository layout

```
spec/             dataapp-spec.v2.schema.json + examples (retail-orders-health, checkout-test-report)
recipes/          core recipes: recipe.json + Render.tsx (work on any model)
recipes/datasets.json         core queries, declared (no SQL in code)
families/         analysis families (ab_test): family.json + recipes + datasets.json
families/*/datasets.json      queries for each family
templates/        recipe lists per persona (core/ + family overrides)
profiles/         example tenant profiles (fixtures only; real profiles in the API)
runtime/          data-driven app: spec.ts, core.ts, analysis.ts, ui.tsx, App.tsx
runtime/dist/     build output: app.js, app.css (vendored by bicycle-studio-api)
compose/          CLI tool: validate, resolve, render, bundle
compose/cli.mjs   kit commands: validate, compose, brief, manifest, extract, catalogue
evals/            golden manifests + transcript fixtures
skills/           ask-show-ship SKILL.md (published by MCP as prompt + resource)
template/         hand-build starter (React boilerplate; see template/README-FOR-AGENTS.md)
scripts/          no-real-ids.sh (guards against real customer data)
```

## kit CLI commands

- `kit validate <spec.json>...` — schema + semantic checks
- `kit compose <spec.json> [--out DIR]` — produce bundle.zip
- `kit brief <spec.json> [--out DIR]` — derive exec brief spec and compose it
- `kit manifest <spec.json>` — print the derived bda.manifest.json
- `kit extract <app.js>` — print the spec embedded in a bundle
- `kit catalogue` — list recipes, templates, families as JSON

## npm scripts (root)

```bash
npm run build      # typecheck + vite build runtime/dist + assert output names
npm run typecheck  # tsc --noEmit
npm run check      # typecheck + validate specs + dry-run compose one example
npm run compose    # alias for node compose/cli.mjs
npm run dev        # vite watch (runtime only, for development)
```

## How bicycle-studio-api vendors this kit

The API reads this repository's release tag (e.g. `v1.0.0`) and:

1. Copies `runtime/dist/` (app.js, app.css) into its bundles
2. Flattens `recipes/` and `families/*/` into JSON catalogues
3. Embeds `spec/dataapp-spec.v2.schema.json`, templates, and `skills/ask-show-ship/SKILL.md`
4. Uses `compose/datasets.mjs` (the dataset renderer) to substitute query parameters

**Release rule:** Tag the kit repo → re-vendor into the API from that tag → publish the MCP skill from the same tag. They are one release unit.

## Invariants and rules

Before changing anything here, read `AGENTS.md` for the full rules. Quick version:

- The spec is a public contract (`spec/dataapp-spec.v2.schema.json`).
- No SQL in code — queries live in `recipes/datasets.json` and `families/*/datasets.json`.
- Model-agnostic — nothing in recipes, templates, runtime, or compose may name a model, metric, or dimension.
- Public repo — no real customer data anywhere (`scripts/no-real-ids.sh` guards it).
- Query ids are derived, not authored. Core: `entity_list`, `totals`, `by_time`, `by_dimension`, `by_time_<dim>`. `ab_test`: `entity_list`, `experiment_meta`, `arm_totals`, `segments`, `daily_trend`.
- The runtime emits exactly `app.js` and `app.css` (other names cause validation to fail).
- Components use `--bda-*` CSS tokens only; colours live in `runtime/src/theme.css`.
- Specs compose to ≤32 queries. Core specs use 2–6; `ab_test` specs use 5.

See `AGENTS.md` for the full list and details.

## Running checks locally

```bash
# At the root
npm ci
npm run build
npm run check
node evals/run.mjs
scripts/no-real-ids.sh

# For the hand-build starter
cd template
npm ci
npm run build
npm test
```
