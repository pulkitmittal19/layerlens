# Changelog

Notable changes, newest first. Dates are the day the version was tagged.

## 0.3.0 — 2026-09-21

### Renamed

- **The package is `layerlens`.** It was `stylelens` right up to the first
  publish, and npm refused it: one character from `stylelint`, close enough that
  the registry's typosquatting filter reads it as an attempt at that package.
  Scoping it would have kept the word, but a name you have to say as
  "at-my-username-slash" is not a name. Nothing had been published under the old
  one, so nobody has an install to migrate — this is release one.

  ```diff
  - import { StyleLens } from 'stylelens/react'
  + import { LayerLens } from 'layerlens/react'
  ```

  Everything the old name touched moved with it: `window.__styleLens` is
  `window.__layerLens`, `StyleLensConfig` is `LayerLensConfig`, the field
  `enrich()` adds to an annotation is `layerLens`, and the ignore attribute is
  `data-layerlens-ignore`. Entries below this one are written in the new names —
  the old ones never reached npm, so there is nothing to be faithful to.

## 0.2.0 — 2026-09-20

### Breaking

- **`LayerLens` moved to `layerlens/react`.** The package now has two entries: the
  engine at `layerlens`, which imports no React at all, and the overlay at
  `layerlens/react`, which re-exports the engine so a React app still writes one
  import.

  ```diff
  - import { LayerLens } from 'layerlens'
  + import { LayerLens } from 'layerlens/react'
  ```

  `package.json` had called React an optional peer dependency since the first
  commit and it was never true — the single entry re-exported the overlay, so
  `import { Lens } from 'layerlens'` pulled in `react`, `react-dom` and
  `react/jsx-runtime`, and threw `ERR_MODULE_NOT_FOUND` in a project without
  them. The CI surface the README documents could not run at all. It can now.

### Fixed

- **Hovering no longer costs a frame.** A single mouse move was a median of
  20.4ms and a worst case of 130.8ms, because `winningRule` walked every rule
  in every stylesheet on every call — once per property, then again per
  ancestor for the inherited ones. The rules are indexed once by property and
  kept, so a read is a match against the few rules that set what it asks about:
  40ms to 9.3ms. On top of that, reads are coalesced to one animation frame and
  skipped entirely while the cursor stays inside the same element.
- **The panel no longer covers what it describes.** It is anchored to the
  element's box, above it where there is room, and never follows the cursor.
- **The panel's appearance is animated; its movement is not.** A readout that
  follows a pointer must never be in transit — a new hover retargets it
  mid-flight, and what you see is a box drifting toward a position it has
  already stopped caring about.
- Labels no longer wrap. "Border colour" did not fit a 46px column and took the
  whole row out of alignment.
- The header shows the selector, not the element's text. `textContent` runs
  every descendant together, so a table footer read as
  `Show10 entries1-12 of 248 contacts12345…`.
- Elements inside an icon read as `svg.[object SVGAnimatedString]`. `className`
  is a string on HTML and an `SVGAnimatedString` on SVG; the class *attribute*
  is a string on both.
- `new Lens()` outside a browser now says what to do instead of throwing
  `ReferenceError: getComputedStyle is not defined` from inside the token table.
- `window.__layerLens.version` reported `0.1.0`. The version was written in three
  places; it is one module now, with a test.

### Added

- A test suite over the parts that need no browser — specificity, role
  matching, distance, colour formatting — and a CI workflow running typecheck,
  tests and build on every push.

## 0.1.7 — 2026-09-20

Installing this version does not work: `dist/` is gitignored and there was no
`prepare` script, so a git install produced a package with no build output and
`main` pointing at a file that did not exist. Fixed in 0.2.0. Never published
to npm.

- Rulers are quieter: no alignment label, and nothing touching the frames.
- Measuring no longer freezes after the first use. The ruler line sat in the
  cursor's path and hit-tested; it is `pointer-events: none` now.
- Hold <kbd>Shift</kbd> to measure the gap between two elements, instead of
  pressing a key to enter a mode.
- The CSS panel gets out of the way while measuring.
- Copying an element copies a reading a person can read, not 50 lines of JSON.
  <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> still gets the JSON, for when something is
  going to parse it.
- Annotations join to measurements, for use alongside an annotation tool.
