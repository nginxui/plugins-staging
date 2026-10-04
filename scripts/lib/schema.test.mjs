// The store field of an entry and the store document it points to.
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateAgainstSchemaFile } from './schema-validator.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRY = path.join(ROOT, 'schema', 'entry.schema.json')
const STORE = path.join(ROOT, 'schema', 'store.schema.json')

const entry = store => ({
  id: 'io.github.octo.hello',
  name: { en: 'Hello' },
  author: 'octo',
  author_public_key: 'untrusted comment: minisign public key 0102030405060708',
  repository_url: 'https://github.com/octo/hello',
  trust: 'community',
  ...(store === undefined ? {} : { store }),
})

test('an entry names where its store document lives', () => {
  for (const store of [undefined, { source: 'repo', follow: 'branch' }, { source: 'repo', follow: 'release' }, { source: 'catalog' }])
    assert.deepEqual(validateAgainstSchemaFile(ENTRY, entry(store)), [], JSON.stringify(store))
  for (const store of [{ source: 'repo' }, { source: 'catalog', follow: 'branch' }, { source: 'r2' }, 'repo'])
    assert.notDeepEqual(validateAgainstSchemaFile(ENTRY, entry(store)), [], JSON.stringify(store))
})

test('a store document holds texts and screenshots by repository path or upload', () => {
  const doc = {
    name: { en: 'GeoIP Access', zh_CN: 'GeoIP 访问控制' },
    description: { en: 'Allow or deny by country.' },
    homepage_url: 'https://example.com',
    screenshots: [
      { id: 'dashboard', path: 'docs/screenshots/1-dashboard.png', dark_path: 'docs/screenshots/1-dashboard-dark.png', caption: { en: 'Dashboard' } },
      { id: 'rules', path: `media:${'a'.repeat(64)}` },
    ],
  }
  assert.deepEqual(validateAgainstSchemaFile(STORE, doc), [])
  for (const bad of ['/etc/passwd.png', '../x.png', 'docs/../../x.png', 'docs/x.svg', 'media:abc'])
    assert.notDeepEqual(validateAgainstSchemaFile(STORE, { screenshots: [{ id: 'x', path: bad }] }), [], bad)
  assert.notDeepEqual(validateAgainstSchemaFile(STORE, { categories: ['tools'] }), [])
})
