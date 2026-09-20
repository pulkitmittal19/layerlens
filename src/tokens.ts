/* Token discovery and reverse lookup.
 *
 * Zero config on purpose. Every custom property the page declares is read off
 * the document element once, resolved to its computed value, and indexed the
 * other way round — value to name. A measured `rgb(16, 24, 40)` can then say
 * "that is --text-primary" without anyone writing a mapping by hand.
 *
 * Several names can share a value; an alias chain (--surface -> --white ->
 * #fff) collapses to one value at the end of it. All names are kept and the
 * shortest wins, because the shortest is almost always the role rather than the
 * primitive it points at, and the role is the one a person should be told.
 */
import { canonical } from './color'

export interface TokenTable {
  /** name -> computed value, e.g. `--text-primary` -> `rgb(16, 24, 40)`. */
  byName: Map<string, string>
  /** canonical value -> names sharing it. */
  byValue: Map<string, string[]>
}

function declaredNames(prefixes?: string[]): Set<string> {
  const names = new Set<string>()
  const keep = (n: string) =>
    !prefixes?.length || prefixes.some(p => n.startsWith(p))

  const walk = (rules: CSSRuleList) => {
    for (const rule of rules as unknown as CSSRule[]) {
      const nested = (rule as CSSGroupingRule).cssRules
      if (nested && !(rule as CSSStyleRule).selectorText) { walk(nested); continue }
      const style = (rule as CSSStyleRule).style
      if (!style) continue
      if (nested) walk(nested)
      for (let i = 0; i < style.length; i++) {
        const prop = style[i]
        if (prop.startsWith('--') && keep(prop)) names.add(prop)
      }
    }
  }

  for (const sheet of Array.from(document.styleSheets)) {
    /* A cross-origin sheet throws on .cssRules. Its variables are not ours to
       document, so skipping it is the right answer rather than a limitation. */
    try { walk(sheet.cssRules) } catch { /* cross-origin */ }
  }
  return names
}

/** Read every declared custom property and index it both ways. */
export function buildTokenTable(prefixes?: string[]): TokenTable {
  const root = getComputedStyle(document.documentElement)
  const byName = new Map<string, string>()
  const byValue = new Map<string, string[]>()

  for (const name of declaredNames(prefixes)) {
    const raw = root.getPropertyValue(name).trim()
    if (!raw) continue
    const value = canonical(raw)
    byName.set(name, value)
    const list = byValue.get(value)
    if (list) list.push(name)
    else byValue.set(value, [name])
  }
  for (const names of byValue.values()) names.sort((a, b) => a.length - b.length || a.localeCompare(b))
  return { byName, byValue }
}

/* What a token for each property is usually called. A design system names a
   colour for the job it does, so `color` is served by `--text-*` and never by
   `--bg-*`. Without this the shortest alias wins and a text colour gets
   reported as `--foreground` when the system's own name is `--text-primary` —
   correct, and useless to the person reading it. */
const HINTS: Array<[RegExp, RegExp]> = [
  [/^color$|^fill$/,            /text|foreground|\bfg\b|ink|content/],
  [/background|^stroke$/,       /\bbg\b|background|surface|fill|canvas/],
  [/border-color|outline-color/,/border|stroke|outline|divider|rule/],
  [/padding|margin|gap/,        /space|spacing|\bsp\b|gap|inset/],
  [/radius/,                    /radius|round|corner/],
  [/shadow/,                    /shadow|elevation|depth/],
]

/**
 * The token whose value equals this one, or null.
 *
 * Several names commonly share a value — an alias chain collapses to one colour
 * at the end of it. Preference goes to a name that reads like the property it
 * is being used for, then to the shorter name, which is nearly always the role
 * rather than the primitive underneath it.
 */
export function tokenFor(table: TokenTable, value: string, property?: string): string | null {
  const names = table.byValue.get(canonical(value))
  if (!names?.length) return null
  if (!property) return names[0]
  const hint = HINTS.find(([prop]) => prop.test(property))?.[1]
  if (!hint) return names[0]
  return names.find(n => hint.test(n)) ?? names[0]
}
