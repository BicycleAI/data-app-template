# Changelog

All notable changes to the data-app kit (this repository: spec, recipes, runtime, composer, skills and the
hand-build `template/`). Versions follow `RELEASING.md`: tags are `kit-vMAJOR.MINOR.PATCH`, and the version in
`package.json` and `template/package.json` matches the tag.

## Unreleased

### Added
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
