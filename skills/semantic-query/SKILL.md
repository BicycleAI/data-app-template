---
name: semantic-query
description: Write, run or explain a semantic SQL query against a Bicycle model — the grammar, the `query_*` discovery loop, and the rule that every number you state comes from a run you just made. Use whenever someone asks what the data says, or asks what a query an app already runs actually means.
---

# Semantic SQL against a Bicycle model

## What semantic SQL is

A semantic model is a published set of **metrics**, not a database. So this is SQL in
shape only.

- **Metrics are columns, and they are already aggregated.** `revenue_total` *is* the
  sum. Select it as it stands. `sum(revenue_total)` does not compile.
- **`FROM` is a model id** — `FROM m_retail_demo`. Never a table name, never a schema.
- **Dimensions are plain columns**: the fields of the metric's event type (`region`,
  `channel`). Name one in the `SELECT` list and the metric comes back cut by it.
- **`GROUP BY` is implicit.** The non-metric columns you selected *are* the grouping.
  Do not write a `GROUP BY` clause.

## The shape

```
SELECT <metric column>[, <dimension>…]
FROM <model id>
WHERE <time column> >= :from AND <time column> < :to
[GROUP BY is implicit — do not write one]
[ORDER BY <metric> DESC] [LIMIT n]
```

- **Time series:** `date_trunc('day', <time column>) AS period` as a select item — also
  `'week'` and `'month'`. Alias it; the alias is the column name you get back.
- **Parameters** are `:name` (or `$name`), passed to `query_run` as `params`. Every
  placeholder needs a value or you get `missing_param`.
- **Both ends of the time range are mandatory.** `WHERE event_time >= :from` on its own
  fails with `time_range_required`. `BETWEEN` works, but only on the time column.
- **Filter a dimension** with `AND <dimension> = :value` — also `!=`, `>`, `<`, `>=`,
  `<=`, `LIKE 'pattern%'`, and `IN ('a', 'b')` with literal values.
- **A list parameter does not work — and it does not tell you so.** `IN (:regions)` with
  `regions: ["a", "b"]` *compiles clean*, then returns **zero rows**: the compiler folds
  the list into a nested argument (`Comparator.IN, [['a','b']]`) that matches nothing.
  Verified by running it. This is the one place where `query_compile` passing is not
  enough — `query_run` it and compare against the unfiltered rows.
- **Two forms do work, both verified by running them:** literals, `IN ('a', 'b')`, and
  **one scalar parameter per slot**, `IN (:r0, :r1)` with `r0: "a", r1: "b"`. Prefer the
  second when the values come from a control, since the query can then be re-run with
  new values instead of rebuilt. Its one constraint is a fixed number of slots, and
  **duplicates are harmless** — `IN` is a set, so a spare slot can repeat a value you
  already passed (verified: five slots with one value repeated four times returns the
  same rows as the two-value query). A manifest's `parameters[].type` is
  `string | number | boolean | date`, which is why there is no list form to declare.
- Max 8000 characters. No semicolon.
- **Not available:** `JOIN` (`no_joins`), subqueries and `UNION` (`no_subqueries`),
  `SELECT *` (`no_star`), `OR` (`unsupported_where: OR is not supported; run separate
  queries`), `NOT IN`, and arithmetic on metrics (`unsupported_select`). For a ratio or
  a difference, select the parts and do the maths after the rows land.

## The loop before you state a number

1. `query_describe_model(model)` — the metric **columns**, their event type, and each
   metric's `from`/`till` availability window. Read the window now, not after the empty
   result.
2. `query_search_fields(model, text)` — "by country" gives you the exact dimension name.
   Guessing a dimension name is the most common compile failure.
3. `query_dimension_values(model, field)` — the literal values a dimension takes, for a
   filter or an option list. It defaults to the model's available window.
4. `query_compile(model, sql)` — checks without running. Cheap; use it whenever you are
   unsure. `query_explain` additionally says how it routes and whether it is cacheable.
5. `query_run(model, sql, params)` — the rows. Cache-only by default, so it never
   spends; `max_rows` defaults to 200.

**The rule: every number you state must come from a `query_run` you made in this turn.**
Not from the conversation, not from an app's rendered output, not from a manifest, not
from what you ran three turns ago. Context tells you what to look at; `run` tells you
what it is.

## Availability is not "now"

Every metric carries a `from` and a `till`, and the `till` is usually **not today**. A
model whose data ends in May returns zero rows for a question about September — which
looks like a bug and is not one. Read the window from `query_describe_model`, ask inside
it, and when you answer, say the date the number is *as of*. If someone asks about dates
the model does not cover, say so rather than showing them an empty result.

## The loading contract — when a panel is done

A composed app never blocks on a query: every card renders its layout, then fills in.
So "the app has loaded" is not a thing you can see, and the frame says it instead. Each
panel in the frame's `studio:sandbox:context` report carries a `status`:

| `status` | What it means |
| --- | --- |
| `loading` | one of that panel's queries is still in flight — nothing to read yet |
| `ready` | every query resolved and there are rows |
| `empty` | every query resolved and there were **no rows** |
| `error` | a query failed; the card shows the code and a Retry |

Two of these decide what you say to a person.

**`empty` is not `error`, and it is almost never "there is no data".** It is the same
situation as "zero rows, no error" in the table below: the query ran, the model
answered, and the answer for *that window, those filters* is nothing. Check the
availability window before you call it an outage. A panel sitting at `empty` right
after a deep link usually means the link's filters or its `asOf` landed outside the
data, not that the model is broken.

**Never read a number off a panel that is still `loading`.** A recipe that renders
several cards for one panel reports the worst of them, so a panel only says `ready`
when every card it drew is done. Wait for `ready`, or say the panel is still loading.

A deep link — or a scheduled capture — arrives as the host's `state`: filters, a time
preset or explicit range, and an `asOf` that pins every query's upper bound. The frame
reports what it actually adopted back as `studio:sandbox:state` — only what differs
from the app's defaults, so `{ filters: {} }` means "everything at its default" — with
a `dropped` list naming anything the spec could not honour, one `{ id, reason }` per
parameter: `id` is `f.<dim>`, `t`, `asof` or `s`; `reason` is `unknown_filter`,
`invalid_value`, `undeclared_preset` or `invalid_date` (e.g. `{ id: "f.channel",
reason: "unknown_filter" }`). A preset under an `asOf` ends at the as-of, not today.
If a panel looks wrong after a link, read `dropped` first. The full shapes are in the
kit README's protocol table.

## Shapes the kit uses

Every query a composed app runs is one of these. They are the rendered output of
`recipes/datasets.json` (core) and `families/ab_test/datasets.json` — copied from
`kit manifest`, so they are exactly what the composer emits.

### Core — any model (`m_retail_demo`: `event_time`, `region`, `channel`, `category`)

**`totals`** — one row, every measure. *Use for a KPI row, or "what is it right now".*

```sql
SELECT orders_total, revenue_total, refund_rate_pct, avg_order_value FROM m_retail_demo WHERE event_time >= :from AND event_time < :to
```

**`by_time`** — every measure per period. *Use for a trend, or "which way is it moving".*

```sql
SELECT date_trunc('day', event_time) AS period, orders_total, revenue_total, refund_rate_pct, avg_order_value FROM m_retail_demo WHERE event_time >= :from AND event_time < :to
```

**`by_dimension`** — every measure at the full cut. *Use for breakdowns, rankings,
heatmaps and tables; slice it down after the rows land rather than running it again.*

```sql
SELECT region, channel, category, orders_total, revenue_total, refund_rate_pct, avg_order_value FROM m_retail_demo WHERE event_time >= :from AND event_time < :to ORDER BY orders_total DESC LIMIT 10000
```

**`by_time_<dim>`** — a trend split by one dimension, one query per split, max 3. *Use
when the question is "how has it moved, by region".*

```sql
SELECT date_trunc('day', event_time) AS period, region, refund_count, refund_rate_pct, orders_total FROM m_retail_demo WHERE event_time >= :from AND event_time < :to
```

**`entity_list`** — the pickable things and their labels, ranked. *Use to populate an
entity picker.* Declared identically by both families; rendered below.

**When the app declares filter controls**, the composer adds one scalar parameter per
slot to the queries that aggregate that dimension away — `totals` and `by_time` (and
`arm_totals` and `daily_trend` in `ab_test`). A multi-select filter gets `IN`, a
single-select gets `=`:

```sql
SELECT orders_total, revenue_total, refund_rate_pct, avg_order_value FROM m_retail_demo WHERE event_time >= :from AND event_time < :to AND region IN (:region_0, :region_1, :region_2) AND channel = :channel_0
```

Each slot is declared `{ type: "string", required: true }` with a default, so the query
is runnable as it stands. Spare slots repeat the last picked value.

`by_dimension`, `by_time_<dim>` and `segments` never get the clause: they select the
dimension, so the app narrows them after the rows land. If someone asks why a tile and a
breakdown disagree, this is why — the tile is scoped to the filtered set.

### `ab_test` family (`m_checkout_demo`: `timestamp`, entity `test_id`, arms `variant_name`)

Every query but `entity_list` is scoped to one experiment with `test_id = :entity`.

**`entity_list`** — *which experiments are there, biggest first.*

```sql
SELECT test_id, test_name, test_desc, test_status, test_group, test_end, unique_bookers FROM m_checkout_demo WHERE timestamp >= :from AND timestamp < :to ORDER BY unique_bookers DESC LIMIT 1000
```

**`experiment_meta`** — *the test's own description, status, dates: the header copy.*

```sql
SELECT variant_name, test_desc, test_status, test_start, test_end, data_as_of, test_group, unique_bookers FROM m_checkout_demo WHERE test_id = :entity AND timestamp >= :from AND timestamp < :to
```

**`arm_totals`** — *one row per arm; the verdict and the KPI tiles come from this.*

```sql
SELECT variant_name, arm_participants, control_participants, total_participants, unique_bookers, order_count, order_value FROM m_checkout_demo WHERE test_id = :entity AND timestamp >= :from AND timestamp < :to
```

**`segments`** — *arm × every cut; lifters, draggers, insights and heatmaps.*

```sql
SELECT variant_name, device, market, customer_tier, unique_bookers, order_count, order_value FROM m_checkout_demo WHERE test_id = :entity AND timestamp >= :from AND timestamp < :to ORDER BY unique_bookers DESC LIMIT 10000
```

**`daily_trend`** — *arm per day; has the lift settled since the test started.*

```sql
SELECT date_trunc('day', timestamp) AS day, variant_name, unique_bookers, order_count, order_value, arm_participants, control_participants, total_participants FROM m_checkout_demo WHERE test_id = :entity AND timestamp >= :from AND timestamp < :to
```

## Errors you will see

| What you get | What it means |
| --- | --- |
| `query_not_allowed` | Only inside an app: that query id is not in the app's manifest. Nothing to do with the SQL. |
| unknown column / metric not resolved | A guessed name, or a metric you aggregated yourself. `query_search_fields` for the real name; select the metric as-is. |
| `time_range_required` | One end of the range is missing. Both are needed. |
| `no_joins`, `no_subqueries`, `unsupported_where` | The grammar above. Run two queries and combine the rows yourself. |
| `missing_param` | A `:name` in the SQL with no value in `params`. |
| zero rows, no error | Almost always the availability window. Check `query_describe_model` before you say "no data" — the answer is usually "not for those dates". |

## When answering a person

Say what you ran, in one line, before the number: **"From the retail model: refund rate
by region, last 30 days."** Then the number, with its as-of date. Then, only if it is
load-bearing, the caveat — a thin segment, a window that ends early.

Offer the SQL only if they ask for it. Never mention manifests, bundles, query ids or
tool names; those are plumbing, and naming them makes a person doubt the number rather
than trust it.
