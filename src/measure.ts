/* Distance between two elements.
 *
 * The question a designer asks after "what is this" is "how far is it from
 * that". Figma answers it by holding a modifier over a second element; this is
 * the same gesture, and the same answer, in the running page.
 *
 * Gaps are edge to edge, per axis, which is what spacing actually means. Two
 * elements can be 40px apart horizontally and overlap vertically, and reporting
 * one number for that would be a guess about which one was meant.
 */

export interface Gap {
  axis: 'x' | 'y'
  /** Edge-to-edge distance in CSS pixels. */
  distance: number
  /** The line to draw, in viewport coordinates. */
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export interface Distance {
  gaps: Gap[]
  /** True when the boxes intersect, so neither axis has a gap. */
  overlapping: boolean
  /** Edges that line up exactly — the other half of "is this aligned". */
  aligned: string[]
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5

/**
 * Gaps and shared edges between two rectangles.
 *
 * `a` is the pinned element, `b` the one under the cursor. Order only affects
 * which way the labels read; the numbers are symmetric.
 */
export function distanceBetween(a: DOMRect, b: DOMRect): Distance {
  const gaps: Gap[] = []

  /* Horizontal gap, measured across whatever vertical band the two share so
     the line is drawn where a person would hold a ruler. Falling back to the
     midpoint between centres when they share no band. */
  const bandTop = Math.max(a.top, b.top)
  const bandBottom = Math.min(a.bottom, b.bottom)
  const y = bandBottom > bandTop
    ? (bandTop + bandBottom) / 2
    : (a.top + a.height / 2 + b.top + b.height / 2) / 2

  if (b.left > a.right) gaps.push({ axis: 'x', distance: b.left - a.right, from: { x: a.right, y }, to: { x: b.left, y } })
  else if (a.left > b.right) gaps.push({ axis: 'x', distance: a.left - b.right, from: { x: b.right, y }, to: { x: a.left, y } })

  const bandLeft = Math.max(a.left, b.left)
  const bandRight = Math.min(a.right, b.right)
  const x = bandRight > bandLeft
    ? (bandLeft + bandRight) / 2
    : (a.left + a.width / 2 + b.left + b.width / 2) / 2

  if (b.top > a.bottom) gaps.push({ axis: 'y', distance: b.top - a.bottom, from: { x, y: a.bottom }, to: { x, y: b.top } })
  else if (a.top > b.bottom) gaps.push({ axis: 'y', distance: a.top - b.bottom, from: { x, y: b.bottom }, to: { x, y: a.top } })

  const aligned: string[] = []
  if (near(a.left, b.left)) aligned.push('left')
  if (near(a.right, b.right)) aligned.push('right')
  if (near(a.top, b.top)) aligned.push('top')
  if (near(a.bottom, b.bottom)) aligned.push('bottom')
  if (near(a.left + a.width / 2, b.left + b.width / 2)) aligned.push('centre-x')
  if (near(a.top + a.height / 2, b.top + b.height / 2)) aligned.push('centre-y')

  return {
    gaps,
    overlapping: gaps.length === 0,
    aligned,
  }
}

/** `24px` — or `24 × 16px` when both axes have a gap. */
export function formatDistance(d: Distance): string {
  if (d.overlapping) return 'overlapping'
  const x = d.gaps.find(g => g.axis === 'x')
  const y = d.gaps.find(g => g.axis === 'y')
  const px = (n: number) => `${Math.round(n * 10) / 10}px`
  if (x && y) return `${px(x.distance)} × ${px(y.distance)}`
  return px((x ?? y)!.distance)
}
