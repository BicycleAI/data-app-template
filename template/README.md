# data-app-ui

The template an agent starts from to build a **Bicycle data app**: a small
React app that renders one question about one semantic model, ships as a zip,
and is hosted by the Bicycle Studio service.

**If you are an agent, read [README-FOR-AGENTS.md](README-FOR-AGENTS.md) first.**
It is the contract, and most of it cannot be discovered by reading the code.

## What you get

```
bda.manifest.json     the declared-query contract — the only way data reaches the app
src/studio/           the host contract: context, query client, hooks, theming
src/components/        Chart (Observable Plot) and DataTable
src/theme.css          the --bda-* tokens, light and dark
src/App.tsx            replace this
```

```bash
npm install
npm run build     # typechecks, then emits exactly dist/app.js and dist/app.css
npm test
```

## The two service contracts

An app bundle is portable, but the API you submit it to is not. Know which one
you are targeting:

| | `bicycle-studio-api` (remote / MCP) | `bicycle-studio-ui` server (local) |
| --- | --- | --- |
| Submit | zip -> signed GCS upload -> `complete` with sha256 | JSON body with inline file contents |
| Create | `POST /api/data-apps` | `POST /api/data-apps/apps` |
| Queries | **semantic SQL** against one bound model | SQL over the dataset |
| Agent access | MCP tools at `/mcp` (`dataapp_*`, `query_*`) | REST only |

`README-FOR-AGENTS.md` documents the **semantic-SQL / MCP** path, because that
is where metrics, models and availability windows live.

## Constraints you cannot work around

The embed page sets `script-src 'self'` and `connect-src 'self'`: no CDN
scripts, no external fetches, no web fonts. The frame has an opaque origin, so
`localStorage`, `sessionStorage` and cookies throw. Charting is Observable
Plot, already installed, and nothing else. Build output must stay `app.js` and
`app.css`.
