/* The agent API.
 *
 * An annotation tool tells a coding agent WHERE the human pointed — a selector,
 * a component, a note. It does not tell it what the element actually measures.
 * This closes that gap without either tool knowing about the other: the agent
 * takes the selector out of the annotation and asks the page.
 *
 *   await page.evaluate(() => window.__styleLens.readSelector('.cl-main'))
 *   await page.evaluate(() => window.__styleLens.audit())
 *
 * Deliberately global and deliberately plain JSON. Anything that can run a line
 * of JavaScript in the page can use it — Playwright, Puppeteer, a devtools
 * console, an MCP browser tool, a bookmarklet. No transport, no protocol.
 */
import { Lens } from './inspect'
import { describe as describeReading, enrich as enrichAnnotation, type AnnotationLike } from './annotate'
import type { Audit, Inspection } from './types'

export interface StyleLensGlobal {
  version: string
  /** Measure one element by CSS selector. Null when it does not match. */
  readSelector(selector: string): Inspection | null
  /** Measure the element at a viewport point — pairs with an annotation's x/y. */
  readPoint(x: number, y: number): Inspection | null
  /**
   * Group every off-system value on the page, commonest first.
   *
   *   __styleLens.audit()                                  the whole page
   *   __styleLens.audit({ root: 'table' })                 one region
   *   __styleLens.audit({ properties: ['type'] })          type only
   */
  audit(options?: { root?: string; properties?: string[] }): Audit
  /** Every type role stylelens knows about, to sanity-check configuration. */
  roles(): Array<{ name: string; fontSize: string; fontWeight?: string; lineHeight?: string }>
  /**
   * An annotation from any feedback tool, plus what its element measures.
   * Accepts `elementPath`, `selector`, `element` or `x`/`y`.
   */
  enrich<T extends AnnotationLike>(annotation: T): T & { styleLens: Inspection | null }
  /** A reading as one readable line, for a comment or a chat message. */
  describe(found: Inspection | null): string
  /** Re-read the stylesheet after a theme switch or an HMR update. */
  refresh(): void
}

declare global {
  interface Window { [key: string]: unknown }
}

export function createGlobal(lens: Lens, version: string): StyleLensGlobal {
  return {
    version,
    readSelector: (selector) => lens.readSelector(selector),
    readPoint: (x, y) => {
      const el = document.elementFromPoint(x, y)
      return el ? lens.read(el) : null
    },
    audit: (options = {}) => {
      const root = options.root ? document.querySelector(options.root) : document.body
      return lens.audit({ root: root ?? document.body, properties: options.properties })
    },
    roles: () => lens.knownRoles(),
    enrich: (annotation) => enrichAnnotation(annotation, { lens }),
    describe: (found) => describeReading(found),
    refresh: () => lens.refresh(),
  }
}
