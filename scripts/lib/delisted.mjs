// Records of delisted plugins, delisted/<id>.json, which the catalog lists in
// index.json so hosts with a copy installed hear of the take down.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const KEY_ID = /^[0-9A-F]{16}$/

/** What is wrong with a record read from file, an empty list when nothing. */
export function delistedProblems(record, file) {
  const problems = []
  const id = path.basename(file, '.json')
  if (!record || typeof record !== 'object')
    return ['not an object']
  if (record.id !== id || !ID.test(id))
    problems.push(`id must be ${id}`)
  if (!DATE.test(String(record.delisted_at ?? '')))
    problems.push('delisted_at must be a date')
  if (record.reason !== undefined && (typeof record.reason !== 'string' || record.reason.length > 500))
    problems.push('reason must be text of at most 500 characters')
  if (record.yanked !== undefined && !(Array.isArray(record.yanked) && record.yanked.every(v => typeof v === 'string')))
    problems.push('yanked must list versions')
  if (record.revoked_signers !== undefined && !(Array.isArray(record.revoked_signers) && record.revoked_signers.every(k => KEY_ID.test(k))))
    problems.push('revoked_signers must list upper case key ids')
  return problems
}

/** Every record under root/delisted, by id. A record that does not hold up is skipped. */
export function loadDelisted(root) {
  const dir = path.join(root, 'delisted')
  if (!existsSync(dir))
    return []
  const records = []
  for (const name of readdirSync(dir).filter(file => file.endsWith('.json')).sort()) {
    const file = path.join(dir, name)
    try {
      const record = JSON.parse(readFileSync(file, 'utf8'))
      if (delistedProblems(record, file).length === 0)
        records.push({ id: record.id, ...(record.reason ? { reason: record.reason } : {}), delisted_at: record.delisted_at, ...(record.yanked?.length ? { yanked: record.yanked } : {}), ...(record.revoked_signers?.length ? { revoked_signers: record.revoked_signers } : {}) })
    }
    catch {}
  }
  return records
}
