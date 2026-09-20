/* stylelens — public types.
 *
 * The shape of a reading is the contract between the overlay (for people), the
 * agent API (for coding agents) and the page audit. One reader, three surfaces.
 */

/** How a single CSS value scored against the design system. */
export type Verdict =
  | { status: 'token'; name: string }        // resolved to a declared custom property
  | { status: 'role'; name: string }         // matched a named type role
  | { status: 'raw' }                        // a literal value with no token behind it
  | { status: 'unset' }                      // nothing set / not applicable

/** Where a winning declaration came from. */
export interface Origin {
  /** Selector of the rule that won, e.g. `.ct-table tbody td`. */
  selector: string
  /** Cascade layer the rule sits in, or `null` when unlayered. */
  layer: string | null
  /** True when the declaration carried `!important`. */
  important: boolean
  /** Stylesheet href, or `inline` for a <style> block. */
  source: string
  /**
   * Set when nothing styled this element and the value came from an ancestor.
   * Carries a selector for the ancestor that did set it — "inherited" alone
   * says the search failed, and naming the source is the whole question.
   */
  inheritedFrom?: string
}

/** One measured property. */
export interface Reading {
  property: string
  /** Computed value, exactly as the browser resolved it. */
  value: string
  verdict: Verdict
  origin: Origin | null
  /** Set when the value is raw but a declared token holds the same value. */
  nearestToken?: string
}

/** Everything stylelens knows about one element. */
export interface Inspection {
  selector: string
  tagName: string
  className: string
  text: string
  box: { x: number; y: number; width: number; height: number }
  /**
   * Type role match across font-size / weight / line-height together.
   * `suggestion` is set only when nothing matched — the closest role, so the
   * panel can say what to use instead of only what is wrong.
   */
  type: { value: string; verdict: Verdict; origin: Origin | null; suggestion?: { name: string; value: string } }
  readings: Reading[]
  /** Readings whose verdict is `raw` — the ones worth fixing. */
  offSystem: Reading[]
}

/** A whole-page audit. */
export interface Audit {
  url: string
  total: number
  onSystem: number
  offSystem: number
  /** Grouped by the value that is off-system, commonest first. */
  groups: Array<{ property: string; value: string; count: number; examples: string[] }>
}

export interface StyleLensConfig {
  /**
   * Named type roles. Omit to auto-discover Tailwind v4 `--text-*` roles from
   * the emitted theme, which is the zero-config path.
   *
   *   { 'label-md': { fontSize: '14px', fontWeight: '500', lineHeight: '20px' } }
   */
  roles?: Record<string, { fontSize: string; fontWeight?: string; lineHeight?: string }>
  /**
   * What a type-role class name looks like. Default `/^text-[a-z][\w-]*$/`,
   * which is Tailwind's convention. Roles are found by scanning the emitted CSS
   * for single-class rules that set font-size, because Tailwind v4's
   * `@theme inline` never emits the role variables themselves.
   */
  rolePattern?: RegExp
  /**
   * Only treat custom properties starting with one of these as design tokens.
   * Omit to accept every `--*` declared on :root. Narrow it when a page also
   * carries third-party variables you do not own.
   */
  tokenPrefixes?: string[]
  /** Properties to read. Sensible default covers type, colour, spacing, shape. */
  properties?: string[]
  /** Elements matching any of these are skipped by the audit. */
  ignore?: string[]
  /** Attach the agent API to `window`. Default true. */
  exposeGlobal?: boolean
  /** Global name. Default `__styleLens`. */
  globalName?: string
}
