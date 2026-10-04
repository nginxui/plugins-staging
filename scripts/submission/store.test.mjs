import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyStoreUpdate } from './store.mjs'

const entry = { id: 'io.x.y', name: { en: 'Y' }, author: 'x', repository_url: 'https://github.com/x/y', trust: 'community', store: { source: 'catalog' } }
const media = `media:${'a'.repeat(64)}`

test('descriptions and screenshots are committed, names are reviewed', () => {
  const before = { description: { en: 'Old' } }
  const texts = applyStoreUpdate(entry, before, { doc: { description: { en: 'New' }, screenshots: [{ id: 'one', path: media }] } })
  assert.equal(texts.class, 'self_service')
  assert.deepEqual(Object.keys(texts.files), ['store/io.x.y/store.json'])
  const names = applyStoreUpdate(entry, before, { doc: { ...before, name: { en: 'Y', ja_JP: 'ワイ' } } })
  assert.equal(names.class, 'reviewed')
})

test('moving to the catalog writes the entry too and is reviewed', () => {
  const { store: _, ...repoEntry } = entry
  const moved = applyStoreUpdate(repoEntry, null, { doc: { description: { en: 'Text' } }, readme: '# Y', setSource: { source: 'catalog' } })
  assert.equal(moved.class, 'reviewed')
  assert.deepEqual(moved.entry.store, { source: 'catalog' })
  assert.deepEqual(Object.keys(moved.files).sort(), ['plugins/io.x.y.json', 'store/io.x.y/README.md', 'store/io.x.y/store.json'])
  assert.match(applyStoreUpdate(repoEntry, null, { doc: {} }).error, /not the catalog/)
})

test('a document that could not be listed is refused', () => {
  assert.match(applyStoreUpdate(entry, null, { doc: { name: { en: 'Official Y' } } }).error, /official/)
  assert.match(applyStoreUpdate(entry, null, { doc: { screenshots: [{ id: 'one', path: 'docs/a.png' }] } }).error, /upload/)
  assert.match(applyStoreUpdate(entry, null, { doc: { description: { en: 'The official Nginx UI plugin.' } } }).error, /official/)
})
