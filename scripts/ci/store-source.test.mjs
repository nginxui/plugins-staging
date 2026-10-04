import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { readStoreSource, withStore } from './store-source.mjs'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test('a catalog hosted document is read from store/<id>/', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'store-'))
  mkdirSync(path.join(root, 'store', 'io.x.y'), { recursive: true })
  writeFileSync(path.join(root, 'store', 'io.x.y', 'store.json'), JSON.stringify({ description: { en: 'Hi' } }))
  writeFileSync(path.join(root, 'store', 'io.x.y', 'README.md'), '# Y')
  const store = await readStoreSource({ id: 'io.x.y', store: { source: 'catalog' } }, { root, commit: 'c0ffee', catalogRepo: 'nginxui/plugins' })
  assert.deepEqual(store.doc, { description: { en: 'Hi' } })
  assert.equal(store.readmeUrl, 'https://raw.githubusercontent.com/nginxui/plugins/c0ffee/store/io.x.y/README.md')
  assert.equal(store.image(`media:${'b'.repeat(64)}`), `https://plugin-media.nginxui.com/${'b'.repeat(64)}.webp`)
})

test('a repository document follows the default branch at its newest commit', async () => {
  globalThis.fetch = async (url) => {
    if (url === 'https://api.github.com/repos/x/y')
      return Response.json({ default_branch: 'main' })
    if (url === 'https://api.github.com/repos/x/y/commits/main')
      return Response.json({ sha: 'f00d' })
    if (url === 'https://raw.githubusercontent.com/x/y/f00d/plugin.store.json')
      return Response.json({ homepage_url: 'https://y.example' })
    return new Response(null, { status: 404 })
  }
  const store = await readStoreSource({ id: 'io.x.y', store: { source: 'repo', follow: 'branch' } }, { repo: { owner: 'x', repo: 'y' }, tag: 'v1.0.0' })
  assert.equal(store.ref, 'f00d')
  assert.equal(store.image('docs/a.png'), 'https://raw.githubusercontent.com/x/y/f00d/docs/a.png')
  const missing = await readStoreSource({ id: 'io.x.y', store: { source: 'repo', follow: 'release' } }, { repo: { owner: 'x', repo: 'y' }, tag: 'v1.0.0' })
  assert.match(missing.error, /HTTP 404/)
})

test('a document replaces only the parts it holds', () => {
  const manifest = { name: 'Y', description: 'Old', homepage_url: 'https://old', i18n: { zh_CN: { name: '旧', description: '旧的' } }, screenshots: [{ id: 'a', path: 'a.png' }] }
  const out = withStore(manifest, { description: { en: 'New', ja_JP: '新' } })
  assert.equal(out.description, 'New')
  assert.deepEqual(out.i18n, { zh_CN: { name: '旧' }, ja_JP: { description: '新' } })
  assert.equal(out.homepage_url, 'https://old')
  assert.deepEqual(out.screenshots, manifest.screenshots)
})
