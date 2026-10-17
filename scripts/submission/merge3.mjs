// A three way merge of JSON documents, for a change drafted on one commit of
// main and committed onto a newer one. Objects merge key by key, so a names
// change and a description change that landed meanwhile both stay; anything
// else changed on both sides to different values is a conflict.

export class MergeConflict extends Error {}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** base: the document the change was drafted on, theirs: main now, mine: the
 * change. undefined stands for a missing key or file. */
export function merge3(base, theirs, mine, path = '') {
  if (same(mine, base))
    return theirs
  if (same(theirs, base) || same(theirs, mine))
    return mine
  if (isObject(base) && isObject(theirs) && isObject(mine)) {
    const out = {}
    for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const value = merge3(base[key], theirs[key], mine[key], `${path}.${key}`)
      if (value !== undefined)
        out[key] = value
    }
    // Keys in the order main has them, new ones after.
    return out
  }
  throw new MergeConflict(`${path.slice(1) || 'the document'} changed on main meanwhile`)
}

/** Merges the text of a JSON file; null is a missing file. Returns the text to
 * write, or null to delete the file. */
export function mergeFile(base, theirs, mine) {
  const parse = text => (text === null ? undefined : JSON.parse(text))
  const merged = merge3(parse(base), parse(theirs), parse(mine))
  return merged === undefined ? null : `${JSON.stringify(merged, null, 2)}\n`
}
