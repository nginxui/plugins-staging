// Run with: node --test scripts/submission/*.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
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

test('moving the store texts out of the catalog removes their directory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'portal-'))
  try {
    mkdirSync(path.join(dir, 'plugins'))
    mkdirSync(path.join(dir, 'store', 'io.x.y'), { recursive: true })
    writeFileSync(path.join(dir, 'plugins', 'io.x.y.json'), JSON.stringify({ id: 'io.x.y', name: { en: 'Y' }, store: { source: 'catalog' } }))
    writeFileSync(path.join(dir, 'store', 'io.x.y', 'store.json'), '{}')
    const output = path.join(dir, 'out')
    execFileSync(process.execPath, [fileURLToPath(new URL('./portal.mjs', import.meta.url))], {
      cwd: dir,
      env: { ...process.env, GITHUB_OUTPUT: output, PAYLOAD: JSON.stringify({ kind: 'entry_update', plugin_id: 'io.x.y', operations: { store: { source: 'repo', follow: 'branch' } }, submitter: { login: 'octo', id: 1 } }) },
      stdio: 'ignore',
    })
    const drafts = JSON.parse(readFileSync(output, 'utf8').match(/^drafts<<(\S+)\n([\s\S]*?)\n\1$/m)[2])
    assert.equal(drafts['store/io.x.y/store.json'], null)
    assert.equal(JSON.parse(drafts['plugins/io.x.y.json']).store.source, 'repo')
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
