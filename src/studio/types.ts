/**
 * The contract between a generated app and the service that hosts it.
 */

export type BdaContext = {
  readonly v: 1
  readonly appId: string
  readonly version: number
  /** API root, absolute or service-relative. Supplied by the embed page. */
  readonly apiBase: string
  /** Short-lived view token. Replaced in place when the host re-mints it. */
  readonly token: string
  readonly expiresAt: string
  /**
   * The theme in effect when the app booted.
   *
   * A snapshot, not a subscription: the viewer can change their system theme
   * while the page is open. Read `currentTheme()` from `studio/theme.js` for
   * the live value, and `onThemeChange` to be told when it moves.
   */
  readonly theme: 'dark' | 'light'
  /**
   * What the host asked for. `'system'` — the normal case — means follow
   * `prefers-color-scheme`.
   *
   * Optional because an app bundle can outlive the embed page that framed it:
   * a bundle built against this field and loaded by an older frame reads
   * `undefined` and falls back to following the system.
   */
  readonly themePreference?: 'system' | 'light' | 'dark'
}

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'

export type Scalar = string | number | boolean | null

export type Filter = {
  /** Must be a column the app's manifest declared for this query. */
  readonly field: string
  readonly op: FilterOp
  readonly value?: Scalar
  readonly values?: readonly Scalar[]
}

export type Sort = { readonly field: string; readonly dir: 'asc' | 'desc' }

export type QueryColumn = { readonly name: string; readonly type: string }

export type QueryResult = {
  readonly columns: readonly QueryColumn[]
  readonly rows: readonly (readonly unknown[])[]
  readonly meta: {
    readonly rowCount: number
    readonly truncated: boolean
    readonly elapsedMs?: number
  }
}

/**
 * The AI summary an agent published against this app, as the service returns it.
 *
 * Written by Claude, Codex or whatever else drives the studio's MCP tools — never
 * by the app, which has no way to generate prose and no credential to store it.
 */
export type AppSummary = {
  readonly headline: string
  readonly bullets: readonly string[]
  readonly range: { readonly from: string; readonly to: string }
  readonly generatedAt: string
  readonly generatedBy: string
  /** How the agent named itself, e.g. `claude-opus-5`. Empty when it did not say. */
  readonly writer: string
  readonly factsDigest: string
  /**
   * Whether the data has moved since the prose was written.
   *
   * Three-valued on purpose. `null` means nobody can tell — the summary was
   * published without a facts digest — and showing that as "current" would be a
   * claim the service never made.
   */
  readonly stale: boolean | null
}

export type QueryOptions = {
  readonly parameters?: Readonly<Record<string, Scalar>>
  readonly filters?: readonly Filter[]
  readonly sort?: readonly Sort[]
  readonly limit?: number
}

/**
 * A failure from the service, with the code to branch on.
 *
 * `token_expired` is the one worth handling: the host page re-mints on a timer,
 * so the right response is to let the next attempt succeed rather than to show
 * the user an error.
 */
export class BdaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'BdaError'
  }
}

declare global {
  interface Window {
    __BDA_CONTEXT?: BdaContext
  }
}
