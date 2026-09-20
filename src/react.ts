/* layerlens/react — the overlay, and the only entry that imports React.
 *
 * Split from the engine so that `import { Lens } from 'layerlens'` costs no
 * React: a CI script and an SSR build have no business pulling a UI library in
 * to count tokens. Everything the engine exports is re-exported here too, so a
 * React app still has one import to write.
 */
export { LayerLens } from './overlay'
export * from './index'
