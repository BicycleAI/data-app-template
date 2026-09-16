# AGENTS.md — data-app-kit

This file is for agents changing this repository. If you are designing a data app for a user, stop: load `skills/ask-show-ship/SKILL.md` and use the `design_*` tools on the bicycle-studio MCP instead.

## What this repo is

Recipes + templates + a data-driven runtime + the composer that turns a DataAppSpec into a published Bicycle data app. Two paths exist:

- **compose** (default): `kit compose spec.json` → `bundle.zip`. No per-app code. The runtime is built once; each app is that bundle with `window.__DATA_APP_SPEC = {...}` prepended.
- **hand-build** (escape hatch): `template/` is the original boilerplate for an engineer writing React by hand.

**This repository owns how an app is created; the service owns who may create it and where it is stored.** The service (`bicycle-studio-api`) reads this kit's JSON — schema, recipes, templates, datasets — and renders it. It holds no knowledge of what a recipe, a family or a query is. Adding a family or changing a query must therefore be a change *here* and a kit release, never a code change there.

The one piece of machinery that exists in both languages is the dataset renderer (`compose/datasets.mjs` ↔ the service's port of it): a substitution engine with no product knowledge. `evals/manifest.golden.json` pins its output so the two cannot drift.

## Invariants — never change without a schema version bump

- `spec/dataapp-spec.v1.schema.json` is a public contract read by the MCP and the skill.
- The runtime emits exactly `app.js` and `app.css`; the host loads those names (`runtime/scripts/assert-dist.mjs` enforces it).
- **No SQL in code.** Every query is declared in `recipes/datasets.json` (core) or `families/<kind>/datasets.json`, and rendered by `compose/datasets.mjs`. That renderer may learn new substitutions; it must never learn what a dataset means.
- Query ids are derived, never authored. Core: `entity_list` (if entity), `totals`, `by_time`, `by_dimension` (if dimensions), `by_time_<dim>` (one per `trend.by`, max 3). `ab_test` family: `entity_list`, `experiment_meta`, `arm_totals`, `segments`, `daily_trend`. Recipes read only those (`runtime/src/spec.ts` → `QUERY`).
- The kit is model-agnostic. Nothing under `recipes/`, `templates/core/`, `runtime/` or `compose/` may name a field, metric column or model id. Model bindings live in tenant profiles (see `profiles/README.md`); `profiles/examples/` holds test fixtures only.
- Components use `--bda-*` tokens only; colour values live in `runtime/src/theme.css`, both palettes plus the `data-accent` variants.
- Semantic SQL only: metrics are columns, `FROM <model>`, a bounded time range, no JOINs, no OR, no semicolons, ≤ 8000 chars.
- A spec composes to ≤ 32 queries; core specs use 2–6, `ab_test` specs use 5.

## Widgets never blank

1. Layout renders on first paint and never unmounts — header, controls, cards, headings appear immediately; only the inside of a card waits.
2. Each widget waits for ITS OWN query. Never gate `App` (or a chrome) on `data === undefined`; never early-return "Loading…" from a component that owns layout.
3. Skeletons sized to what is coming (`SkeletonChart` with the chart's height, `SkeletonMetric`, `SkeletonTable` with a row count), `aria-busy="true"` on the card while pending.
4. When a control changes (entity, measure, grain, dimensions, variant, heatmap axes), the widget keeps its previous rows visible with a quiet refreshing state and swaps when new rows arrive — skeleton only on first load or when the shape changes (different dimension). Use TanStack Query `placeholderData: keepPreviousData` in the dataset hooks; expose `isFetching` → class `kit-card--refreshing` (subtle, respects prefers-reduced-motion).
5. Errors are per widget: the card shows what failed (BdaError code + message) and a Retry button (refetch); the rest of the app stays usable.

## Layout

```
spec/             schema (v2) + examples: hotel-booking-health (core), seti-report/explorer/scorecard (ab_test)
recipes/<id>/     core recipes — recipe.json (catalogue entry) + Render.tsx; work on any model
recipes/datasets.json        the core queries, declared
families/<kind>/datasets.json  a family's queries (set `replaces_core` when it reads the model differently)
families/<kind>/  an analysis family: family.json (derived metrics, roles, detection hints) + recipes/<id>/
templates/core/   recipe lists per persona for any model; templates/<family>/ override per family
profiles/         README + example tenant profiles (fixtures only; real profiles live in the API)
runtime/          the data-driven app: spec.ts, core.ts (generic maths), analysis.ts (ab_test maths), data.ts, ui.tsx, chrome/, App.tsx
compose/          validate → resolve → render datasets → bundle → upload; `cli.mjs` is `kit`
                  datasets.mjs is the renderer; manifest.mjs holds no SQL
skills/           SKILL.md — the interview; published by the MCP as a prompt and resource
evals/            golden manifests + transcript fixtures
template/         hand-build starter (do not add features here)
```

## Adding a recipe (core)

1. `mkdir recipes/<id>`; write `recipe.json` — `id`, `family: "core"`, `name`, `answers` (the question in the user's words), `shape` (sentence grammar with `[slots]`), `needs` (core datasets), `slots` (extra queries; keep 0), `fits` (personas), `bind` (each binding: `type` measure|measures|dim|dims|int|enum, `default` or `"ui"`), `caveat`.
2. `Render.tsx` exporting `Render({ spec, core, bind }: CoreProps)`. Read shared state through `useUi()` (`measure`, `dims`, heatmap axes), data through `core.totals`, `core.series`, `core.slicesAt(dims)`, `core.seriesBy`. Format with `fmtMeasure(value, measure.format)`. Chart with `components/Chart` and Plot; colours via `measureColor(spec, id)` / `var(--bda-*)`.
3. Register it in `CORE` in `runtime/src/App.tsx` and add its sentence to the grammar table in `SKILL.md`.

## Adding a family

A family is for data with a shape the core cannot express (arms vs control, funnel steps, cohorts).

1. `families/<kind>/family.json` — derived metrics, required roles, detection hints for `design_model_card`.
2. `families/<kind>/datasets.json` — the queries it needs, declared. Set `replaces_core: true` when the family reads the model differently rather than additionally.
3. `families/<kind>/recipes/<id>/` — its recipes (props `{ spec, data, bind }`).
4. `templates/<kind>/*.json` — its templates, each with its own `controls` defaults.
5. Extend the `family` `oneOf` in the schema; add the dataset hook in `runtime/src/data.ts` and register recipes in `runtime/src/App.tsx`.
6. `node evals/run.mjs --update` to pin the new SQL, and commit the golden.

No step touches the service.
4. Put it in a template only if a persona needs it by default.
5. `npm run check`.

## Before you open a PR

```
npm run check     # typecheck, validate spec/examples, dry-run compose
npm run build     # rebuild runtime/dist (commit it: the Python toolset vendors it)
node evals/run.mjs
```

CI composes every example against the sandbox tenant; a version landing `invalid` fails the build.

## Do not

- Add a charting library, a CDN script, storage, or a network call — the host CSP blocks them and validation fails.
- Read `window.location`, `localStorage` or cookies in the runtime; it runs in an opaque-origin frame.
- Put tenant data, tokens or signed URLs in fixtures or specs.
- Edit `template/` to add features; features go in recipes.
- Change query ids or parameter names (`entity`, `from`, `to`); the runtime and the Python port depend on them.
