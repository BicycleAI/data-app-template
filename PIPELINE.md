# How to build a data app: three stops, and everything else on your own

Read this before you start. It is the procedure; nothing in the code enforces it.

It applies to **both** ways of building an app — composing a spec
(`skills/ask-show-ship/SKILL.md`, the default) and hand-building from
`template/` (the escape hatch). The skill has the seven moves in full; this
file is the part that does not change between them.

The whole thing rests on one rule:

> **Never ask a person something the catalog can answer.**
> Don't ask what data they have — look. Don't ask what a field is called — look.
> Don't ask what dates are valid — look.
> Only ask what is in their head: what they care about, and what it should look like.

Everything you ask costs them attention. Everything you don't ask has to be
right, or the app is wrong and nobody finds out until the end.

## The three stops

| Stop | Question | What it catches |
| --- | --- | --- |
| 1 | What do you want to see? | the wrong numbers picked |
| 2 | Do these numbers look right? | the wrong data entirely |
| 3 | How should it look? | the wrong shape |

Three, not ten: everything else runs unattended, and a person clicks about four
times in total. If they had to answer every question it would be a form, and a
form is worse than writing the code by hand.

Three, not zero: an unattended run is only discovered to be wrong after it is
published, when fixing it costs the most.

## The loop

```
1.  query_list_models(match="revenue")     look: which use cases exist, and their real dates
    ── STOP 1a ──  ask which one                 (the binding is permanent)
2.  design_model_card(model) / dataapp_start(model=…)
3.  query_scope_options(model, about=…)    look: the KPIs, splits and date ranges that are real
    ── STOP 1b ──  ask in order: KPI, then split, then dates
4.  write each question, prove it
    ── STOP 2 ──   show the totals, ask if they look right
    ── STOP 3 ──   show the layouts, ask which
5.  ship
```

Stop 1a comes first for one reason only: the model binding cannot be changed
afterwards, and a second use case means a second app. Everything after step 2
is yours to run in whatever order the work needs.

### Where each stop lands in the seven moves

| Stop | Move in `ask-show-ship` |
| --- | --- |
| 1a | 1 — name the decision |
| 1b | 2 and 4 — what the data can say, then build the questions |
| 3 | 3 — who is it for, and which layout |
| 2 | 4 — the `design_recipe_preview` rows, before anything is composed |

The skill runs stop 3 before stop 2, because the layout decides which questions
are worth proposing. Both orders are fine. What is not fine is skipping one.

---

## Stop 1 — what do you want to see?

**1a. Which use case.** `query_list_models(match=…)` returns the few that match,
each with the date range it really holds and whether it has gone stale. Put
those to the person. If only one matches, say so and use it — that is not a
choice worth asking about.

**1b. What it should show.** `query_scope_options(model, about=…)` has already
done the looking:

- pre-cut slices are folded into the KPI they are a slice of, so
  `total_order_spend_k8` shows up as a way to split revenue, not as a different
  number. Thirty listed KPIs are usually four or five real ones.
- any KPI with no data in the window is dropped, and named so you can say why.
- date ranges are built from the data's own window. Never offer "the last 30
  days" of a calendar: a model that stopped in May returns nothing for it.
- each KPI says whether it is already a sum or already an average, so you never
  wrap it twice.

Put them to the person **in this order — KPI, then split, then dates**:

| # | Ask | Comes from |
| --- | --- | --- |
| 1 | which KPI | the folded KPI list |
| 2 | what to split it by | the splits list |
| 3 | which date range | the ranges built from the data's own window |

**Slices and dimensions are one question, not two.** A pre-cut slice like
`total_order_spend_k8` and a dimension like `city` both answer "split revenue
by what?". Offer them together in the same four options. Never make a person
answer that twice.

**Do not pick for them**, and do not pass the tool's own ordering off as their
answer.

### How to ask

**Four options per question, and no more.** Past four it is a form. The tool
returns more than four rows on purpose — you choose the four worth showing, and
say how many you are not showing:

> 4 of 30 shown · say the word for any other

If they name something you did not show, `query_search_fields` for it and ask
again. Never guess what they meant.

**Claude:** use `AskUserQuestion`. One row in, one option out; the KPI column
goes in the option's description. Cards cannot pre-tick, so put the best option
first and label it `(Recommended)`.

**Anything else:** number the options and ask in chat.

**Dates come last, and that costs you something — know what it is.** The KPIs
the tool offers are the ones with data in the *model's* whole window. A person
can still pick a narrower range in which the KPI they chose is empty. Asking
dates first would rule that out, at the price of a date question before anyone
has said what they care about.

So ask dates last, then check. `query_run` at stop 2 returns the real rows for
the range they picked. Zero rows there means the KPI and the range do not
overlap — say that plainly and re-ask the **range**, not the KPI.

---

## Stop 2 — do these numbers look right?

Before you build anything, show the totals. This is the cheapest place to catch
the wrong use case: nothing has been written yet.

1. **Prove every question first.** Composing, that is
   `design_recipe_preview` — real cached rows, free. Hand-building, that is
   `query_run`, which is cache-only and also free. A query that fails later
   marks the **whole version** invalid, and the error there is far worse than
   the one you get now. Never put a broken query in front of a person — that is
   your problem, not theirs.
2. Show the headline numbers, and the same numbers for the period before.
3. **Say plainly which numbers you chose rather than read.** Thresholds, bands,
   ratios — anything you picked. Then print each one on the card that uses it.
   An unlabelled guess reads as a fact.

If the totals are wrong, the use case is wrong, and nothing has been built.

---

## Stop 3 — how should it look?

Call `design_templates` and show what it returns. Today, per family:

| id | shape | suits |
| --- | --- | --- |
| `scorecard` | the answer first: verdict, tiles, one breakdown, one trend | many numbers at once, checked daily |
| `brief` | one screen for a phone: a verdict and the tiles | one question, answered in a sentence |
| `report` | a document to read: tiles, narrative, trends, rankings, table | a thing circulated and discussed |
| `explorer` | filter rail, breakdown per dimension, heatmap, ranking | digging, slicing, follow-ups |
| `monitor` | sparkline tiles, one trend, one breakdown, nothing to operate | a wall screen, watched not read |

**Put the persona's default first and label it `(Recommended)`.** Someone who
does not care answers in one word and gets exactly what they would have got
before there was a choice. Four options at most, the default always among them.

A template is a **layout**, not a colour: all of them draw the same recipes
with the same `--bda-*` tokens. Do not ask a person to describe a layout in
words.

---

## Between the stops, work unattended

- Prove every question before you declare it.
- Semantic SQL has no `OR` and no `JOIN`. An "All" sentinel
  (`WHERE rep = :rep OR :rep = 'All'`) does not compile — declare the query
  unfiltered and let the app treat "All" as no filter. The full grammar is in
  `skills/semantic-query/SKILL.md`, and nowhere else.
- A metric that is already a sum must never be wrapped in `sum()`.
  `query_scope_options` says which is which.
- Retry a 5xx from the semantic layer once before reporting it.

## What not to do

- **Do not answer your own question.** The tools return options, not decisions.
  Nothing checks that you asked — that is exactly why it matters.
- **Do not bind two models to one app.** The model binding is permanent.
- **Do not treat a declined question as a no.** It means ask differently.
- **Do not skip stop 2 because the queries ran.** Running is not the same as
  being the numbers a person expected.
