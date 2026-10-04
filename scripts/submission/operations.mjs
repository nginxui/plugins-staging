// The self service operations the developer portal sends for a listed plugin,
// applied to its entry on main. The portal names operations, never fields, so
// whatever it sends, only these fields can change; scripts/ci/classify.mjs
// still decides from the result whether it may be committed directly.

import { isSemver } from '../ci/semver.mjs'

const SIGNER = /^[0-9a-f]{16}$/i
const KINDS = ['yank', 'unyank', 'revoke_signers', 'categories']

/** A list of strings, or null when it is not one. */
function strings(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : null
}

/**
 * Applies operations to an entry. Returns { entry, summary } or { error }.
 * operations: { yank, unyank, revoke_signers, categories }, each optional.
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

  return { entry, summary: summary.join(', ') }
}
