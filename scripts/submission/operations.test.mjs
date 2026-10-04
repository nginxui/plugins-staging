// Run with: node --test scripts/submission/*.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify } from '../ci/classify.mjs'
import { applyOperations } from './operations.mjs'

const entry = { id: 'io.x.y', name: { en: 'Y' }, categories: ['security'], trust: 'community' }
const known = ['security', 'templates', 'tools']

test('yanking and unyanking edit the yanked list and stay self service', () => {
  const yanked = applyOperations(entry, { yank: ['1.0.0', '1.1.0'] }, known)
  assert.deepEqual(yanked.entry.yanked, ['1.0.0', '1.1.0'])
  assert.equal(yanked.summary, 'yank 1.0.0, 1.1.0')
  assert.equal(classify(entry, yanked.entry).class, 'self_service')
  const back = applyOperations(yanked.entry, { unyank: ['1.0.0', '1.1.0'] }, known)
  assert.equal('yanked' in back.entry, false)
})

test('revoking signers adds upper case key ids once', () => {
  const result = applyOperations({ ...entry, revoked_signers: ['AAAAAAAAAAAAAAAA'] }, { revoke_signers: ['f87f466d87cc1150', 'AAAAAAAAAAAAAAAA'] }, known)
  assert.deepEqual(result.entry.revoked_signers, ['AAAAAAAAAAAAAAAA', 'F87F466D87CC1150'])
  assert.equal(classify(entry, result.entry).class, 'self_service')
})

test('categories are replaced by one to three known ids', () => {
  assert.deepEqual(applyOperations(entry, { categories: ['templates', 'tools'] }, known).entry.categories, ['templates', 'tools'])
  assert.match(applyOperations(entry, { categories: [] }, known).error, /one to three/)
  assert.match(applyOperations(entry, { categories: ['made-up'] }, known).error, /one to three/)
})

test('nothing but the known operations is accepted', () => {
  assert.match(applyOperations(entry, { trust: 'official' }, known).error, /Unknown operations/)
  assert.match(applyOperations(entry, { yank: ['latest'] }, known).error, /not versions/)
  assert.match(applyOperations(entry, { revoke_signers: ['nope'] }, known).error, /not key ids/)
  assert.match(applyOperations(null, { yank: ['1.0.0'] }, known).error, /not listed/)
  assert.match(applyOperations(entry, {}, known).error, /No operation/)
})

test('several operations go in one change, but never yank and restore one version', () => {
  const result = applyOperations({ ...entry, yanked: ['0.9.0'] }, { yank: ['1.0.0', '1.1.0'], unyank: ['0.9.0'], revoke_signers: ['AAAAAAAAAAAAAAAA'] }, known)
  assert.deepEqual(result.entry.yanked, ['1.0.0', '1.1.0'])
  assert.deepEqual(result.entry.revoked_signers, ['AAAAAAAAAAAAAAAA'])
  assert.equal(result.summary, 'yank 1.0.0, 1.1.0, unyank 0.9.0, revoke signer AAAAAAAAAAAAAAAA')
  assert.match(applyOperations(entry, { yank: ['1.0.0'], unyank: ['1.0.0'] }, known).error, /both yanked and restored/)
})

test('the store source moves and needs a review', () => {
  const result = applyOperations(entry, { store: { source: 'repo', follow: 'branch' } }, known)
  assert.deepEqual(result.entry.store, { source: 'repo', follow: 'branch' })
  assert.equal(classify(entry, result.entry).class, 'reviewed')
  assert.ok(applyOperations(entry, { store: { source: 'repo' } }, known).error)
  assert.ok(applyOperations(entry, { store: { source: 'catalog', follow: 'branch' } }, known).error)
})

test('commercial details are reviewed and can be dropped', () => {
  const result = applyOperations(entry, { commercial: { pricing: { en: 'From 199 USD', de_DE: ' ' }, purchase_url: 'https://example.com/buy', trial_days: 14, license: 'subscription' } }, known)
  assert.deepEqual(result.entry.commercial, { pricing: { en: 'From 199 USD' }, purchase_url: 'https://example.com/buy', trial_days: 14, license: 'subscription' })
  assert.equal(classify(entry, result.entry).class, 'reviewed')
  assert.equal('commercial' in applyOperations(result.entry, { commercial: null }, known).entry, false)
  assert.ok(applyOperations(entry, { commercial: { pricing: {} } }, known).error)
})

