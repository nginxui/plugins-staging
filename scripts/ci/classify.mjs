// Decides how a change to a catalog entry reaches main, from the entry before
// and after it alone, so a compromised portal cannot pass a change off as a
// lesser one:
//
// - self_service: yanking or unyanking versions, revoking signers and
//   changing categories, committed directly once the checks pass. They only
//   reduce trust or file the plugin elsewhere.
// - reviewed: a new listing, delisting and every field that can impersonate
//   or redirect (names, keys, URLs), opened as a pull request a maintainer
//   merges.
// - maintainer: trust and the fields only maintainers set.
//
// A field not named here counts as reviewed, so a new schema field never
// slips through as self service.

const RANK = { self_service: 1, reviewed: 2, maintainer: 3 }

const SELF_SERVICE = new Set(['yanked', 'categories'])
const MAINTAINER = new Set(['trust', 'description', 'readme_url', 'screenshots', 'capabilities'])

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function fieldClass(field, before, after) {
  if (MAINTAINER.has(field))
    return 'maintainer'
  if (SELF_SERVICE.has(field))
    return 'self_service'
  // Revoking a signer reduces trust, taking a revocation back restores it.
  if (field === 'revoked_signers') {
    const kept = new Set(after ?? [])
    return (before ?? []).every(id => kept.has(id)) ? 'self_service' : 'reviewed'
  }
  return 'reviewed'
}

/**
 * Classifies the change from `before` to `after`, either of which is null for
 * a new listing or a delisting. Returns { class, fields }, fields being the
 * changed fields with the class of each; class is null when nothing changed.
 */
export function classify(before, after) {
  if (!before && !after)
    return { class: null, fields: [] }
  if (!before)
    return { class: 'reviewed', fields: [{ field: 'listing', change: 'added', class: 'reviewed' }] }
  if (!after)
    return { class: 'reviewed', fields: [{ field: 'listing', change: 'removed', class: 'reviewed' }] }
  if (before.id !== after.id)
    return { class: 'maintainer', fields: [{ field: 'id', change: 'changed', class: 'maintainer' }] }

  const fields = []
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (same(before[field], after[field]))
      continue
    const change = !(field in before) ? 'added' : !(field in after) ? 'removed' : 'changed'
    fields.push({ field, change, class: fieldClass(field, before[field], after[field]) })
  }
  const highest = fields.reduce((top, item) => (!top || RANK[item.class] > RANK[top] ? item.class : top), null)
  return { class: highest, fields }
}
