/* Colour normalisation.
 *
 * A token is authored as `#101828`; the browser reports `rgb(16, 24, 40)`. Two
 * spellings of one colour, and a naive string compare says they are different —
 * which would report every tokenised colour as raw.
 *
 * Both sides go through the same resolver: set the value on a detached element
 * and read back what the engine computed. Whatever canonical form the browser
 * uses, both sides get the same one, so the comparison holds for hex, rgb, hsl,
 * oklch and colour-mix alike without this file knowing any colour maths.
 */

let probe: HTMLElement | null = null

function el(): HTMLElement {
  if (!probe) {
    probe = document.createElement('span')
    probe.style.display = 'none'
    document.documentElement.appendChild(probe)
  }
  return probe
}

const cache = new Map<string, string>()

/** Canonical form of any CSS value, or the trimmed input when it is not a colour. */
export function canonical(value: string): string {
  const v = value.trim()
  if (!v) return ''
  const hit = cache.get(v)
  if (hit !== undefined) return hit

  const node = el()
  /* A value the engine rejects leaves the previous one in place, which would
     silently canonicalise it to the wrong colour. Clearing first makes an
     invalid value read back as empty rather than as its predecessor. */
  node.style.color = ''
  node.style.color = v
  const out = node.style.color ? getComputedStyle(node).color : v
  cache.set(v, out)
  return out
}

/** True when a property's values should be compared as colours. */
export function isColourProperty(property: string): boolean {
  return /color$/.test(property) || property === 'fill' || property === 'stroke'
}

/**
 * `rgb(16, 24, 40)` as `#101828`.
 *
 * Designers read hex. The browser only ever reports rgb/rgba from a computed
 * style, so every colour in the panel would otherwise be in a notation nobody
 * uses to write CSS. Alpha is kept as a percentage rather than folded into an
 * eight-digit hex, which is harder to read than the thing it replaced.
 */
export function toHex(value: string): string {
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim())
  if (!m) return value
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
  const [r, g, b, a = 1] = parts
  if ([r, g, b].some(n => Number.isNaN(n))) return value
  const hex = '#' + [r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase()
  return a < 1 ? `${hex} ${Math.round(a * 100)}%` : hex
}
