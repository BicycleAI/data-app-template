> **Start with compose.** Most apps should not be hand-built. Load `skills/ask-show-ship/SKILL.md` and compose a spec with `kit compose` (or the `design_*` MCP tools). Use this template only when a recipe cannot express what you need.

# Building a Bicycle data app

You are modifying this template into an app that answers one question about a
dataset. Read this first; it is short, and most of it is constraints you cannot
discover by reading the code.

## What this app can and cannot do

It renders data. It does not have database access, credentials, or a network.
Data arrives one way only: through queries that **you declare** in
`bda.manifest.json` and that the service executes on your behalf.

Those queries are **semantic SQL against one model**, not SQL against tables.
You do not aggregate raw rows; you select metrics that the semantic layer has
already defined. The next section is the part you cannot guess from the code.

## The model you are querying

An app is bound to exactly **one semantic model** when it is created
(`dataapp_start(model=...)`). Every declared query runs against that model.
The model is *not* a field in `bda.manifest.json` — do not add one, the
manifest rejects unknown fields.

Before writing a single query, discover what that model offers:

| Tool | What it tells you |
| --- | --- |
| `query_list_models` | the models you may use, with their ids |
| `query_describe_model(model)` | **metric columns**, their event type, and each metric's `from`/`till` availability |
| `query_describe_metric(model, metric)` | a metric's definition, expression, ratio components, and slice-by fields |
| `query_search_fields(model, text)` | "by city" -> the exact dimension name to use |
| `query_dimension_values(model, field)` | the literal values a dimension takes — use this for filter option lists |
| `query_compile(model, sql)` | check SQL compiles without running it |
| `query_run(model, sql, params)` | run it and see real rows |

**Run your SQL with `query_run` before you put it in the manifest.** A query
that fails to compile makes the whole version `invalid` at upload time, and the
error you get back then is far less informative than the one `query_run` gives
you now.

### Availability is not "now"

Every metric carries a `from` and `till` window, and it is usually **not
today**. A model whose data ends in May returns zero rows for a question about
September, which looks like a bug in your app and is not. Read the window from
`query_describe_model` and default your date controls inside it.

## Golden rules

1. **Only declared queries run.** A `queryId` that is not in
   `bda.manifest.json` is refused with `query_not_allowed`. Add the query to
   the manifest, resubmit, and it works.
2. **No external network calls.** The page that hosts your app sets
   `connect-src 'self'`, so a `fetch` to any other origin is blocked by the
   browser. Do not add analytics, fonts from a CDN, or an API client.
3. **No raw SQL from the app, and no raw SQL at all.** You write semantic SQL
   once, in the manifest, against the model the app is bound to. The app sends
   a query id. Metrics are pre-aggregated columns — never `sum(...)` them
   yourself, and never name a table.
4. **No `localStorage`, `sessionStorage`, or cookies.** The app runs in a
   sandboxed frame with an opaque origin, where these are unavailable and
   throw. Keep state in React.
5. **Components reference `--bda-*` variables; only `theme.css` holds colour
   values.** You may change those values — including to a different palette
   entirely — but a literal hex in a component cannot be rethemed, and it will
   be wrong for half your viewers, because light or dark follows their system.
   Define both palettes. See "How much of the look can you change?" below.
6. **Chart with Observable Plot, and nothing else.** It is already installed.
   Do not add another charting library, and do not load one from a CDN — the
   page your app runs in sets `script-src 'self'`, so an external script will
   not load at all.
7. **Never change the build output names.** `vite.config.ts` emits exactly
   `app.js` and `app.css`. The host page loads those names. `npm run build`
   fails if anything else appears.

## The loop

```bash
npm install
# 1. create the app so you have an id and a model binding (see "Submitting")
# 2. put that appId in bda.manifest.json
# 3. explore the model with query_describe_model / query_search_fields
# 4. write each query, prove it with query_run, then declare it in the manifest
npm run dev          # proxies /api to the service; see vite.config.ts
```

## Declaring a query

In `bda.manifest.json`, `queries` is a list. Each entry:

```json
{
  "id": "revenue_by_brand_tier",
  "sql": "SELECT brand_tier, total_channel_revenue FROM QxGTe8DD WHERE timestamp_utc >= :from AND timestamp_utc < :to ORDER BY total_channel_revenue DESC",
  "parameters": [
    { "name": "from", "type": "date", "required": true },
    { "name": "to", "type": "date", "required": true }
  ],
  "columns": [
    { "name": "brand_tier", "type": "string" },
    { "name": "total_channel_revenue", "type": "number" }
  ],
  "maxLimit": 1000
}
```

- `id` — lower_snake_case, `^[a-z][a-z0-9_-]{0,63}$`; what the app asks for.
- `sql` — one `SELECT` or `WITH`, max 8000 chars. No semicolons. Parameters are
  `:name` or `$name` (both work).
- `parameters` — every placeholder in the SQL must be declared. Types:
  `string`, `number`, `boolean`, `date`. Max 16.
- `columns` — **the allow-list for filtering and sorting.** A filter or sort on
  a column you did not declare is refused. Types: `string`, `number`,
  `boolean`, `date`, `timestamp`. Max 64.
- `maxLimit` — 1..10000, default 1000.

Max 32 queries per manifest.

### What semantic SQL allows

The shape is always the same:

```
SELECT <metric column>[, <dimension>...]
FROM <the app's model>
WHERE <time column> >= :from AND <time column> < :to
[GROUP BY is implicit]
[ORDER BY <metric> DESC] [LIMIT n]
```

- **`FROM` is the model id**, e.g. `FROM QxGTe8DD`. Never a table name.
- **Metrics are columns, already aggregated.** `total_channel_revenue` is
  defined as a sum by the semantic layer. Write
  `SELECT brand_tier, total_channel_revenue`, *not*
  `SELECT brand_tier, sum(revenue)`.
- **A bounded time range is required.** Both ends. An open-ended
  `WHERE ts >= :since` will not compile.
- **Time series:** `date_trunc('day', <time column>)` — also `'week'`,
  `'month'`.
- **Top-n:** `ORDER BY <metric> DESC LIMIT n`.
- **No JOINs and no subqueries.** Dimensions of the metric's event type are
  already available as columns; `query_search_fields` gives you their exact
  names.

So this, from an older version of this document, is **wrong** and will not
compile:

```sql
-- WRONG: a table, a raw aggregate, an unbounded range
select sales_region, sum(revenue) as total_revenue
from orders where order_date >= :since group by sales_region
```

and this is the same intent, correctly:

```sql
-- RIGHT: the model, a declared metric, a closed range
SELECT sales_region, total_revenue FROM <model>
WHERE order_date >= :from AND order_date < :to
```

## Fetching data

```tsx
import { useAppQuery } from './studio/hooks.js'
import { toObjects } from './studio/client.js'
import { SkeletonChart } from './components/Skeleton.js'

const query = useAppQuery('revenue_by_region', {
  parameters: { since: '2026-01-01' },
})

if (query.error) return <div className="bda-state bda-state--error">{query.error.message}</div>

const rows = query.data === undefined ? undefined : toObjects(query.data)
```

**Never early-return a `Loading…` from the top of a component that owns the
layout.** Your app runs in a frame inside the viewer, so a blank while a query
is in flight is the *third* empty screen the reader has sat through — the
viewer loads, then the frame, then you. Render the layout on the first paint
and let each widget fill itself in:

```tsx
<div className="bda-card" aria-busy={rows === undefined}>
  <h2 className="bda-heading">Revenue by region</h2>
  {rows === undefined ? <SkeletonChart /> : <Chart options={optionsFor(rows)} />}
</div>
```

The heading sits outside the conditional deliberately: the reader can see what
is coming while it loads. Size the skeleton to the content it stands in for —
pass `<SkeletonChart height={...}>` the same height as the `<Chart>` — or the
page jumps when the rows land. `Skeleton`, `SkeletonText`, `SkeletonChart`,
`SkeletonMetric` and `SkeletonTable` are in `components/Skeleton.tsx`.

Put `aria-busy` on the region, not on the blocks: the skeletons are
`aria-hidden`, so a screen reader hears one "busy" instead of a pile of
anonymous boxes.

An **error** is different from a pending query — it replaces the widget, or the
app, because there is nothing to fill the layout with. Taking the page down for
a failure is right; taking it down for a slow query is not.

**Narrow on `data`, not on `isPending`.** With more than one query, testing
the flags does not convince TypeScript that either `data` is present. Keep the
two queries independent so the faster card is not held back by the slower one:

```tsx
const totals = useAppQuery('plan_totals', { parameters: { region } })
const monthly = useAppQuery('net_mrr_by_month', { parameters: { region } })

const failure = totals.error ?? monthly.error
if (failure !== null) return <div className="bda-state bda-state--error">{failure.message}</div>

// Each card checks its own query. Do NOT gate both on
// `totals.data === undefined || monthly.data === undefined` — that makes every
// card as slow as the slowest one.
```

Filtering and sorting are just options — changing them refetches, and the
previous rows stay on screen while it does:

```tsx
const [sort, setSort] = useState({ field: 'total_revenue', dir: 'desc' as const })

const query = useAppQuery('revenue_by_region', {
  parameters: { since },
  filters: [{ field: 'total_revenue', op: 'gte', value: 1000 }],
  sort: [sort],
})
// query.isPlaceholderData is true while the new options are loading.
```

Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in` (pass `values`),
`contains` (strings).

## Filters and controls

Which control to use is a question about the options, not about taste. Count
them, then decide whether the question is "which one" or "which of these".

| Options | One at a time | Several at once |
| --- | --- | --- |
| 2–5 | `.bda-pill` with `aria-pressed` | `.bda-checkboxes--inline` |
| 6–12 | `.bda-select` | `.bda-checkboxes` in a panel |
| 12–50 | `.bda-select`, with `<optgroup>` | checkboxes plus a text filter |
| 50+ or unbounded | a combobox: a text input that filters a `<datalist>` or a listbox | a combobox that adds pills for each choice |

Four rules matter more than the table.

**Prefer a native control.** Your app runs in a frame of whatever size the host
page gave it. A popup you render yourself is inside that frame and gets clipped
near its bottom edge; a `<select>` is painted by the browser outside the page
and never is. Native also gets you keyboard handling, typeahead and screen
reader semantics for free. Do not rebuild a select or a checkbox out of divs.

**Single-select needs an explicit "All" — as a filter, not a parameter.** The
unfiltered total is usually the default reading, so give it a real option. The
tempting version does not work: semantic SQL **rejects `OR`**
(`unsupported_where: OR is not supported; run separate queries`), so the
`(:channel = 'All' or channel = :channel)` sentinel trick is not available.

Declare the query unfiltered, and let "All" mean "no filter":

```json
{
  "id": "revenue_by_month",
  "sql": "SELECT date_trunc('month', timestamp_utc) AS month, total_channel_revenue FROM QxGTe8DD WHERE timestamp_utc >= :from AND timestamp_utc < :to",
  "parameters": [
    { "name": "from", "type": "date", "required": true },
    { "name": "to", "type": "date", "required": true }
  ],
  "columns": [
    { "name": "month", "type": "string" },
    { "name": "channel", "type": "string" },
    { "name": "total_channel_revenue", "type": "number" }
  ]
}
```

```tsx
const [channel, setChannel] = useState('All')
const monthly = useAppQuery('revenue_by_month', {
  parameters: { from, to },
  filters: channel === 'All' ? [] : [{ field: 'channel', op: 'eq', value: channel }],
})

<label className="bda-controls__label" htmlFor="channel">Channel</label>
<select id="channel" className="bda-select" value={channel}
        onChange={(event) => setChannel(event.target.value)}>
  {['All', 'online', 'store'].map((option) => (
    <option key={option} value={option}>{option}</option>
  ))}
</select>
```

Declare `channel` in `columns` even though it is not in the `SELECT` list —
`columns` is the filter and sort allow-list, and a filter on an undeclared
column is refused.

If you genuinely need two different shapes rather than one filtered shape,
**declare two queries**. That is what the compiler's error message is telling
you to do.

**A multi-select is a filter, not a parameter.** It wires to the `in` operator,
which takes up to 100 values. "Nothing ticked" is ambiguous, so treat an empty
selection as everything rather than as nothing:

```tsx
const [regions, setRegions] = useState<string[]>([])

const rows = useAppQuery('mrr_by_region', {
  filters: regions.length === 0 ? [] : [{ field: 'region', op: 'in', values: regions }],
})

<fieldset className="bda-checkboxes bda-checkboxes--inline">
  <legend className="bda-visually-hidden">Regions</legend>
  {ALL_REGIONS.map((region) => (
    <label key={region} className="bda-checkbox">
      <input
        type="checkbox"
        checked={regions.length === 0 || regions.includes(region)}
        onChange={(event) =>
          setRegions((current) =>
            event.target.checked ? [...current, region] : current.filter((r) => r !== region),
          )
        }
      />
      {region}
    </label>
  ))}
</fieldset>
```

**An option list that can grow has to come from a query.** Hard-coding
`['luxury', 'premium', 'mid_market']` is fine for a closed enum and wrong for
anything else: add a fourth tier and the charts show it while the filter
silently does not offer it. There is no `SELECT DISTINCT` in semantic SQL —
ask for the dimension alongside a metric and read the values off the rows:

```json
{
  "id": "brand_tiers",
  "sql": "SELECT brand_tier, conversion_event_volume FROM QxGTe8DD WHERE timestamp_utc >= :from AND timestamp_utc < :to",
  "parameters": [
    { "name": "from", "type": "date", "required": true },
    { "name": "to", "type": "date", "required": true }
  ],
  "columns": [
    { "name": "brand_tier", "type": "string" },
    { "name": "conversion_event_volume", "type": "number" }
  ]
}
```

While authoring, `query_dimension_values(model, field)` lists a dimension's
literal values directly — use it to sanity-check what the control will show.

Two smaller things. A filter that changes the whole app goes at the top, in a
`.bda-controls` row; one that changes a single panel goes in that panel's
header, next to its title. And a control that changes only *presentation* — a
reference line, a log scale, a sort direction you can compute locally — is a
checkbox that touches no query; keep it visibly separate from the ones that
narrow the data, because the reader cannot tell them apart otherwise.

## Theming

Use these, never literal colours.

**Light or dark is the viewer's choice, not yours.** `studio/theme.ts` reads
`prefers-color-scheme` and stamps `data-theme` on `<html>`, so the app is
light on a light desktop and dark on a dark one, and follows along if the
viewer switches with the page open. You get that for free by defining both
palettes in `theme.css` and using only variables everywhere else.

Pin a theme **only when the person who asked for the app asked for one** —
"make it dark", "match our dark dashboard". One line in `main.tsx`, before
`root.render`:

```ts
import { pinTheme } from './studio/theme.js'

pinTheme('dark') // the user asked for dark; stop following the system
```

`pinTheme('system')` hands control back. Do not add a theme toggle: the app
runs in a frame with no storage, so the choice could not be remembered.

| Variable | For |
| --- | --- |
| `--bda-surface-background` | the page |
| `--bda-surface-raised` | cards and panels (`.bda-card` does this for you) |
| `--bda-surface-overlay` | a raised element on a card |
| `--bda-text-primary` / `--bda-text-secondary` | text, supporting text |
| `--bda-border` | card borders |
| `--bda-grid` | chart gridlines and table rules — lighter than a border |
| `--bda-accent` | the one emphasis colour (coral) |
| `--bda-accent-soft` / `--bda-accent-muted` | an accent fill, an accent border |
| `--bda-positive` / `--bda-negative` | good and bad values only |
| `--bda-chart-1` … `--bda-chart-6` | categorical series, in draw order |
| `--bda-radius`, `--bda-radius-pill` | corners |
| `--bda-space-1` … `--bda-space-5` | 4, 8, 12, 16, 24px |
| `--bda-font-family`, `--bda-font-size` | type |
| `--bda-shadow` | card depth (none in dark) |

Everything except the palette is shared between the two themes: only the
colour tokens are redefined under `:root[data-theme='dark']`.

Ready-made classes in `theme.css`: `.bda-card`, `.bda-title`, `.bda-heading`,
`.bda-subtle`, `.bda-metric` (+`__value`, `__label`), `.bda-pill` (set
`aria-pressed`), `.bda-table` (+`.bda-numeric`), `.bda-state`
(+`--error`), `.bda-chart`, `.bda-visually-hidden` (a label for a screen
reader that the layout has no room for). Controls: `.bda-controls`
(+`--spread`, `__label`), `.bda-select`, `.bda-checkbox`, `.bda-checkboxes`
(+`--inline`) — see "Filters and controls".

### How much of the look can you change?

`theme.css` is yours — it ships in your bundle. So the answer is "most of it",
with one rule that makes the difference between a themeable app and one that
looks broken in a host you have not seen.

**The rule: components reference variables; only `theme.css` holds values.**
Everything below follows from it.

Freely:

- **Layout, components, spacing, your own class names.** Build whatever the
  question needs. The `.bda-*` classes are a starting set, not a framework.
- **Add variables.** A new colour, a new radius, a scale for a specific chart
  — define it in `theme.css` under both `:root` and `:root[data-theme='dark']`.
- **Choose your chart colours.** Use one `--bda-chart-N` for a single series,
  `fill: '<field>'` to run through the ramp, or define your own sequential
  scale as variables for a heatmap.

When the app genuinely needs a different palette — a brand to match, a
subject that demands its own colours — **redefine the token values** at the
top of `theme.css`:

```css
:root {
  --bda-accent: #6b4de6;
  --bda-chart-1: #6b4de6;
  --bda-chart-2: #22a7a0;
  /* … */
}
:root[data-theme='dark'] {
  --bda-accent: #9a85f0;
  /* … the same names, adjusted for a dark ground */
}
```

That is supported, and it is the difference between a considered choice and a
hard-coded hex: the names survive, so the host's light/dark switch still
works and a future re-theme is one file.

Not this:

- **A literal colour in a component** (`style={{ color: '#f4676c' }}`,
  `fill: '#f4676c'`). It cannot be rethemed and it will be wrong in dark.
- **Dropping the dark block, or filling it in carelessly.** Nobody chooses
  dark for your app — a viewer whose desktop is dark simply gets it. Half your
  audience may only ever see that block. Change values in both, together.
- **Renaming the semantic tokens.** `--bda-accent` means "the emphasis
  colour" to every host; `--bda-brand-purple` means nothing to them.

## Charts

[Observable Plot](https://observablehq.com/plot) is the charting library, and
the only one. It is a dependency already — `import * as Plot from
'@observablehq/plot'` — so there is nothing to install and nothing to load
from a CDN. (A CDN would not work: the embed page sets `script-src 'self'`.)

Use the `Chart` component rather than calling `Plot.plot()` yourself. It gives
you the theme's colours and fonts, a width that follows the container, and
correct teardown:

```tsx
import * as Plot from '@observablehq/plot'
import { useMemo } from 'react'
import { Chart } from './components/Chart.js'
import { SkeletonChart } from './components/Skeleton.js'
import { toObjects } from './studio/client.js'
import { useAppQuery } from './studio/hooks.js'

export function App() {
  const query = useAppQuery('revenue_by_month')

  const options = useMemo(() => {
    if (query.data === undefined) return undefined
    const rows = toObjects(query.data)
    return {
      y: { label: null, tickFormat: (v: number) => `${Math.round(v / 1000)}K` },
      x: { label: null, type: 'band' as const },
      marks: [
        Plot.barY(rows, { x: 'month', y: 'revenue', fill: 'var(--bda-chart-1)', rx: 3, tip: true }),
      ],
    }
  }, [query.data])

  if (query.error !== null) return <div className="bda-state bda-state--error">{query.error.message}</div>

  return (
    <div className="bda-card" aria-busy={options === undefined}>
      <h2 className="bda-heading">Monthly revenue</h2>
      {options === undefined ? <SkeletonChart /> : <Chart options={options} title="Revenue by month" />}
    </div>
  )
}
```

Points that matter:

- **The card and its heading render immediately.** Only the chart area waits.
  `useMemo` returning `undefined` while the query is in flight is the signal —
  there is no separate `isPending` branch to keep in sync.
- **Memoise the options.** Rebuilding them every render redraws the chart on
  every render.
- **Colour marks with `var(--bda-chart-N)`** for a fixed colour, or set
  `fill: '<field>'` to colour *by category* — the palette is wired into Plot's
  `color.range` for you. `chartPalette()` and `token()` are exported from
  `components/Chart.js` if you need the values directly.
- **`tip: true`** gives you hover tooltips for free. Use it.
- **`label: null`** on an axis suppresses Plot's default axis title, which is
  usually redundant next to a card heading.
- Pass `height` when 260px is wrong. Width is always the container's.

Common marks: `Plot.barY` / `Plot.barX` (categorical), `Plot.lineY` +
`Plot.areaY` (time series), `Plot.dot` (scatter), `Plot.cell` (heatmap),
`Plot.ruleY([0])` (a baseline). For a share-of-total, prefer a sorted
`Plot.barX` over a pie — it is easier to read and Plot has no pie mark.

## Submitting

```bash
npm run build     # typechecks, emits dist/app.js and dist/app.css, checks them
```

`npm run build` typechecks before bundling, so a type error fails the build
rather than shipping. Vite itself strips types without checking them — the
gate is there on purpose, not by accident.

What you ship is a **zip**, not a JSON body of file contents:

```
bundle.zip
  bda.manifest.json     at the root, or inside one top-level folder
  app.js                from dist/
  app.css               from dist/
  assets/**             optional, <= 2 MiB per file
```

No executables, 25 MiB total. Then four steps, whether you drive them as MCP
tools or as REST calls:

| Step | MCP tool | REST |
| --- | --- | --- |
| 1. create the app, bound to a model | `dataapp_start(name, title, model)` | `POST /api/data-apps` |
| 2. get signed upload steps | `dataapp_upload_url(app_id, version)` | `GET /api/data-apps/{id}/versions/{v}/upload-url` |
| 3. verify + validate the bundle | `dataapp_complete_upload(app_id, version, sha256, bytes)` | `POST .../versions/{v}/complete` |
| 4. make it the live version | `dataapp_publish(app_id, version)` | `POST /api/data-apps/{id}/publish` |

Step 1 returns the `appId` and the hosted `appUrl`. Put the `appId` in
`bda.manifest.json` — it is informational there, the URL is authoritative.

The upload itself is a GCS resumable PUT, done out of band between steps 2 and
3:

```bash
LOCATION=$(curl -s -D - -o /dev/null -X POST "$UPLOAD_URL" \
  -H 'x-goog-resumable: start' \
  -H 'x-goog-meta-is-valid: false' \
  -H 'x-goog-meta-orig-file-name: bundle.zip' \
  -H 'Content-Type: application/zip' | tr -d '\r' | awk '/^[Ll]ocation:/ {print $2}')
curl -s -X PUT "$LOCATION" --data-binary @bundle.zip -H 'Content-Type: application/zip'
```

Step 3 takes the zip's `sha256` and its size in bytes; a mismatch is a 412 and
nothing is stored. It unzips, validates the manifest, and **compiles every
declared query against the model** — so a version lands as `validated` or
`invalid`, with per-query errors you can fix and resubmit. Only a `validated`
version can be published.

A later revision starts at `dataapp_new_version(app_id)` and repeats 2-4.

## When something goes wrong

| What you see | What it means |
| --- | --- |
| version state `invalid`, per-query errors | A declared query did not compile against the model. Run it through `query_compile` or `query_run` to get the real message. |
| `missing_param` | The SQL has a `:name` / `$name` that `parameters` does not declare. |
| an unbounded-range compile error | Semantic SQL needs both ends: `>= :from AND < :to`. |
| zero rows, no error | Almost always the availability window — the model's data does not cover the dates you asked for. Check `query_describe_model`. |
| a metric that will not resolve | You aggregated it yourself (`sum(revenue)`). Select the metric column as-is. |
| `invalid_app_code`, stage `parse` | The bundle does not parse. Usually a truncated file. |
| `invalid_app_code`, stage `boot` | It parses but throws on first render. The message carries the real error and the line in `app.js`. |
| `invalid_app_code`, "did not finish" | Something loops or never settles at module scope. |
| `query_not_allowed` | The `queryId` is not in the submitted manifest. |
| HTTP 412 on complete | The uploaded object's checksum or size does not match what you declared. |
| HTTP 410 on upload-url | That version is no longer `awaiting_upload`. Start a new version. |
| `token_expired` | The view token aged out. In the host page this heals itself; in `npm run dev`, mint a new one. |
| A blank page | Check the browser console, and that `npm run build` passed its output check. |
| `npm install` fails with `edgesOut` | npm's tree builder crashing on vitest's peer set. The pinned `overrides` entry in `package.json` prevents it — do not remove it. |

Submissions are validated by actually running the code before anything is
stored, so a failure here means it never shipped — fix and resubmit.
