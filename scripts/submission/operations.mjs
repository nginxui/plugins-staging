// The self service operations the developer portal sends for a listed plugin,
// applied to its entry on main. The portal names operations, never fields, so
// whatever it sends, only these fields can change; scripts/ci/classify.mjs
// still decides from the result whether it may be committed directly.

import { isSemver } from '../ci/semver.mjs'

const SIGNER = /^[0-9a-f]{16}$/i
const KINDS = ['yank', 'unyank', 'revoke_signers', 'categories', 'store', 'commercial']

/** A list of strings, or null when it is not one. */
function strings(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : null
}

/**
 * Applies operations to an entry. Returns { entry, summary } or { error }.
 * operations: { yank, unyank, revoke_signers, categories, store }, each
 * optional. store moves the store document and classifies as reviewed.
 */
export function applyOperations(before, operations, knownCategories) {
  if (!before)
    return { error: 'The plugin is not listed.' }
  if (!operations || typeof operations !== 'object' || Object.keys(operations).length === 0)
    return { error: 'No operation was given.' }
  const unknown = Object.keys(operations).filter(kind => !KINDS.includes(kind))
  if (unknown.length)
    return { error: `Unknown operations: ${unknown.join(', ')}.` }

  const both = (strings(operations.yank) ?? []).filter(version => (strings(operations.unyank) ?? []).includes(version))
  if (both.length)
    return { error: `Versions both yanked and restored: ${both.join(', ')}.` }

  const entry = structuredClone(before)
  const summary = []
  const yanked = new Set(entry.yanked ?? [])

  if (operations.yank !== undefined) {
    const versions = strings(operations.yank)
    if (!versions?.length || !versions.every(isSemver))
      return { error: 'The versions to yank are not versions.' }
    versions.forEach(version => yanked.add(version))
    summary.push(`yank ${versions.join(', ')}`)
  }
  if (operations.unyank !== undefined) {
    const versions = strings(operations.unyank)
    if (!versions?.length || !versions.every(isSemver))
      return { error: 'The versions to unyank are not versions.' }
    versions.forEach(version => yanked.delete(version))
    summary.push(`unyank ${versions.join(', ')}`)
  }
  if (yanked.size)
    entry.yanked = [...yanked]
  else
    delete entry.yanked

  if (operations.revoke_signers !== undefined) {
    const ids = strings(operations.revoke_signers)?.map(id => id.toUpperCase())
    if (!ids?.length || !ids.every(id => SIGNER.test(id)))
      return { error: 'The signers to revoke are not key ids.' }
    entry.revoked_signers = [...new Set([...(entry.revoked_signers ?? []), ...ids])]
    summary.push(`revoke signer ${ids.join(', ')}`)
  }

  if (operations.categories !== undefined) {
    const categories = strings(operations.categories)
    if (!categories?.length || categories.length > 3 || !categories.every(id => knownCategories.includes(id)))
      return { error: 'The categories must be one to three known category ids.' }
    entry.categories = [...new Set(categories)]
    summary.push('change categories')
  }

  if (operations.store !== undefined) {
    const store = operations.store
    const repo = store?.source === 'repo' && (store.follow === 'branch' || store.follow === 'release') && Object.keys(store).length === 2
    const catalog = store?.source === 'catalog' && Object.keys(store).length === 1
    if (!repo && !catalog)
      return { error: 'The store source is not one the schema knows.' }
    entry.store = repo ? { source: 'repo', follow: store.follow } : { source: 'catalog' }
    summary.push('move the store source')
  }

  // Commercial details of a partner plugin, or null to drop them; reviewed.
  if (operations.commercial !== undefined) {
    if (operations.commercial === null) {
      delete entry.commercial
    }
    else {
      const c = operations.commercial
      if (!c || typeof c !== 'object' || typeof c.purchase_url !== 'string' || !c.pricing || typeof c.pricing !== 'object')
        return { error: 'The commercial details need a price text and a purchase link.' }
      entry.commercial = {
        pricing: Object.fromEntries(Object.entries(c.pricing).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 200)])),
        purchase_url: c.purchase_url,
        ...(Number.isInteger(c.trial_days) ? { trial_days: c.trial_days } : {}),
        ...(c.license === 'commercial' || c.license === 'subscription' ? { license: c.license } : {}),
      }
    }
    summary.push('change the commercial details')
  }

  return { entry, summary: summary.join(', ') }
}
