// Partner changes the developer portal sends (spec 8, 11.5): a new partner
// from an approved application, a profile edit, a key rotation, and a key
// revocation. Only a revocation, which reduces trust, is committed directly;
// everything else is a pull request a maintainer merges.
//
// Also drafts the entry of a vendor distributed plugin, which has no
// repository to draft it from.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reservedWord } from '../ci/names.mjs'
import { parsePublicKey } from '../lib/minisign.mjs'
import { validateAgainstSchemaFile } from '../lib/schema-validator.mjs'
import { knownCategories, loadBlocked } from './core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PARTNER_SCHEMA = path.join(ROOT, 'schema', 'partner.schema.json')
const ENTRY_SCHEMA = path.join(ROOT, 'schema', 'entry.schema.json')
const NAME = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const PROFILE = ['display_name', 'kind', 'github_owner', 'homepage_url', 'description', 'logo_url']

const schemaErrors = (file, value) => validateAgainstSchemaFile(file, value).map(e => (typeof e === 'string' ? e : JSON.stringify(e)))

/**
 * Applies a partner update to partners/<name>.json, before being the file
 * now or null. update: { name, profile, public_key, expires, revoke: { reason } }.
 * Returns { files, class, summary, fields } or { error }.
 */
export function applyPartnerUpdate(before, update) {
  if (!NAME.test(update?.name ?? ''))
    return { error: 'The partner name is not valid.' }
  const after = before ? structuredClone(before) : { name: update.name }
  const fields = []
  if (update.revoke) {
    if (!before)
      return { error: 'There is no such partner to revoke.' }
    const reason = String(update.revoke.reason ?? '').trim().slice(0, 500)
    if (!reason)
      return { error: 'A revocation needs a reason.' }
    after.revoked = true
    after.reason = reason
    fields.push({ field: 'revoked', change: 'changed', class: 'self_service' })
  }
  for (const key of PROFILE) {
    const value = update.profile?.[key]
    if (value === undefined)
      continue
    if (value === null || value === '')
      delete after[key]
    else
      after[key] = value
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after[key]))
      fields.push({ field: key, change: before?.[key] === undefined ? 'added' : 'changed', class: 'maintainer' })
  }
  if (update.public_key !== undefined) {
    try {
      parsePublicKey(String(update.public_key))
    }
    catch {
      return { error: 'The partner key is not a minisign public key.' }
    }
    if (before?.public_key !== update.public_key) {
      after.public_key = update.public_key
      fields.push({ field: 'public_key', change: before ? 'changed' : 'added', class: 'maintainer' })
    }
  }
  if (update.expires !== undefined) {
    after.expires = update.expires
    fields.push({ field: 'expires', change: 'changed', class: 'maintainer' })
  }
  if (after.display_name && reservedWord(after.display_name))
    return { error: `The display name holds ${reservedWord(after.display_name)}.` }
  const errors = schemaErrors(PARTNER_SCHEMA, after)
  if (errors.length)
    return { error: `The partner file would not be valid: ${errors.join('; ')}.` }
  if (!fields.length)
    return { error: 'The partner already is as asked.' }
  const reviewed = fields.some(f => f.class === 'maintainer')
  return {
    files: { [`partners/${update.name}.json`]: `${JSON.stringify(after, null, 2)}\n` },
    class: reviewed ? 'maintainer' : 'self_service',
    summary: update.revoke ? `revoke the partner key of ${update.name}` : before ? `update the partner ${update.name}` : `add the partner ${update.name}`,
    fields,
    partner: after,
  }
}

/** The partner file in the repository, or null. */
export function readPartner(name, root = ROOT) {
  const file = path.join(root, 'partners', `${name}.json`)
  return NAME.test(name) && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

/**
 * The entry of a vendor distributed plugin. listing: { id, name, author,
 * partner, releases_url, categories, license, description }. The packages
 * are verified by the checks, as for any new listing.
 */
export function draftVendorEntry(listing, { blocked = loadBlocked(), partner = readPartner(listing?.partner ?? '') } = {}) {
  if (!partner || partner.revoked)
    return { rejection: 'Only a partner with a valid key can list a plugin without a repository.' }
  if (partner.kind !== 'vendor')
    return { rejection: 'Only a vendor partner lists plugins without a repository.' }
  const id = String(listing.id ?? '')
  if (!/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/.test(id) || id.startsWith('com.nginxui.') || id.startsWith('io.github.'))
    return { rejection: `The plugin id ${JSON.stringify(id)} is not a reverse domain id of the vendor.` }
  if (blocked.plugins.some(p => p.toLowerCase() === id))
    return { rejection: `${id} is blocked.` }
  const name = listing.name ?? {}
  for (const [locale, text] of Object.entries(name)) {
    if (reservedWord(text))
      return { rejection: `The name in ${locale} holds ${reservedWord(text)}.` }
  }
  const categories = (listing.categories ?? []).filter(c => knownCategories().includes(c)).slice(0, 3)
  const entry = {
    id,
    name,
    ...(listing.description ? { description: listing.description } : {}),
    author: partner.display_name ?? partner.name,
    ...(listing.license ? { license: listing.license } : {}),
    trust: 'verified',
    distribution: { type: 'vendor', releases_url: listing.releases_url },
    store: { source: 'catalog' },
    ...(categories.length ? { categories } : {}),
  }
  const errors = schemaErrors(ENTRY_SCHEMA, entry)
  if (errors.length)
    return { rejection: `The entry would not be valid: ${errors.join('; ')}.` }
  return { entry }
}
