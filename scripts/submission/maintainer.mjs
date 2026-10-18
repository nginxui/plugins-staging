// Maintainer actions the developer portal sends (spec 11.5): change the trust
// of a listing, delist it, and block a plugin id or repository so it cannot
// come back. Each becomes a pull request; a null file deletes that path.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const TRUST = ['official', 'verified', 'community']
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

/**
 * entry is plugins/<id>.json or null, blocked is blocked.json, update is
 * { plugin_id, trust, delist: { reason }, block: { plugin, repository, reason }, by }.
 * Returns { files, summary, fields } or { error }.
 */
export function applyMaintainerUpdate(entry, blocked, update, { root = ROOT, today = new Date().toISOString().slice(0, 10) } = {}) {
  const id = update?.plugin_id
  const files = {}
  const summary = []
  const fields = []
  if (update.trust !== undefined) {
    if (!entry)
      return { error: 'The plugin is not listed.' }
    if (!TRUST.includes(update.trust))
      return { error: 'The trust level is not known.' }
    if (entry.trust === update.trust)
      return { error: `The trust already is ${update.trust}.` }
    files[`plugins/${id}.json`] = `${JSON.stringify({ ...entry, trust: update.trust }, null, 2)}\n`
    summary.push(`set the trust of ${id} to ${update.trust}`)
    fields.push({ field: 'trust', change: 'changed', class: 'maintainer' })
  }
  if (update.delist) {
    if (!entry)
      return { error: 'The plugin is not listed.' }
    if (!String(update.delist.reason ?? '').trim())
      return { error: 'Delisting needs a reason.' }
    files[`plugins/${id}.json`] = null
    for (const file of ['store.json', 'README.md']) {
      if (existsSync(path.join(root, 'store', id, file)))
        files[`store/${id}/${file}`] = null
    }
    // The catalog keeps a record of the take down, so hosts with the plugin
    // installed hear of it and of what the entry had withdrawn.
    files[`delisted/${id}.json`] = `${JSON.stringify(delistedRecord(entry, update.delist.reason, today), null, 2)}\n`
    summary.push(`delist ${id}`)
    fields.push({ field: 'listing', change: 'removed', class: 'maintainer' })
  }
  if (update.block) {
    const reason = String(update.block.reason ?? '').trim().slice(0, 500)
    if (!reason)
      return { error: 'Blocking needs a reason.' }
    const next = { plugins: [...(blocked?.plugins ?? [])], repositories: [...(blocked?.repositories ?? [])], reasons: { ...(blocked?.reasons ?? {}) } }
    const note = { reason, ...(update.by ? { added_by: update.by } : {}), added_at: today }
    if (update.block.plugin) {
      if (!next.plugins.includes(id))
        next.plugins.push(id)
      next.reasons[id] = note
    }
    if (update.block.repository) {
      const repo = String(update.block.repository)
      if (!REPO.test(repo))
        return { error: 'The repository is not <owner>/<repo>.' }
      if (!next.repositories.some(r => r.toLowerCase() === repo.toLowerCase()))
        next.repositories.push(repo)
      next.reasons[repo] = note
    }
    files['blocked.json'] = `${JSON.stringify(next, null, 2)}\n`
    summary.push(`block ${[update.block.plugin ? id : null, update.block.repository ?? null].filter(Boolean).join(' and ')}`)
    fields.push({ field: 'blocked', change: 'added', class: 'maintainer' })
  }
  if (!summary.length)
    return { error: 'No maintainer action was given.' }
  return { files, summary: summary.join(', '), fields }
}

/** The record delisted/<id>.json keeps of a delisted entry. */
export function delistedRecord(entry, reason, today) {
  return {
    id: entry.id,
    reason: String(reason).trim().slice(0, 500),
    delisted_at: today,
    ...(entry.yanked?.length ? { yanked: entry.yanked } : {}),
    ...(entry.revoked_signers?.length ? { revoked_signers: entry.revoked_signers } : {}),
  }
}

/**
 * A new listing of an id the catalog delisted keeps what the old entry had
 * withdrawn, so taking a plugin down and listing it again never brings a
 * yanked version or a revoked key back. Returns the entry and the drafts that
 * remove the record.
 */
export function relistDelisted(entry, { root = ROOT } = {}) {
  const file = path.join(root, 'delisted', `${entry.id}.json`)
  if (!existsSync(file))
    return { entry, drafts: {} }
  const record = JSON.parse(readFileSync(file, 'utf8'))
  const merged = { ...entry }
  const yanked = [...new Set([...(entry.yanked ?? []), ...(record.yanked ?? [])])]
  const revoked = [...new Set([...(entry.revoked_signers ?? []), ...(record.revoked_signers ?? [])].map(id => id.toUpperCase()))]
  if (yanked.length)
    merged.yanked = yanked
  if (revoked.length)
    merged.revoked_signers = revoked
  return { entry: merged, drafts: { [`delisted/${entry.id}.json`]: null } }
}
