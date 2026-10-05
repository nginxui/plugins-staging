// Run with: node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify } from './classify.mjs'

const entry = {
  id: 'io.github.octo.geoip',
  name: { en: 'GeoIP Access' },
  author: 'octo',
  author_public_key: 'RWQ...',
  repository_url: 'https://github.com/octo/geoip',
  categories: ['security'],
  trust: 'community',
}

test('a new listing and a delisting are reviewed', () => {
  assert.equal(classify(null, entry).class, 'reviewed')
  assert.equal(classify(entry, null).class, 'reviewed')
})

test('yanking, unyanking and categories are self service', () => {
  const yanked = { ...entry, yanked: ['1.0.0'] }
  assert.equal(classify(entry, yanked).class, 'self_service')
  assert.equal(classify(yanked, entry).class, 'self_service')
  assert.equal(classify(entry, { ...entry, categories: ['security', 'access'] }).class, 'self_service')
})

test('revoking a signer is self service, taking it back is reviewed', () => {
  const revoked = { ...entry, revoked_signers: ['AAAA'] }
  assert.equal(classify(entry, revoked).class, 'self_service')
  assert.equal(classify(revoked, { ...entry, revoked_signers: ['AAAA', 'BBBB'] }).class, 'self_service')
  assert.equal(classify(revoked, entry).class, 'reviewed')
  assert.equal(classify(revoked, { ...entry, revoked_signers: ['BBBB'] }).class, 'reviewed')
})

test('names, keys and URLs are reviewed', () => {
  assert.equal(classify(entry, { ...entry, name: { en: 'GeoIP Access', zh_CN: 'GeoIP 访问控制' } }).class, 'reviewed')
  assert.equal(classify(entry, { ...entry, author_public_key: 'RWQ other' }).class, 'reviewed')
  assert.equal(classify(entry, { ...entry, repository_url: 'https://github.com/other/geoip' }).class, 'reviewed')
  assert.equal(classify(entry, { ...entry, homepage_url: 'https://example.com' }).class, 'reviewed')
  assert.equal(classify(entry, { ...entry, icon_url: 'https://example.com/icon.svg' }).class, 'reviewed')
})

test('trust and maintainer overrides are maintainer only', () => {
  assert.equal(classify(entry, { ...entry, trust: 'verified' }).class, 'maintainer')
  assert.equal(classify(entry, { ...entry, description: { en: 'Better' } }).class, 'maintainer')
})

test('the strictest field decides a change of several', () => {
  const result = classify(entry, { ...entry, categories: ['access'], name: { en: 'GeoIP' } })
  assert.equal(result.class, 'reviewed')
  assert.deepEqual(result.fields.map(item => [item.field, item.class]), [['name', 'reviewed'], ['categories', 'self_service']])
})

test('moving the store document within the repository is self service, to the catalog reviewed', () => {
  assert.equal(classify(entry, { ...entry, store: { source: 'repo', follow: 'branch' } }).class, 'self_service')
  assert.equal(classify({ ...entry, store: { source: 'repo', follow: 'branch' } }, { ...entry, store: { source: 'repo', follow: 'release' } }).class, 'self_service')
  assert.equal(classify(entry, { ...entry, store: { source: 'catalog' } }).class, 'reviewed')
  assert.equal(classify({ ...entry, store: { source: 'catalog' } }, entry).class, 'reviewed')
})

test('an unknown field is reviewed', () => {
  assert.equal(classify(entry, { ...entry, future_field: true }).class, 'reviewed')
})

test('no change has no class', () => {
  assert.deepEqual(classify(entry, { ...entry }), { class: null, fields: [] })
})
