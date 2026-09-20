/* layerlens — is what you are looking at actually on the design system?
 *
 * THE ENGINE. No React, no JSX, nothing imported from `react` anywhere in this
 * module's graph — so a Playwright script, a CI check or an SSR build can
 * import it without React installed. That was not true until now: this entry
 * re-exported the overlay, so `import 'layerlens'` needed React even to count
 * off-system values, while package.json called React optional.
 *
 *   window.__layerLens         a JSON API a coding agent calls
 *   new Lens().audit()      a whole-page count for CI
 *
 * The overlay a designer hovers is `layerlens/react`, which is the only entry
 * that imports React.
 *
 * `new Lens()` reads the document as it is constructed, so it needs a real
 * page — importing this module does not. See README.md. MIT.
 */
export { Lens, selectorFor } from './inspect'
export { createGlobal, type LayerLensGlobal } from './agent'
export { enrich, measure, describe, format, type AnnotationLike, type EnrichOptions } from './annotate'
export { buildTokenTable, tokenFor, type TokenTable } from './tokens'
export { winningRule, specificity, invalidateLayerOrder } from './cascade'
export { discoverRoles, matchRole, nearestRole, type Role } from './roles'
export { distanceBetween, formatDistance, type Distance, type Gap } from './measure'
export type { Audit, LayerLensConfig, Inspection, Origin, Reading, Verdict } from './types'
export { VERSION } from './version'
