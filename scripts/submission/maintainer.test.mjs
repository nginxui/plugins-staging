import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { applyMaintainerUpdate, relistDelisted } from './maintainer.mjs'

const entry = { id: 'io.x.y', name: { en: 'Y' }, trust: 'community', repository_url: 'https://github.com/x/y' }
const blocked = { plugins: [], repositories: [] }

test('trust changes write the entry', () => {
  const result = applyMaintainerUpdate(entry, blocked, { plugin_id: 'io.x.y', trust: 'verified' })
  assert.equal(JSON.parse(result.files['plugins/io.x.y.json']).trust, 'verified')
  assert.match(applyMaintainerUpdate(entry, blocked, { plugin_id: 'io.x.y', trust: 'community' }).error, /already/)
})

test('delisting with a block removes the entry and keeps it out', () => {
  const result = applyMaintainerUpdate(entry, blocked, { plugin_id: 'io.x.y', delist: { reason: 'Impersonates an official plugin.' }, block: { plugin: true, repository: 'x/y', reason: 'Impersonates an official plugin.' }, by: '0xJacky' }, { today: '2026-10-05' })
  assert.equal(result.files['plugins/io.x.y.json'], null)
  assert.deepEqual(JSON.parse(result.files['delisted/io.x.y.json']), { id: 'io.x.y', reason: 'Impersonates an official plugin.', delisted_at: '2026-10-05' })
  const next = JSON.parse(result.files['blocked.json'])
  assert.deepEqual(next.plugins, ['io.x.y'])
  assert.deepEqual(next.repositories, ['x/y'])
  assert.deepEqual(next.reasons['io.x.y'], { reason: 'Impersonates an official plugin.', added_by: '0xJacky', added_at: '2026-10-05' })
  assert.match(applyMaintainerUpdate(entry, blocked, { plugin_id: 'io.x.y', delist: {} }).error, /reason/)
})

test('a delisting keeps what the entry had withdrawn', () => {
  const withdrawn = { ...entry, yanked: ['1.0.0'], revoked_signers: ['F87F466D87CC1150'] }
  const result = applyMaintainerUpdate(withdrawn, blocked, { plugin_id: 'io.x.y', delist: { reason: 'Abandoned.' } }, { today: '2026-10-18' })
  assert.deepEqual(JSON.parse(result.files['delisted/io.x.y.json']), { id: 'io.x.y', reason: 'Abandoned.', delisted_at: '2026-10-18', yanked: ['1.0.0'], revoked_signers: ['F87F466D87CC1150'] })
})

test('listing a delisted id again keeps what was withdrawn and drops the record', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'relist-'))
  try {
    mkdirSync(path.join(root, 'delisted'))
    writeFileSync(path.join(root, 'delisted', 'io.x.y.json'), JSON.stringify({ id: 'io.x.y', reason: 'x', delisted_at: '2026-10-18', yanked: ['1.0.0'], revoked_signers: ['f87f466d87cc1150'] }))
    const result = relistDelisted({ id: 'io.x.y', name: { en: 'Y' } }, { root })
    assert.deepEqual(result.entry, { id: 'io.x.y', name: { en: 'Y' }, yanked: ['1.0.0'], revoked_signers: ['F87F466D87CC1150'] })
    assert.deepEqual(result.drafts, { 'delisted/io.x.y.json': null })
    assert.deepEqual(relistDelisted({ id: 'io.a.b' }, { root }), { entry: { id: 'io.a.b' }, drafts: {} })
  }
  finally {
    rmSync(root, { recursive: true, force: true })
  }
})
