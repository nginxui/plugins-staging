import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMaintainerUpdate } from './maintainer.mjs'

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
  const next = JSON.parse(result.files['blocked.json'])
  assert.deepEqual(next.plugins, ['io.x.y'])
  assert.deepEqual(next.repositories, ['x/y'])
  assert.deepEqual(next.reasons['io.x.y'], { reason: 'Impersonates an official plugin.', added_by: '0xJacky', added_at: '2026-10-05' })
  assert.match(applyMaintainerUpdate(entry, blocked, { plugin_id: 'io.x.y', delist: {} }).error, /reason/)
})
