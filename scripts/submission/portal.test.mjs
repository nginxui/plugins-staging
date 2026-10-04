// Run with: node --test scripts/submission/*.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { submissionFromPayload } from './portal.mjs'

const payload = {
  kind: 'new_listing',
  repository_url: 'https://github.com/octo/geoip',
  author_public_key: 'untrusted comment: minisign public key\nRWQ...',
  categories: ['security'],
  submitter: { login: 'octo', id: 42 },
  eligibility: '@octo installed the Catalog App on octo/geoip',
}

test('a portal payload becomes a submission', () => {
  const parsed = submissionFromPayload(JSON.stringify(payload))
  assert.deepEqual(parsed.submission, {
    repository_url: payload.repository_url,
    author_public_key: payload.author_public_key,
    categories: ['security'],
    submitter: { login: 'octo', id: 42 },
  })
  assert.equal(parsed.eligibility, payload.eligibility)
})

test('a malformed payload is refused', () => {
  assert.match(submissionFromPayload('not json').error, /not JSON/)
  assert.match(submissionFromPayload(JSON.stringify({ ...payload, kind: 'delete_everything' })).error, /Unknown change kind/)
  assert.match(submissionFromPayload(JSON.stringify({ ...payload, submitter: { login: 'octo\nCo-authored-by: x', id: 42 } })).error, /GitHub account/)
  assert.match(submissionFromPayload(JSON.stringify({ ...payload, submitter: { login: 'octo', id: '42' } })).error, /GitHub account/)
  assert.match(submissionFromPayload(JSON.stringify({ ...payload, categories: 'security' })).error, /categories/)
  assert.match(submissionFromPayload(JSON.stringify({ ...payload, repository_url: 1 })).error, /required/)
})

test('a long eligibility note is cut', () => {
  const parsed = submissionFromPayload(JSON.stringify({ ...payload, eligibility: 'x'.repeat(1000) }))
  assert.equal(parsed.eligibility.length, 300)
})

test('an entry update names the plugin, the operations and the reason', () => {
  const parsed = submissionFromPayload(JSON.stringify({
    kind: 'entry_update',
    plugin_id: 'io.github.octo.geoip',
    operations: { yank: ['1.0.0'] },
    reason: '  Breaks the config  ',
    submitter: { login: 'octo', id: 42 },
  }))
  assert.deepEqual(parsed.update, { pluginId: 'io.github.octo.geoip', operations: { yank: ['1.0.0'] }, reason: 'Breaks the config' })
  assert.deepEqual(parsed.submitter, { login: 'octo', id: 42 })
  assert.match(submissionFromPayload(JSON.stringify({ kind: 'entry_update', plugin_id: '../x', submitter: { login: 'octo', id: 42 } })).error, /plugin id/)
})
