# Changelog

All notable changes to the data-app kit (this repository: spec, recipes, runtime, composer, skills and the
hand-build `template/`). Versions follow `RELEASING.md`: tags are `kit-vMAJOR.MINOR.PATCH`, and the version in
`package.json` and `template/package.json` matches the tag.

## Unreleased

## 1.2.0 (proposed tag `kit-v1.2.0`)

Additive: four optional spec fields (`theme.builtWithBicycle` and `showSources` default `true`, `currency`
default `USD`, `sampleData` default `false`); no manifest change. Visible: percent and rate measures show one
decimal, every card has a "Source" link, and a failed query shows "Couldn't load" instead of a number.

### Added
- "Built with Bicycle": the official logo, bundled (`runtime/src/assets/`, `template/src/assets/`) and inlined
  into `app.js` as a `data:` URI, so it renders under the frame's CSP and in the snapshot renderer offline. Composed
  apps show it small in the chrome's footer (it replaces the "Powered by Bicycle AI" text); the new
  `theme.builtWithBicycle` (default `true`) hides it. The template has `<BuiltWithBicycle />` in its sample app,
  with one switch (`BUILT_WITH_BICYCLE`). The logo's wordmark is white, so it sits on a dark chip
  (`--bda-brand-chip`) in both themes. `evals/brand.test.tsx` and the template's test pin the file's bytes.
- `CLAUDE.md`: "Branding" (use the bundled logo; never recreate or recolour it; no customer logo unless the
  customer provided it) and "Lessons from real apps" (quote a model id that starts with a digit; sample-data
  banner; ₹ with lakh/crore for Indian tenants; rates to one decimal; curate alerts). The same in
  `docs/agents/02-data-apps.md`, `template/CLAUDE.md`, `template/README-FOR-AGENTS.md` and the ask-show-ship skill.
- `skills/semantic-query/SKILL.md`: a model id that is not a plain identifier is double-quoted, `FROM "7Abc1234"`.
- Spec `currency` (ISO 4217, default `USD`): `format: currency` measures show the tenant's currency. `INR` reads
  the Indian way, ₹12,34,567 in full and ₹4.2 L / ₹1.3 Cr compact (`fmtMoney`, `setCurrency` in
  `runtime/src/format.ts`). The ab_test family's money (NICPD) follows it too.
- Spec `sampleData` (default `false`): a "Sample data — illustrative" banner at the top of the Report and
  Explorer chromes (`chrome/SampleBanner.tsx`). Every `spec/examples/` spec sets it.
- `template/src/studio/store.ts`: the runtime's blob and cache client, so a hand-built app can read declared
  blobs. `README-FOR-AGENTS.md` has "Blobs and the cache", and `evals/templateParity.test.tsx` keeps the two
  copies identical.
- "Source" on every KPI, chart and table (every number shows its source): the provenance affordance is now a small
  visible "Source" link opening a side panel with the panel's title, the date window, the model and declared query,
  the exact semantic SQL, the measures' definitions, the row count and first rows of the last result (read from
  the query cache, never a new fetch) and a CSV download. The summary's `[n]` citations open the same panel. Spec
  `showSources` (default `true`) turns it off.
- `EmptyState`: an answer with no rows reads "No data for this window" (trend, breakdown, heatmap, cumulative
  trend), distinct from a failure.
- "Lessons from real apps" gains the gotchas from a real demo app, each with its workaround: one property per
  entity per query, `date_trunc` for day series with entity fields, no ORDER BY + LIMIT across backend queries, a
  blank count is 0, Detect and Explain takes the entity, drafts cannot run queries before publish, blobs via
  `store.ts`, resolve Plot colour tokens, keep native roles, keep blobs small.
- `bda.fn.watch` batches carry `data`: the run's `ctx.emit(name, data)` events (runtime contract 1.20.0), parsed
  (`{seq, at?, name, data}`); `bda.fn.dataEvents` parses any event list. `bda.fn.reduceDE` folds Detect & Explain's
  `de/1` events into live findings keyed by `k` (detected, superseded under `by`, kept, explanation drivers), a
  0-100 progress by stage, and the end (`run.done` replaces the rows with an inline output; `run.failed`). Same
  files as Studio's `GET /api/data-apps/sdk`. `template/src/examples/DetectExplainLive.tsx`: the last result on
  load, live findings on Refresh, the output when the run ends (README-FOR-AGENTS, "Live results while a function
  runs").
- `studio:sandbox:context` carries `scope`, the whole page resolved for the host's chat: the window (`to`
  exclusive), `asOf`, the filters that narrow, the rail's measure, the checked dimensions, the entity and the
  period comparison (`runtime/src/studio/scope.ts`). A change is posted on the next frame. The template's
  `studio/contextRegistry.ts` exposes the same `setPageScope`. `studio:sandbox:state` is unchanged.
- Core recipes' panel reports carry `queryId` (the card's primary query) and a `bind` resolved to what the card
  draws, e.g. breakdown's `dims: 'all'` becomes the checked fields plus the selected measure.
- `studio:sandbox:context` carries `outline`, what the page is for the host's chat: its controls in screen order
  with what each offers (the presets and their labels, the options, `multi`/`maxPicks`, what it starts on, the
  panel a picker sits in, the entity list once loaded) and every panel with its `explain`
  (`runtime/src/studio/outline.ts`). Structure only: the values stay in `scope`. Built from the helpers the chrome
  renders with, and posted on the next frame when it changes. The template's `studio/contextRegistry.ts` gains
  `registerControl`/`unregisterControl`/`setPageInfo` and `components/useReportControl.ts`, documented in
  README-FOR-AGENTS ("Describe the page").

### Changed
- `percent` and `rate` measures show one decimal (3.1%, was 3.14%), and a rate's change shows one decimal of
  points. The ab_test family's lift percentages keep two.

- A failed or timed-out query never reads as a number. Queries retry what is transient (5xx, or no answer:
  `host_timeout`) up to three tries with backoff (1 s, 2 s), in the runtime and the template (`shouldRetry`,
  `retryDelay` in `studio/hooks.ts`); what still fails shows a quiet "Couldn't load" with Retry (code and message
  in the tooltip). Cards that hid themselves on a failure (narrative, ab_test verdict, KPI tiles, cumulative
  trend, overview) now show it, and narrative writes no findings from a partial answer. `evals/failure.test.tsx`
  renders every recipe failed, part-failed and empty, and fails on any zero amount, rate or change.

### Fixed
- A filter's state is now always what its query binds (`runtime/src/controls.tsx`). Before, the seed (the
  `default`, else every option) was not cut to the filter's slots. A single-select filter with no default then
  started with every option pressed, while `totals`/`by_time` bound only the first. A multi filter offering more
  options than slots started on "All" while binding the first five. The FilterBar claimed both showed every
  value, and the in-memory breakdown kept every row. Now:
  - the seed is cut to the slots, so that filter starts on its first option, matching the composer's slot
    defaults;
  - "All" appears only when the slots can hold every option;
  - a pick past the slots is refused (the chip is disabled, with "Pick up to N");
  - a link naming more values keeps the first ones and reports `invalid_value`.

  `buildFilterParams` no longer returns `overflow`. The composer's SQL and manifest are unchanged.

## 1.1.0 (proposed tag `kit-v1.1.0`)

Additive: no DataAppSpec or manifest change.

### Added
- `template/src/studio/fn.ts`, `bda.ts`, `fn.test.ts`: `bda.fn.call / run / watch / cancel / outputOf`, so a
  hand-built app can call the functions, agents and workflows its manifest declares under `functions`. The same
  files Studio serves over MCP `dataapp_sdk` and `GET /api/data-apps/sdk`.
- `template/README-FOR-AGENTS.md`: "Calling functions, agents and workflows" (declare pinned refs, local names
  only, a button's `onClick`, reuse on load, watch and Cancel, output as text, a person confirms a version that
  adds an import, runs as the viewer), the manifest fields a hand-built app uses, and the `bda.fn` errors.
- `docs/agents/`: the context collection for coding agents (Studio MCP, data apps, functions, agents, workflows,
  invocations, Detect and Explain, limits), generated from Studio's sources and stamped with their commits.
  Pending content review.
- `CLAUDE.md` and `template/CLAUDE.md`: route a coding agent to the Studio MCP's `studio_guide`, with a short
  protocol for working with non-engineers.
- `AGENTS.md`: a routing table at the top (compose, hand-build, functions/agents/workflows, changing the kit).
  States that composed (spec) apps cannot call functions, agents or workflows yet.
- `CHANGELOG.md`, `RELEASING.md`.
- `template/`: `npm run dev` can target preview (`BDA_API_ORIGIN`); `.env.example` describes both flows.

### Changed
- `scripts/no-real-ids.sh` now covers `template/` and `examples/`: `KIT_FORBIDDEN_IDS` no longer skips
  `template/`, fixture `model` ids there must start with `m_`, and SQL there must read `FROM` an `m_` model or a
  `<placeholder>`.
- `template/README-FOR-AGENTS.md` examples use the synthetic `m_retail_demo` model and its fields.
- Golden rules gain "no forms: start actions from a button's `onClick`" and "never build chat UI".

### Fixed
- `AGENTS.md` named `spec/dataapp-spec.v1.schema.json`; the contract is `spec/dataapp-spec.v2.schema.json`.
- `README.md` and `AGENTS.md` said "two ways to build" twice; `AGENTS.md` told every app builder to use only the
  `design_*` tools, which contradicted hand-building apps that call functions.
- `AGENTS.md`: the last two steps of "Adding a recipe" sat under "Adding a family".

## 1.0.0 (untagged)

The kit as merged up to `ccc87ac` (#1 to #7): DataAppSpec v2 with the core recipes and the `ab_test` family,
declared datasets and the composer, the `ask-show-ship` and `semantic-query` skills, declared persistence (store
broker), FilterBar and filters, panel context and the telemetry reporter, provenance, summary and `kit diff`,
deep links, readiness and Schedule Mode, and the hand-build `template/` with `<Panel>`.
