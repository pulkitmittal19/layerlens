/* Which declaration actually won, and which cascade layer it came from.
 *
 * This is the part no existing inspector reports, and it is the one that costs
 * whole afternoons. An unlayered rule beats every layered one whatever its
 * specificity, so a design-system utility can be present, correct, and have no
 * effect — with no error anywhere. Naming the winning layer turns that from a
 * mystery into a one-line answer.
 *
 * The order implemented here is the cascade's own, minus `@scope` proximity and
 * transitions, neither of which appears in the situations this is built for:
 *   !important  >  layer rank  >  specificity  >  document order
 * For important declarations layer rank inverts, which is the rule people
 * misremember most often, so it is written out rather than assumed.
 */
import type { Origin } from './types'

type Candidate = Origin & { specificity: number; order: number; layerRank: number }

/** a-b-c specificity, packed into one comparable number. */
export function specificity(selector: string): number {
  /* Only the winning compound matters for a comma list, but the browser has
     already told us the element matches; taking the highest is the safe read. */
  return Math.max(...selector.split(',').map(part => {
    const s = part.trim()
    const ids = (s.match(/#[\w-]+/g) || []).length
    const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)(?!where\b)[\w-]+/g) || []).length
    const types = (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length
    return ids * 10000 + classes * 100 + types
  }))
}

/** Layer precedence: first declaration order wins, and unlayered beats all. */
function layerOrder(): Map<string, number> {
  const rank = new Map<string, number>()
  let n = 0
  const note = (name: string) => { if (!rank.has(name)) rank.set(name, n++) }
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules as unknown as CSSRule[]) {
      const type = rule.constructor.name
      if (type === 'CSSLayerStatementRule') {
        for (const name of (rule as unknown as { nameList: string[] }).nameList) note(name)
      } else if (type === 'CSSLayerBlockRule') {
        note((rule as unknown as { name: string }).name || '')
        walk((rule as CSSGroupingRule).cssRules)
      } else if ((rule as CSSGroupingRule).cssRules) {
        walk((rule as CSSGroupingRule).cssRules)
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try { walk(sheet.cssRules) } catch { /* cross-origin */ }
  }
  return rank
}

let cachedLayers: Map<string, number> | null = null
/** Call after a stylesheet is added or a layer is declared. */
export function invalidateLayerOrder(): void { cachedLayers = null; index = null }

/* ── The rule index ───────────────────────────────────────────────────────────
   Before this, `winningRule` walked every rule in every stylesheet on every
   call — and it is called once per property, then again per ancestor for the
   inherited ones. On a page with 53 stylesheets that made a single hover read
   cost 40ms against a 16.7ms frame, which is what made the overlay jitter.

   Almost all of that walk is the same answer every time: which rules set which
   property, with what specificity, in which layer. Only `el.matches` depends on
   the element. So the walk happens once and is kept, keyed by property, and a
   read becomes a match against the handful of rules that set the property it
   asks about.

   Held until something changes the stylesheets — `invalidateLayerOrder()`,
   which `Lens.refresh()` already calls, and a cheap sheet-count check for the
   dev-server case where HMR adds one.                                        */
type Indexed = Omit<Candidate, 'layerRank'> & { layerRank: number }
let index: Map<string, Indexed[]> | null = null
let indexedSheets = -1

function buildIndex(): Map<string, Indexed[]> {
  const layers = (cachedLayers ??= layerOrder())
  const unlayered = layers.size + 1
  const byProperty = new Map<string, Indexed[]>()
  let order = 0

  const walk = (rules: CSSRuleList, layer: string | null, source: string) => {
    for (const rule of rules as unknown as CSSRule[]) {
      const type = rule.constructor.name
      if (type === 'CSSLayerBlockRule') {
        walk((rule as CSSGroupingRule).cssRules, (rule as unknown as { name: string }).name || '(anonymous)', source)
        continue
      }
      const style = (rule as CSSStyleRule).style
      const selector = (rule as CSSStyleRule).selectorText
      if (!selector || !style) {
        if ((rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules, layer, source)
        continue
      }
      order++
      const spec = specificity(selector)
      const layerRank = layer === null ? unlayered : layers.get(layer) ?? 0
      /* `style` is index-addressable and only lists the properties the rule
         actually declares, which is the whole saving: no getPropertyValue
         probe per property per rule. */
      for (let i = 0; i < style.length; i++) {
        const property = style[i]
        let bucket = byProperty.get(property)
        if (!bucket) byProperty.set(property, bucket = [])
        bucket.push({
          selector, layer, source, order,
          important: style.getPropertyPriority(property) === 'important',
          specificity: spec, layerRank,
        })
      }
    }
  }

  for (const sheet of Array.from(document.styleSheets)) {
    const source = sheet.href ? sheet.href.split('/').pop()! : 'inline'
    try { walk(sheet.cssRules, null, source) } catch { /* cross-origin */ }
  }
  indexedSheets = document.styleSheets.length
  return byProperty
}

/** The declaration that won `property` on `el`, or null when nothing set it. */
export function winningRule(el: Element, property: string): Origin | null {
  if (index && indexedSheets !== document.styleSheets.length) index = null
  const rules = (index ??= buildIndex()).get(property)
  const layers = (cachedLayers ??= layerOrder())
  const unlayered = layers.size + 1
  const found: Candidate[] = []

  if (rules) {
    for (const candidate of rules) {
      let matches = false
      try { matches = el.matches(candidate.selector) } catch { /* :has() etc. in old engines */ }
      if (matches) found.push(candidate)
    }
  }

  /* The element's own style attribute outranks every stylesheet rule that is
     not !important, and it has no selector to report. */
  const inline = (el as HTMLElement).style?.getPropertyValue(property)
  if (inline) {
    found.push({
      selector: 'style=""', layer: null, source: 'inline attribute', order: Infinity,
      important: (el as HTMLElement).style.getPropertyPriority(property) === 'important',
      specificity: Infinity, layerRank: unlayered,
    })
  }

  if (!found.length) return null
  found.sort((a, b) =>
    Number(a.important) - Number(b.important) ||
    /* Important declarations invert layer order — an earlier layer wins. */
    (a.important ? b.layerRank - a.layerRank : a.layerRank - b.layerRank) ||
    a.specificity - b.specificity ||
    a.order - b.order)
  const win = found[found.length - 1]
  return { selector: win.selector, layer: win.layer, important: win.important, source: win.source }
}
