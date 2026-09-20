/* Tests for the parts that need no browser.
 *
 * layerlens is mostly a reader of live CSS, and most of it genuinely cannot be
 * tested without a document. But the arithmetic underneath — specificity,
 * which role a value is nearest, how far apart two boxes are, how a colour is
 * written for a human — is pure, and it is also where a quiet wrong answer
 * does the most damage: a mis-ranked selector names the wrong winning rule,
 * and the whole point of the tool is that it names the right one.
 *
 * Every expectation here was read off the implementation and confirmed against
 * the running app, not guessed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { specificity } from '../src/cascade'
import { isColourProperty, toHex } from '../src/color'
import { distanceBetween, formatDistance } from '../src/measure'
import { matchRole, nearestRole, type Role } from '../src/roles'
import { VERSION } from '../src/version'

describe('specificity', () => {
  it('packs a-b-c into one comparable number', () => {
    expect(specificity('#id')).toBe(10000)
    expect(specificity('.a')).toBe(100)
    expect(specificity('div')).toBe(1)
    expect(specificity('.a.b')).toBe(200)
    expect(specificity('div.a')).toBe(101)
  })

  it('counts attribute and pseudo-class selectors as classes', () => {
    expect(specificity('[data-x]')).toBe(100)
    expect(specificity('a:hover')).toBe(101)
  })

  it('ignores :where(), which the spec gives zero specificity', () => {
    expect(specificity(':where(.a)')).toBe(100)   // the .a inside still counts
    expect(specificity('div:where(.a)')).toBe(101)
  })

  it('takes the highest compound of a comma list', () => {
    /* The browser has already told us the element matches; the safe read of
       "which of these won" is the strongest one. */
    expect(specificity('div, #id')).toBe(10000)
  })

  it('ranks a class above any number of elements, as the cascade does', () => {
    expect(specificity('.one')).toBeGreaterThan(specificity('div span a b i'))
  })
})

describe('toHex', () => {
  it('writes rgb as hex, because that is what a designer reads', () => {
    expect(toHex('rgb(16, 24, 40)')).toBe('#101828')
    expect(toHex('rgb(255, 255, 255)')).toBe('#FFFFFF')
    expect(toHex('rgb(0, 0, 0)')).toBe('#000000')
  })

  it('keeps alpha as a percentage rather than an eight-digit hex', () => {
    expect(toHex('rgba(16, 24, 40, 0.5)')).toBe('#101828 50%')
  })

  it('leaves anything it does not understand alone', () => {
    expect(toHex('currentColor')).toBe('currentColor')
    expect(toHex('var(--x)')).toBe('var(--x)')
    expect(toHex('rgb(a, b, c)')).toBe('rgb(a, b, c)')
  })
})

describe('isColourProperty', () => {
  it('knows which properties to compare as colours', () => {
    expect(isColourProperty('color')).toBe(true)
    expect(isColourProperty('background-color')).toBe(true)
    expect(isColourProperty('border-color')).toBe(true)
    expect(isColourProperty('fill')).toBe(true)
    expect(isColourProperty('stroke')).toBe(true)
    expect(isColourProperty('padding-left')).toBe(false)
    expect(isColourProperty('font-size')).toBe(false)
  })
})

const rect = (x: number, y: number, w: number, h: number): DOMRect => ({
  x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h,
  toJSON: () => ({}),
}) as DOMRect

describe('distanceBetween', () => {
  it('measures a horizontal gap across the band the two share', () => {
    const d = distanceBetween(rect(0, 0, 100, 20), rect(124, 0, 100, 20))
    expect(d.gaps).toHaveLength(1)
    expect(d.gaps[0]).toMatchObject({ axis: 'x', distance: 24 })
    expect(d.overlapping).toBe(false)
  })

  it('measures the same gap whichever box is passed first', () => {
    const a = rect(0, 0, 100, 20), b = rect(124, 0, 100, 20)
    expect(formatDistance(distanceBetween(a, b))).toBe(formatDistance(distanceBetween(b, a)))
  })

  it('reports both axes when the boxes are diagonal to each other', () => {
    const d = distanceBetween(rect(0, 0, 50, 20), rect(80, 40, 50, 20))
    expect(d.gaps.map(g => g.axis).sort()).toEqual(['x', 'y'])
    expect(formatDistance(d)).toBe('30px × 20px')
  })

  it('calls touching boxes overlapping — there is no gap to draw', () => {
    const d = distanceBetween(rect(0, 0, 100, 20), rect(100, 0, 100, 20))
    expect(d.overlapping).toBe(true)
    expect(formatDistance(d)).toBe('overlapping')
  })

  it('names the edges that line up', () => {
    const d = distanceBetween(rect(0, 0, 100, 20), rect(0, 40, 100, 20))
    expect(d.aligned).toContain('left')
    expect(d.aligned).toContain('right')
    expect(d.aligned).toContain('centre-x')
    expect(d.aligned).not.toContain('top')
  })
})

/* Shaped exactly as discoverRoles() builds them: a slot the role does not
   declare is `undefined`, never an empty string. That distinction is the whole
   of near() — undefined means "this role does not constrain it", while '' is a
   value that matches nothing. A fixture using '' would have tested a Role that
   cannot occur. */
const ROLES: Role[] = [
  { name: 'text-paragraph-sm', fontSize: '12px', fontWeight: undefined, lineHeight: '16px' },
  { name: 'text-label-sm', fontSize: '12px', fontWeight: '500', lineHeight: '16px' },
  { name: 'text-paragraph-md', fontSize: '14px', fontWeight: undefined, lineHeight: '20px' },
  { name: 'text-label-md', fontSize: '14px', fontWeight: '500', lineHeight: '20px' },
  { name: 'text-heading-sm', fontSize: '16px', fontWeight: '600', lineHeight: '24px' },
]

describe('matchRole', () => {
  it('matches on all three slots', () => {
    const r = matchRole(ROLES, { fontSize: '14px', fontWeight: '500', lineHeight: '20px' })
    expect(r?.name).toBe('text-label-md')
  })

  it('prefers the role that constrains MORE slots', () => {
    /* Both paragraph-md and label-md are 14/20. The one that also pins the
       weight is the more specific claim, and the true one here. */
    const r = matchRole(ROLES, { fontSize: '14px', fontWeight: '500', lineHeight: '20px' })
    expect(r?.name).toBe('text-label-md')
  })

  it('falls to the looser role when the weight does not match it', () => {
    const r = matchRole(ROLES, { fontSize: '14px', fontWeight: '400', lineHeight: '20px' })
    expect(r?.name).toBe('text-paragraph-md')
  })

  it('returns null when nothing matches', () => {
    expect(matchRole(ROLES, { fontSize: '13px', fontWeight: '400', lineHeight: '18px' })).toBeNull()
  })
})

describe('nearestRole', () => {
  it('ranks by size first — a 2px gap outranks any weight difference', () => {
    const r = nearestRole(ROLES, { fontSize: '13px', fontWeight: '900', lineHeight: 'normal' })
    expect(r?.fontSize).toBe('12px')       // 1px away, not the 14px with a closer weight
  })

  it('is at the size it should be when the size ties', () => {
    /* Which of the two 14px roles comes back is decided by array order, not by
       weight: an unconstrained role adopts whatever weight you have, so it
       always ties with an exact match. Worth knowing before trusting the name
       of a suggestion over its numbers. */
    const r = nearestRole(ROLES, { fontSize: '14px', fontWeight: '500', lineHeight: 'normal' })
    expect(r?.fontSize).toBe('14px')
  })

  it('gives up on a size it cannot parse', () => {
    expect(nearestRole(ROLES, { fontSize: 'inherit', fontWeight: '400', lineHeight: 'normal' })).toBeNull()
  })
})

describe('VERSION', () => {
  it('matches package.json — it has been wrong before', () => {
    /* It was written in three places and one of them sat at 0.1.0 through
       four releases, because the only thing that reads it is a person
       squinting at a console. */
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(VERSION).toBe(pkg.version)
  })
})
