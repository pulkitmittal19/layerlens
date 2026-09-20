/* The version, in one place.
 *
 * It was in three: package.json, the VERSION export, and the string handed to
 * createGlobal for `window.__styleLens.version`. The third had been left at
 * '0.1.0' through four releases and nobody noticed, because nothing reads it
 * except a human squinting at a console. One module, imported by both, and a
 * test that asserts it matches package.json.
 */
export const VERSION = '0.2.0'
