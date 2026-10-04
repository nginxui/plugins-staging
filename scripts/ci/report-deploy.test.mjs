// Run with: node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildReport } from './report-deploy.mjs'

test('a deploy report holds every entry and the plugins with a verified release', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-'))
  mkdirSync(path.join(dir, 'plugins'))
  mkdirSync(path.join(dir, 'dist/v1'), { recursive: true })
  writeFileSync(path.join(dir, 'plugins/io.a.listed.json'), JSON.stringify({ id: 'io.a.listed', name: { en: 'A' } }))
  writeFileSync(path.join(dir, 'plugins/io.b.unverified.json'), JSON.stringify({ id: 'io.b.unverified', name: { en: 'B' } }))
  writeFileSync(path.join(dir, 'dist/v1/index.json'), JSON.stringify({ plugins: [
    { id: 'io.a.listed', releases: [{ version: '1.0.0' }] },
    { id: 'io.b.unverified', releases: [] },
  ] }))
  const report = buildReport({ commit: 'abc', entriesDir: path.join(dir, 'plugins'), indexFile: path.join(dir, 'dist/v1/index.json') })
  assert.equal(report.commit, 'abc')
  assert.deepEqual(Object.keys(report.entries).sort(), ['io.a.listed', 'io.b.unverified'])
  assert.deepEqual(report.listed, ['io.a.listed'])
})
