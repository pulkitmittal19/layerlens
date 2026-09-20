/* The reader. One element in, one Inspection out.
 *
 * Everything else in stylelens is a surface over this function: the overlay draws
 * it, the agent API returns it as JSON, the audit runs it across a page. There
 * is one measurement path, so the panel a designer reads and the numbers an
 * agent acts on can never disagree.
 */
import type { Audit, StyleLensConfig, Inspection, Origin, Reading, Verdict } from './types'
import { canonical, isColourProperty } from './color'
import { buildTokenTable, tokenFor, type TokenTable } from './tokens'
import { winningRule } from './cascade'
import { configuredRoles, discoverRoles, matchRole, nearestRole, type Role } from './roles'

const DEFAULT_PROPERTIES = [
  'color', 'background-color', 'border-color',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'gap', 'border-radius', 'border-width', 'box-shadow',
]

/** A short, stable selector for an element — readable, and good enough to re-find it. */
/* `className` is a string on HTML and an SVGAnimatedString on SVG, so
   `String(el.className)` turns every icon into `[object SVGAnimatedString]` —
   which is what the panel showed for any element inside an icon. The class
   ATTRIBUTE is a string on both. */
export function classesOf(el: Element): string {
  return el.getAttribute('class') || ''
}

export function selectorFor(el: Element): string {
  if (el.id) return `#${el.id}`
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== document.body && parts.length < 4) {
    const classes = classesOf(node)
      .split(/\s+/).filter(Boolean).slice(0, 2)
    parts.unshift(node.tagName.toLowerCase() + classes.map(c => `.${c}`).join(''))
    if (node.id) { parts[0] = `#${node.id}`; break }
    node = node.parentElement
  }
  return parts.join(' > ')
}

export class Lens {
  private table: TokenTable
  private roles: Role[]
  private properties: string[]

  constructor(private config: StyleLensConfig = {}) {
    /* A Lens reads the document as it is constructed, so it needs a real page.
       Importing this module does not — that is the point of the split — but a
       CI script that forgets to open one used to get
       `ReferenceError: getComputedStyle is not defined` from three frames deep
       in the token table, which says nothing about what to do. */
    if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
      throw new Error(
        'stylelens: new Lens() needs a browser document — it reads the page\'s custom ' +
        'properties as it is constructed. Run it inside the page (Playwright/Puppeteer ' +
        '`page.evaluate`, a devtools console, a bundled app), not in plain Node.',
      )
    }
    this.table = buildTokenTable(config.tokenPrefixes)
    const configured = configuredRoles(config)
    this.roles = configured.length ? configured : discoverRoles(config.rolePattern)
    this.properties = config.properties ?? DEFAULT_PROPERTIES
  }

  /** Re-read the stylesheet. Call after a theme switch or an HMR update. */
  refresh(): void {
    this.table = buildTokenTable(this.config.tokenPrefixes)
    if (!configuredRoles(this.config).length) this.roles = discoverRoles(this.config.rolePattern)
  }

  /** Every type role currently known, for a config sanity check. */
  knownRoles(): Role[] { return this.roles }

  /* A value that is not doing anything must not be reported. A fully
     transparent background matches whichever token happens to be
     `transparent`, and a border-colour on an element with no border is a
     number the engine carries and nobody ever sees. Both read as findings and
     both are noise — a panel full of noise stops being read. */
  private inert(computed: CSSStyleDeclaration, property: string, value: string): boolean {
    if (!value || value === 'none' || value === 'normal' || /^0(px)?$/.test(value)) return true
    if (/^rgba?\([^)]*,\s*0\s*\)$/.test(value)) return true
    if (property === 'border-color' && parseFloat(computed.borderTopWidth) === 0) return true
    if (property === 'gap' && !/flex|grid/.test(computed.display)) return true
    return false
  }

  private verdictFor(property: string, value: string): { verdict: Verdict; nearest?: string } {
    const name = tokenFor(this.table, value, property)
    if (name) return { verdict: { status: 'token', name } }
    /* Not a token. Say so, but also say whether the system already holds this
       exact value under a name — that turns "wrong" into a one-line fix. */
    const nearest = isColourProperty(property) ? tokenFor(this.table, canonical(value), property) : null
    return { verdict: { status: 'raw' }, nearest: nearest ?? undefined }
  }

  /* Inherited properties are the common case for text: the class sits on a
     wrapper and the span that holds the words has no rule of its own. Saying
     "nothing set this" is true and useless — it is the ancestor that decided,
     so find it and name it. Only these inherit; the rest genuinely have no
     origin when no rule matches. */
  private static readonly INHERITS = new Set([
    'color', 'font-size', 'font-weight', 'line-height', 'font-family', 'letter-spacing',
  ])

  private originOf(el: Element, property: string): Origin | null {
    const own = winningRule(el, property)
    if (own || !Lens.INHERITS.has(property)) return own
    let node = el.parentElement
    while (node) {
      const up = winningRule(node, property)
      if (up) return { ...up, inheritedFrom: selectorFor(node) }
      node = node.parentElement
    }
    return null
  }

  /**
   * Measure one element.
   *
   * `origins` costs a full walk of every rule in the document per property —
   * fine for the one element under the cursor, ruinous across a page. The audit
   * turns it off, which is the difference between 7 seconds and 70ms.
   */
  read(el: Element, opts: { origins?: boolean } = {}): Inspection {
    const withOrigins = opts.origins !== false
    const origin = (property: string) => (withOrigins ? this.originOf(el, property) : null)
    const computed = getComputedStyle(el)
    const box = el.getBoundingClientRect()

    const role = matchRole(this.roles, {
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
    })
    const typeValue = `${computed.fontSize} / ${computed.fontWeight} / ${computed.lineHeight}`

    const readings: Reading[] = []
    for (const property of this.properties) {
      const value = computed.getPropertyValue(property)
      if (this.inert(computed, property, value)) continue
      const { verdict, nearest } = this.verdictFor(property, value)
      readings.push({
        property, value, verdict,
        origin: origin(property),
        nearestToken: nearest,
      })
    }

    return {
      selector: selectorFor(el),
      tagName: el.tagName.toLowerCase(),
      className: classesOf(el),
      /* Collapsed, because textContent runs every descendant together: a table
         footer came out as "Show10 entries1-12 of 248 contacts12345". */
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
      type: {
        value: typeValue,
        verdict: role ? { status: 'role', name: role.name } : { status: 'raw' },
        origin: origin('font-size'),
        suggestion: role ? undefined : (() => {
          const near = nearestRole(this.roles, {
            fontSize: computed.fontSize, fontWeight: computed.fontWeight, lineHeight: computed.lineHeight,
          })
          if (!near) return undefined
          /* Same three-slot shape as the measured value, with an em dash where
             the role does not constrain that slot. `14px / 20px` reads as a
             size and a weight and means neither. */
          const slot = (v?: string) => v ?? '—'
          return {
            name: near.name,
            value: `${near.fontSize} / ${slot(near.fontWeight)} / ${slot(near.lineHeight)}`,
          }
        })(),
      },
      readings,
      /* Type is off-system too, so the API count and the panel count agree. */
      offSystem: [
        ...(role ? [] : [{
          property: 'type', value: typeValue,
          verdict: { status: 'raw' as const }, origin: origin('font-size'),
        }]),
        ...readings.filter(r => r.verdict.status === 'raw'),
      ],
    }
  }

  /** Read one element by selector — the entry point an agent calls. */
  readSelector(selector: string): Inspection | null {
    const el = document.querySelector(selector)
    return el ? this.read(el) : null
  }

  /**
   * Audit every element that renders text, grouped by the off-system value.
   *
   * Grouped rather than listed because a page has hundreds of elements and a
   * handful of mistakes: "64 elements at 13px/450" is a task, and 64 separate
   * findings is a wall.
   */
  audit(options: { root?: ParentNode; properties?: string[] } = {}): Audit {
    const root = options.root ?? document.body
    const only = options.properties && new Set(options.properties)
    const ignore = this.config.ignore ?? []
    const groups = new Map<string, { property: string; value: string; count: number; examples: string[] }>()
    let total = 0
    let off = 0

    for (const el of Array.from(root.querySelectorAll('*'))) {
      const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent?.trim())
      if (!hasText) continue
      if (ignore.some(sel => { try { return el.matches(sel) || el.closest(sel) } catch { return false } })) continue
      total++

      const found = this.read(el, { origins: false })
      const bad = found.offSystem
        .filter(r => !only || only.has(r.property))
        .map(r => ({ property: r.property, value: r.value }))
      if (!bad.length) continue
      off++
      for (const b of bad) {
        const key = `${b.property}|${b.value}`
        const entry = groups.get(key) ?? { property: b.property, value: b.value, count: 0, examples: [] }
        entry.count++
        if (entry.examples.length < 3) entry.examples.push(found.selector)
        groups.set(key, entry)
      }
    }

    return {
      url: location.href,
      total,
      onSystem: total - off,
      offSystem: off,
      groups: [...groups.values()].sort((a, b) => b.count - a.count),
    }
  }
}
