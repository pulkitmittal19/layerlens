/* Type roles — the named steps of a type ladder.
 *
 * A role says size, weight and line-height in one word: `text-label-md` rather
 * than "14px, 500, 20px". Reporting the word is the whole point; nobody can
 * tell whether `13px / 450` is on the system, and anyone can tell that it has
 * no name.
 *
 * DISCOVERY READS THE EMITTED CSS, NOT THE THEME VARIABLES, and that is not a
 * detail. Tailwind v4's `@theme inline` inlines a role's value into the utility
 * and never emits the variable, so reading `:root` finds almost nothing — on
 * the project this was built against it found 3 roles out of 9, each missing
 * its weight. The utility rules are always there, because they are what the
 * browser applies. So: find the rules, then resolve each one on a real element.
 *
 * Which properties a role CONSTRAINS comes from its rule; what those resolve to
 * comes from the probe. Both matter. A bare size step declares font-size only,
 * so it must not be treated as claiming a weight it never mentioned.
 */
import type { LayerLensConfig } from './types'

export interface Role {
  name: string
  fontSize: string
  fontWeight?: string
  lineHeight?: string
}

const DEFAULT_PATTERN = /^text-[a-z][\w-]*$/

/** Class names whose rule sets font-size and whose name looks like a role. */
function roleClasses(pattern: RegExp): Set<string> {
  const names = new Set<string>()
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules as unknown as CSSRule[]) {
      const nested = (rule as CSSGroupingRule).cssRules
      const selector = (rule as CSSStyleRule).selectorText
      if (nested && !selector) { walk(nested); continue }
      if (!selector) continue
      const style = (rule as CSSStyleRule).style
      if (!style?.getPropertyValue('font-size')) continue
      /* A single, unqualified class. `.text-label-md` is a role;
         `.cv-name-link .cl-main` and `.tab.active` are page styling. */
      const m = /^\.([\w-]+)$/.exec(selector.trim())
      if (m && pattern.test(m[1])) names.add(m[1])
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try { walk(sheet.cssRules) } catch { /* cross-origin */ }
  }
  return names
}

/** Which of the three a rule actually declares — the rest stay unconstrained. */
function declaredOn(className: string): { size: boolean; weight: boolean; height: boolean } {
  const out = { size: false, weight: false, height: false }
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules as unknown as CSSRule[]) {
      const nested = (rule as CSSGroupingRule).cssRules
      const selector = (rule as CSSStyleRule).selectorText
      if (nested && !selector) { walk(nested); continue }
      if (selector?.trim() !== `.${className}`) continue
      const style = (rule as CSSStyleRule).style
      if (!style) continue
      if (style.getPropertyValue('font-size')) out.size = true
      if (style.getPropertyValue('font-weight')) out.weight = true
      if (style.getPropertyValue('line-height')) out.height = true
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try { walk(sheet.cssRules) } catch { /* cross-origin */ }
  }
  return out
}

/**
 * Every type role the page can apply.
 *
 * `pattern` decides what counts as a role class. The default matches Tailwind's
 * `text-*`; a hand-rolled system passes its own, or skips this entirely by
 * configuring `roles` directly.
 */
export function discoverRoles(pattern: RegExp = DEFAULT_PATTERN): Role[] {
  const probe = document.createElement('span')
  probe.textContent = 'x'
  probe.setAttribute('aria-hidden', 'true')
  /* Off-screen rather than display:none — a hidden element still computes, but
     keeping it laid out means line-height resolves exactly as it will in use. */
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;pointer-events:none'
  document.body.appendChild(probe)

  const roles: Role[] = []
  try {
    for (const name of roleClasses(pattern)) {
      const declares = declaredOn(name)
      if (!declares.size) continue
      probe.className = name
      const computed = getComputedStyle(probe)
      roles.push({
        name,
        fontSize: computed.fontSize,
        fontWeight: declares.weight ? computed.fontWeight : undefined,
        lineHeight: declares.height ? computed.lineHeight : undefined,
      })
    }
  } finally {
    probe.remove()
  }
  return roles
}

export function configuredRoles(config: LayerLensConfig): Role[] {
  if (!config.roles) return []
  return Object.entries(config.roles).map(([name, r]) => ({ name, ...r }))
}

const near = (a: string | undefined, b: string | undefined) => {
  if (a === undefined || b === undefined) return true   // role does not constrain it
  const [x, y] = [parseFloat(a), parseFloat(b)]
  /* Sub-pixel tolerance. A role of 20px and a computed 19.9998px are the same
     decision; calling them different would make every match a near-miss. */
  return Number.isNaN(x) || Number.isNaN(y) ? a === b : Math.abs(x - y) < 0.5
}

/**
 * Best role for a computed type triple, or null.
 *
 * Scored by how much of the triple the role pins down, so a role that fixes
 * size, weight and line-height beats a bare size step that happens to share the
 * number — `text-label-md` rather than the `text-sm` it is built on. Equal
 * scores fall back to the longer name, which is the more specific role.
 */
export function matchRole(
  roles: Role[],
  computed: { fontSize: string; fontWeight: string; lineHeight: string },
): Role | null {
  let best: Role | null = null
  let bestScore = -1
  for (const role of roles) {
    if (!near(role.fontSize, computed.fontSize)) continue
    if (!near(role.fontWeight, computed.fontWeight)) continue
    if (!near(role.lineHeight, computed.lineHeight)) continue
    const score = (role.fontWeight ? 1 : 0) + (role.lineHeight ? 1 : 0)
    if (score > bestScore || (score === bestScore && best !== null && role.name.length > best.name.length)) {
      best = role
      bestScore = score
    }
  }
  return best
}

/**
 * The role this value is closest to, when it matches none exactly.
 *
 * A finding is only half an answer. "13px / 450 is not on the system" tells you
 * something is wrong; "nearest is text-label-md — 14px / 500 / 20px" tells you
 * what to type. Ranked by distance in size first, because size is the decision
 * a person actually made, then by weight.
 */
export function nearestRole(
  roles: Role[],
  computed: { fontSize: string; fontWeight: string; lineHeight: string },
): Role | null {
  const size = parseFloat(computed.fontSize)
  const weight = parseFloat(computed.fontWeight)
  if (Number.isNaN(size)) return null
  let best: Role | null = null
  let bestCost = Infinity
  for (const role of roles) {
    const rs = parseFloat(role.fontSize)
    if (Number.isNaN(rs)) continue
    const rw = role.fontWeight ? parseFloat(role.fontWeight) : weight
    /* Size dominates: a 2px gap should outrank any weight difference, and
       weights run to 900 while sizes run to ~32. */
    const cost = Math.abs(rs - size) * 100 + Math.abs(rw - weight) / 100
    if (cost < bestCost) { bestCost = cost; best = role }
  }
  return best
}
