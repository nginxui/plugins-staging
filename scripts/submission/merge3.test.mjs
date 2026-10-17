import assert from 'node:assert/strict'
import { test } from 'node:test'
import { merge3, MergeConflict, mergeFile } from './merge3.mjs'

test('changes to different keys on both sides both stay', () => {
  const base = { name: { en: 'Y' }, description: { en: 'Old' } }
  const theirs = { name: { en: 'Y' }, description: { en: 'Old', ko_KR: '설명' } }
  const mine = { name: { en: 'Y', ko_KR: '이름' }, description: { en: 'Old' } }
  assert.deepEqual(merge3(base, theirs, mine), { name: { en: 'Y', ko_KR: '이름' }, description: { en: 'Old', ko_KR: '설명' } })
})

test('a key removed on one side and left alone on the other goes', () => {
  assert.deepEqual(merge3({ a: 1, b: 2 }, { a: 1, b: 2, c: 3 }, { a: 1 }), { a: 1, c: 3 })
})

test('the same key changed to different values is a conflict', () => {
  assert.throws(() => merge3({ d: { en: 'Old' } }, { d: { en: 'Theirs' } }, { d: { en: 'Mine' } }), MergeConflict)
  // Lists merge as a whole.
  assert.throws(() => merge3({ c: ['a'] }, { c: ['a', 'b'] }, { c: ['a', 'c'] }), MergeConflict)
  assert.deepEqual(merge3({ c: ['a'] }, { c: ['a', 'b'] }, { c: ['a', 'b'] }), { c: ['a', 'b'] })
})

test('files merge as JSON, a file deleted on one side stays deleted', () => {
  assert.equal(mergeFile('{"a":1}', '{"a":1,"b":2}', '{"a":3}'), '{\n  "a": 3,\n  "b": 2\n}\n')
  assert.equal(mergeFile('{"a":1}', '{"a":1}', null), null)
  assert.equal(mergeFile(null, null, '{"a":1}'), '{\n  "a": 1\n}\n')
})
