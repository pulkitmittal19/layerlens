/* The overlay.
 *
 * Every style here is inline and every colour is fixed. That is not laziness —
 * this component is injected into other people's applications, so a class name
 * could collide with theirs and a CSS variable could be redefined underneath
 * it. Inline styles cannot be reached by the host page at all, which is the
 * only way an inspector can be trusted to report the page rather than itself.
 *
 * One dark panel in both themes, for the same reason DevTools uses one: it has
 * to stay legible above whatever it is floating over.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Lens } from './inspect'
import { toHex } from './color'
import { format } from './annotate'
import { distanceBetween, formatDistance, type Distance } from './measure'
import { createGlobal } from './agent'
import { VERSION } from './version'
import type { StyleLensConfig, Inspection, Reading } from './types'

/* Agentation's palette, measured from its own toolbar rather than guessed:
   surface #1A1A1A, raised #252525, dividers #484848, white text, and two
   accents it ships — a blue and a red. stylelens sits beside that toolbar, so
   matching it is the difference between one tool and two.

   The accent is read from agentation at runtime when it is on the page, so
   changing the accent there changes it here. */
const INK = {
  panel: '#1A1A1A',
  raised: '#252525',
  line: 'rgba(255,255,255,.10)',
  text: '#FFFFFF',
  dim: 'rgba(255,255,255,.55)',
  faint: 'rgba(255,255,255,.34)',
  ok: 'color(display-p3 0 .53 1)',
  okFallback: '#0087FF',
  bad: '#FF383C',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  shadow: '0 2px 8px rgba(0,0,0,.30), 0 8px 28px rgba(0,0,0,.24)',
}

/** Agentation's accent if it is mounted, else stylelens's own blue. */
function readAccent(): string {
  const host = document.querySelector('[data-agentation-root]')
  const v = host && getComputedStyle(host).getPropertyValue('--agentation-color-accent').trim()
  return v || INK.okFallback
}

/* A colour is recognised far faster than it is read. The inset ring keeps a
   white or near-transparent swatch visible against the dark panel. */
function Swatch({ value }: { value: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: value,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.28)', marginRight: 7, verticalAlign: 'baseline',
    }} />
  )
}

/* Lucide `crosshair`, copied exactly rather than redrawn — an approximated
   icon is the kind of thing nobody notices and everybody feels. Inlined rather
   than imported so stylelens keeps zero runtime dependencies.
   lucide-react v0.562.0, ISC. */
function Crosshair({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="22" x2="18" y1="12" y2="12" />
      <line x1="6" x2="2" y1="12" y2="12" />
      <line x1="12" x2="12" y1="6" y2="2" />
      <line x1="12" x2="12" y1="22" y2="18" />
    </svg>
  )
}

const POS_KEY = 'stylelens:pos'
const CHIP = 44

/* Bottom-left by default, because agentation and most other floating toolbars
   live bottom-right. Dragging overrides it and the choice is remembered. */
function defaultPos() {
  return { x: 16, y: Math.max(16, window.innerHeight - CHIP - 16) }
}

function clamp(p: { x: number; y: number }) {
  return {
    x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - CHIP - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - CHIP - 8)),
  }
}

function Chip({ locked, peeking, copied, accent, onToggle }: {
  locked: boolean; peeking: boolean; copied: boolean; accent: string; onToggle: () => void
}) {
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem(POS_KEY)
      if (saved) return clamp(JSON.parse(saved))
    } catch { /* private mode, or a value from an older version */ }
    return defaultPos()
  })
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const from = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)

  /* A window that shrank can strand the chip off-screen with no way to reach
     it, so the saved position is re-clamped rather than trusted. */
  useEffect(() => {
    const onResize = () => setPos(p => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const down = (e: ReactPointerEvent) => {
    from.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false }
    /* Capture keeps the drag alive when the cursor outruns a 44px target.
       It throws if the pointer is no longer active — a released button, a
       synthetic event — and that must not take the drag down with it. */
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    setDragging(true)
  }
  const move = (e: ReactPointerEvent) => {
    const f = from.current
    if (!f) return
    const next = clamp({ x: e.clientX - f.dx, y: e.clientY - f.dy })
    /* Four pixels of slop. Without it a click with any tremor in it is read as
       a drag and the button never fires. */
    if (Math.abs(next.x - pos.x) > 4 || Math.abs(next.y - pos.y) > 4) f.moved = true
    setPos(next)
  }
  const up = () => {
    const f = from.current
    setDragging(false)
    from.current = null
    if (!f) return
    if (f.moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ } }
    else onToggle()
  }

  return (
    <div
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      role="button" tabIndex={0} aria-pressed={locked} aria-label="stylelens inspector"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: CHIP, height: CHIP,
        zIndex: 2147483647, borderRadius: CHIP / 2,
        display: 'grid', placeItems: 'center',
        background: locked ? accent : INK.panel,
        color: locked ? '#FFFFFF' : peeking ? accent : 'rgba(255,255,255,.72)',
        boxShadow: INK.shadow,
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none', userSelect: 'none',
        transition: dragging ? 'none' : 'background 120ms ease, color 120ms ease',
        outline: peeking && !locked ? `1.5px solid ${accent}` : 'none', outlineOffset: -1.5,
      }}
    >
      <Crosshair />
      {(copied || (hover && !dragging)) && (
        <span style={{
          position: 'absolute', bottom: CHIP + 8, left: '50%', transform: 'translateX(-50%)',
          background: INK.panel, color: 'rgba(255,255,255,.9)', borderRadius: 8,
          padding: '4px 8px', fontSize: 12, fontWeight: 500, fontFamily: INK.sans,
          whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,.3)', pointerEvents: 'none',
        }}>
          {copied ? 'Copied' : locked ? 'Inspecting · esc' : 'Inspect · hold ⌥'}
        </span>
      )}
    </div>
  )
}

/* Every part of this is pointer-events:none, and that is not tidiness. A ruler
   is drawn across the gap between two elements — exactly the path the cursor
   travels to reach the second one. A line that can be hit-tested catches the
   cursor there, elementFromPoint returns the ruler, tracking freezes, and the
   whole gesture reads as broken.

   Gap lines, drawn as positioned divs rather than an SVG overlay: a 1px div
   is exactly 1px, and an SVG stroke straddles the coordinate and renders soft
   on a fractional boundary. For a ruler that is the wrong trade. */
function Rulers({ a, b, accent }: { a: DOMRect; b: DOMRect; accent: string }) {
  const d: Distance = distanceBetween(a, b)
  /* One pixel off each end. A ruler that lands exactly on an element's edge
     sits on top of its border and reads as the line running into the frame
     rather than stopping at it. End ticks did the same, worse — they extend
     across the border — so there are none. */
  const INSET = 1
  return (
    <>
      <div style={{
        position: 'fixed', left: a.x, top: a.y, width: a.width, height: a.height,
        outline: `1px dashed ${accent}`, outlineOffset: 1, pointerEvents: 'none', zIndex: 2147483645,
      }} />
      {d.gaps.map(g => {
        const horizontal = g.axis === 'x'
        const length = Math.max(0, g.distance - INSET * 2)
        return (
          <div key={g.axis}>
            <div style={{
              position: 'fixed', zIndex: 2147483645, background: accent, pointerEvents: 'none',
              left: horizontal ? g.from.x + INSET : g.from.x - 0.5,
              top: horizontal ? g.from.y - 0.5 : g.from.y + INSET,
              width: horizontal ? length : 1,
              height: horizontal ? 1 : length,
            }} />
            <span style={{
              position: 'fixed', zIndex: 2147483646,
              left: horizontal ? (g.from.x + g.to.x) / 2 : g.from.x + 8,
              top: horizontal ? g.from.y - 22 : (g.from.y + g.to.y) / 2 - 8,
              transform: horizontal ? 'translateX(-50%)' : 'none',
              background: accent, color: '#FFFFFF', borderRadius: 5,
              padding: '2px 6px', font: `500 11px/1.2 ${INK.sans}`, whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}>{Math.round(g.distance * 10) / 10}</span>
          </div>
        )
      })}
    </>
  )
}

/* While measuring, the CSS panel is the thing in the way — it covers the very
   gap being looked at, and none of its rows are the question being asked. It
   collapses to this: the distance, and whether the edges line up. Everything
   else comes back the moment Shift is released. */
function Readout({ d, at, accent }: { d: Distance; at: { x: number; y: number }; accent: string }) {
  /* Each gap carries its own label on the ruler, so this only appears when it
     can say something the rulers cannot: a two-axis summary, or an overlap,
     which has no ruler at all. One distance is never printed twice. */
  const summary = d.overlapping ? 'overlapping' : d.gaps.length > 1 ? formatDistance(d) : ''
  if (!summary) return null
  return (
    <div style={{
      position: 'fixed', zIndex: 2147483647,
      left: Math.min(at.x + 18, window.innerWidth - 160),
      top: Math.min(at.y + 18, window.innerHeight - 40),
      background: INK.panel, borderRadius: 8, padding: '5px 9px',
      font: `500 12px/1.3 ${INK.sans}`, color: accent,
      fontFamily: INK.mono, fontSize: 11.5,
      boxShadow: INK.shadow, pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      {summary}
    </div>
  )
}

function Pill({ children, tone }: { children: ReactNode; tone?: 'bad' }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 5, fontSize: 10.5,
      background: tone === 'bad' ? 'rgba(255,56,60,.16)' : 'rgba(255,255,255,.08)',
      color: tone === 'bad' ? INK.bad : INK.dim,
      fontFamily: INK.sans, letterSpacing: .1,
    }}>{children}</span>
  )
}

/* Other tools' floating UI.
 *
 * stylelens swallows clicks while it is active, so anything it does not skip
 * becomes unclickable. Measured against agentation: with the inspector on, a
 * click on its toolbar was preventDefault'd and never arrived. An inspector
 * that quietly disables the annotation tool beside it is worse than no
 * inspector, so known overlay roots are skipped by default and a host can add
 * its own with `overlaySelectors` or by marking an element
 * `data-stylelens-ignore`. */
const OVERLAY_ROOTS = [
  '[data-stylelens]',
  '[data-stylelens-ignore]',
  '[data-agentation-root]',
  '[data-stagewise-companion-anchor]',
  '#vercel-live-feedback',
  'vercel-live-feedback',
]

const LABEL: Record<string, string> = {
  'background-color': 'Background', 'border-color': 'Border colour',
  'border-radius': 'Radius', 'border-width': 'Border', 'box-shadow': 'Shadow',
  color: 'Colour', gap: 'Gap',
}
const label = (p: string) => LABEL[p] ?? (p.startsWith('padding') ? 'Padding' : p)

/**
 * Padding collapses to one row, written as CSS shorthand.
 *
 * Four separate rows is three too many, and the half-collapsed version was
 * worse: two rows both reading `Padding  8px` with nothing to say which sides
 * they were. Shorthand is the notation the value would be written in anyway —
 * `8px`, `8px 12px`, or all four when they genuinely differ.
 */
function foldPadding(readings: Reading[]): Reading[] {
  const sides = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']
  const found = sides.map(side => readings.find(r => r.property === side))
  if (!found.some(Boolean)) return readings

  const value = (r?: Reading) => r?.value ?? '0px'
  const [top, right, bottom, left] = found.map(value)
  const shorthand =
    top === right && right === bottom && bottom === left ? top
    : top === bottom && left === right ? `${top} ${right}`
    : `${top} ${right} ${bottom} ${left}`

  /* One raw side makes the whole declaration raw — the row is reporting a
     single value now, and it cannot be half on the system. */
  const present = found.filter(Boolean) as Reading[]
  const verdict = present.every(r => r.verdict.status === 'token') ? present[0].verdict : { status: 'raw' as const }

  return [
    ...readings.filter(r => !r.property.startsWith('padding')),
    { property: 'padding', value: shorthand, verdict, origin: present[0].origin },
  ]
}

function Row({ name, value, verdict, ok, accent, swatch }: {
  name: string; value: string; verdict: string; ok: boolean; accent: string; swatch?: string
}) {
  return (
    /* 72px fits the longest label — "Border colour" — on one line. At 46 it
       wrapped onto two, which pushed the value and the verdict out of line
       with every other row and made the panel look broken. A label that still
       does not fit is clipped rather than reflowed: a row is one line. */
    <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr) auto', gap: 10, alignItems: 'baseline', padding: '4px 0' }}>
      <span style={{
        color: INK.faint, fontSize: 11, fontFamily: INK.sans,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{name}</span>
      <span style={{
        color: INK.text, fontFamily: INK.mono, fontSize: 11.5,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {swatch && <Swatch value={swatch} />}{value}
      </span>
      <span style={{ color: ok ? accent : INK.bad, fontFamily: INK.mono, fontSize: 11.5, whiteSpace: 'nowrap' }}>
        {verdict}
      </span>
    </div>
  )
}

/* The tail of a selector is the part that identifies the element; the head is
   page furniture. Ellipsising the front keeps the useful half. */
/* Appearance is animated; movement never is.
 *
 * Taken from agentation, whose hover interaction is the one to beat on this
 * page. Its highlight and tooltip both fade in over ~0.1s and then SNAP to
 * every new position — `transition-duration` on them computes to 0s. That is
 * the whole trick: a readout that follows a pointer must never be in transit,
 * because a new hover retargets it mid-flight and what you see is a box
 * drifting toward somewhere it has already stopped caring about. An eased
 * 130ms move, which is what this had, is exactly that.
 *
 * So: one enter animation on mount, and nothing after. The node persists
 * across element changes, so it plays once. */
const STYLE_ID = 'stylelens-keyframes'
const KEYFRAMES = `
@keyframes stylelens-panel-in { from { opacity: 0; transform: scale(.95) translateY(4px) } to { opacity: 1; transform: none } }
@keyframes stylelens-box-in { from { opacity: 0 } to { opacity: 1 } }
`
function useKeyframes(): void {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.textContent = KEYFRAMES
    document.head.append(tag)
  }, [])
}

const tail = (text: string, max = 46) =>
  text.length <= max ? text : '…' + text.slice(-(max - 1))

function Panel({ data, at, accent }: {
  data: Inspection; at: { x: number; y: number }; accent: string
}) {
  const W = 348
  /* Placement has one job beyond staying on screen: not sitting on top of the
     thing it is describing. Below-right of the cursor is the default, but on a
     table row that lands squarely over the row's own controls — you can see
     the reading and not the element, and the buttons you were about to click
     are behind a panel. So the panel is measured, then moved off the element's
     box: above it if there is room, otherwise below it, and only then clamped
     to the viewport. It is pointer-events:none throughout, so it never eats a
     click; this is about being able to SEE what you are pointing at. */
  const box = useRef<HTMLDivElement | null>(null)
  const [h, setH] = useState(190)
  /* LAYOUT effect, not a passive one. Measuring after paint meant every move to
     a new element drew the panel once at the previous element's height — in the
     old place, for one frame — and then moved it. That one-frame correction,
     sixty times a second, is what read as jitter. useLayoutEffect measures and
     repositions before the browser paints, so there is only ever one position
     per frame. */
  useLayoutEffect(() => {
    const node = box.current
    if (!node) return
    const measured = node.getBoundingClientRect().height
    if (Math.abs(measured - h) > 1) setH(measured)
  })

  /* ANCHORED TO THE ELEMENT, NOT THE CURSOR. Following the pointer meant the
     panel slid continuously the whole time you were reading it, and changed
     height mid-slide whenever you crossed a boundary — two motions at once,
     neither of them useful. Anchored, it is perfectly still while you are on
     one element and moves once when you move to the next, which is the only
     moment anything has actually changed. */
  const GAP = 12
  const vw = window.innerWidth
  const vh = window.innerHeight
  const el = data.box
  const roomBelow = vh - (el.y + el.height) - GAP - 12
  const roomAbove = el.y - GAP - 12
  const below = roomBelow >= h || roomBelow >= roomAbove
  const left = Math.max(12, Math.min(el.x, vw - W - 12))
  const top = Math.max(12, Math.min(
    below ? el.y + el.height + GAP : el.y - GAP - h,
    vh - h - 12,
  ))

  const origin = data.type.origin
  const off = data.offSystem.length
  const typeOk = data.type.verdict.status === 'role'

  /* One slot for the verdict, whether or not there is a role. A matched role
     names itself; an unmatched one points at the closest — `→ text-label-md`
     reads as "should be this" and costs no extra line. Spelling it out as
     "nearest is X — 14px / — / 20px" restated numbers already on the row and
     was read as part of the value. */
  const typeVerdict = typeOk
    ? (data.type.verdict as { name: string }).name
    : data.type.suggestion ? `\u2192 ${data.type.suggestion.name}` : 'no role'

  return (
    <div ref={box} style={{
      position: 'fixed', left, top, width: W, zIndex: 2147483647,
      /* No transition. See the note by KEYFRAMES: a readout that follows a
         pointer must never be in transit. It fades in once and snaps after. */
      animation: 'stylelens-panel-in .1s ease-out',
      willChange: 'opacity', contain: 'layout style',
      background: INK.panel, borderRadius: 12, boxShadow: INK.shadow,
      padding: '11px 13px 11px', pointerEvents: 'none',
      font: `400 12px/1.45 ${INK.sans}`, color: INK.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        {/* The selector, always. This used to prefer the element's text, which
            is fine for a leaf and useless for anything else: a table footer
            came out as "Show10 entries1-12 of 248 contacts12345…", because
            textContent runs every descendant together with no spaces. The
            text is on the screen already — what you cannot see is which
            element you are on. */}
        <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tail(data.selector, 34)}
        </span>
        {off > 0 && (
          <span style={{ color: INK.bad, fontSize: 11, whiteSpace: 'nowrap' }}>{off} off</span>
        )}
      </div>

      <div style={{ height: 1, background: INK.line, margin: '8px 0 4px' }} />

      <Row
        name="Type" accent={accent} ok={typeOk}
        value={data.type.value}
        verdict={typeVerdict}
      />
      {foldPadding(data.readings).map(r => {
        const ok = r.verdict.status === 'token'
        const colour = /color$/.test(r.property)
        return (
          <Row
            key={r.property} name={label(r.property)} accent={accent} ok={ok}
            value={colour ? toHex(r.value) : r.value}
            swatch={colour ? r.value : undefined}
            verdict={ok ? (r.verdict as { name: string }).name : 'raw'}
          />
        )
      })}

      {origin && !origin.layer && (
        <div style={{ marginTop: 7 }}>
          <Pill tone="bad">unlayered</Pill>
        </div>
      )}
    </div>
  )
}

export interface StyleLensProps extends StyleLensConfig {
  /** Start with the inspector already on. Default false. */
  defaultOn?: boolean
  /** Extra floating UI to leave alone, added to the built-in list. */
  overlaySelectors?: string[]
  /** Highlight and on-system colour. Defaults to agentation's accent if present. */
  accent?: string
}

export function StyleLens(props: StyleLensProps = {}) {
  const {
    defaultOn = false, exposeGlobal = true, globalName = '__styleLens',
    overlaySelectors = [], accent: _accent, ...config
  } = props
  /* Injected from the root, not from Panel: a keyframe that arrives with the
     element it animates is a keyframe that misses the first frame. */
  useKeyframes()
  const [locked, setLocked] = useState(defaultOn)
  /* Hold Alt to peek. Peeking reads but never intercepts a click, so an
     annotation tool underneath stays usable — look at an element, let go, click
     it. Locking on is for hands-free sweeps, and that mode does take the click
     (to copy the reading), which is why it is not the default. */
  const [peek, setPeek] = useState(false)
  const on = locked || peek
  const [found, setFound] = useState<Inspection | null>(null)
  /* The pinned element, not its rectangle. A rect goes stale the moment the
     page scrolls or reflows; the element does not, so the ruler is measured
     fresh on every render. */
  const [pinned, setPinned] = useState<Element | null>(null)
  const hovered = useRef<Element | null>(null)
  /* The browser's native tooltip fires on any element with a `title` and
     renders above everything, including a gap label. One element's title is
     held aside while the cursor is on it, and given straight back. */
  const muted = useRef<{ el: Element; title: string } | null>(null)
  const [at, setAt] = useState({ x: 0, y: 0 })
  const [copied, setCopied] = useState(false)
  /* Read once at mount: agentation's accent if it is on the page, else ours.
     A prop wins over both, for a host that wants neither. */
  const accent = useMemo(() => props.accent ?? readAccent(), [props.accent])
  const lens = useRef<Lens | null>(null)
  const mounted = useRef(false)

  if (!lens.current) lens.current = new Lens(config)

  useEffect(() => {
    mounted.current = true
    if (!exposeGlobal) return
    window[globalName] = createGlobal(lens.current!, VERSION)
    return () => { delete window[globalName] }
  }, [exposeGlobal, globalName])

  /* Keyed on the contents, not the array.
     `overlaySelectors = []` in the destructure is a fresh array on every
     render, so depending on it made `skip` a new function every render, which
     made the inspect effect tear down and re-attach three document listeners
     on every mouse move. Worse, its cleanup restored the tooltip it had just
     suppressed, so muting never survived a single frame. */
  const overlayRoots = useMemo(
    () => [...OVERLAY_ROOTS, ...overlaySelectors],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overlaySelectors.join('|')],
  )

  /* True for stylelens's own UI and for any other tool's floating UI. Those
     elements are never inspected and never have their clicks intercepted. */
  const skip = useCallback((el: Element | null) => {
    if (!el) return true
    return overlayRoots.some(sel => {
      try { return !!el.closest(sel) } catch { return false }
    })
  }, [overlayRoots])

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setPeek(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setPeek(false) }
    /* A held key is lost when the window loses focus, which leaves peek stuck
       on and every click swallowed until the page is reloaded. */
    const blur = () => { setPeek(false); setPinned(null) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    if (!on) { setFound(null); setPinned(null); hovered.current = null; return }
    /* Cleared on every (re)attach as well: the skip above is keyed on the last
       element read, so a stale ref would keep the panel empty until the cursor
       crossed into something new. */
    hovered.current = null

    /* Mouse moves arrive faster than a frame — well over a hundred a second on
       a trackpad — and a read is the expensive thing here: a computed style, a
       box, and the winning rule for every property, which costs about 9ms on a
       page this size. Doing that per event is three or four reads inside one
       frame, all but the last of them thrown away. That was the jitter.

       So: remember the last event, do the work once per frame, and skip the
       read entirely while the cursor is still inside the same element — which
       is most of the time, because elements are bigger than pixels. Only the
       panel's position follows every frame, and that is a number. */
    let latest: MouseEvent | null = null
    let frame = 0

    const read = () => {
      frame = 0
      const e = latest
      if (!e) return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (skip(el)) return
      setAt({ x: e.clientX, y: e.clientY })
      if (el === hovered.current) return          // same element: nothing to re-read
      /* The tooltip belongs to the nearest ANCESTOR carrying a title, not to
         whatever leaf the cursor happens to land on — a button's title fires
         while the cursor is over the icon inside it. */
      const titled = el?.closest('[title]') ?? null
      const previous = muted.current
      if (previous && previous.el !== titled) {
        previous.el.setAttribute('title', previous.title)
        muted.current = null
      }
      if (titled && titled !== previous?.el) {
        const title = titled.getAttribute('title')!
        muted.current = { el: titled, title }
        titled.removeAttribute('title')
      }
      hovered.current = el!
      setFound(lens.current!.read(el!))
    }

    const move = (e: MouseEvent) => {
      latest = e
      if (!frame) frame = requestAnimationFrame(read)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPinned(null); setLocked(false); return }
      /* Hold Shift to measure. Whatever was under the cursor when Shift went
         down becomes the thing to measure from, and moving to anything else
         shows the gap — the gesture a design tool uses, with nothing to
         remember and nothing to let go of afterwards.
         keydown repeats while a key is held, so only the first one pins. */
      if (e.key === 'Shift') setPinned(current => current ?? hovered.current)
    }
    const keyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setPinned(null) }
    const click = (e: MouseEvent) => {
      if (!locked) return                       // peeking never steals a click
      if (skip(e.target as Element)) return
      e.preventDefault(); e.stopPropagation()
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el) return
      /* The short block by default: the full Inspection is ~50 lines of JSON
         for one element, which is the wrong thing to drop into a chat or a
         comment. Cmd or Ctrl gets the JSON, for when something is going to
         parse it rather than read it — not Shift, which now means measure. */
      const found = lens.current!.read(el)
      const text = e.metaKey || e.ctrlKey ? JSON.stringify(found, null, 2) : format(found)
      navigator.clipboard?.writeText(text).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 1200) },
        () => {/* clipboard blocked — the panel still shows the values */},
      )
    }

    document.addEventListener('mousemove', move, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('keyup', keyUp, true)
    document.addEventListener('click', click, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      /* Whatever was held aside goes back, even if the inspector is torn down
         mid-hover — a page must not be left missing a tooltip. */
      if (muted.current) {
        muted.current.el.setAttribute('title', muted.current.title)
        muted.current = null
      }
      document.removeEventListener('mousemove', move, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('keyup', keyUp, true)
      document.removeEventListener('click', click, true)
    }
  }, [on, locked, skip])

  if (typeof document === 'undefined') return null

  /* Both rectangles read fresh, from the elements rather than from the stored
     Inspection: Inspection.box is a plain object with no top/right/bottom/left,
     and it is a snapshot besides. */
  const measuring = pinned && hovered.current && pinned !== hovered.current
    ? { a: pinned.getBoundingClientRect(), b: hovered.current.getBoundingClientRect() }
    : null

  return createPortal(
    <div data-stylelens="">
      <Chip
        locked={locked}
        peeking={peek}
        copied={copied}
        accent={accent}
        onToggle={() => setLocked((v: boolean) => !v)}
      />

      {on && found && (
        <>
          <div style={{
            position: 'fixed', pointerEvents: 'none', zIndex: 2147483646,
            left: found.box.x, top: found.box.y, width: found.box.width, height: found.box.height,
            outline: `1px solid ${accent}`, background: 'rgba(0,135,255,.12)',
            animation: 'stylelens-box-in .12s ease-out',
            willChange: 'opacity', contain: 'layout style',
          }} />
          {measuring ? (
            <>
              <Rulers a={measuring.a} b={measuring.b} accent={accent} />
              <Readout d={distanceBetween(measuring.a, measuring.b)} at={at} accent={accent} />
            </>
          ) : (
            <Panel data={found} at={at} accent={accent} />
          )}
        </>
      )}
    </div>,
    document.body,
  )
}
