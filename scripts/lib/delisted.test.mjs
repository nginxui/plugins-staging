import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { delistedProblems, loadDelisted } from './delisted.mjs'

test('delisted records are read by id and checked', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'delisted-'))
  try {
    mkdirSync(path.join(root, 'delisted'))
    writeFileSync(path.join(root, 'delisted', 'io.x.y.json'), JSON.stringify({ id: 'io.x.y', reason: 'Abandoned.', delisted_at: '2026-10-18', revoked_signers: ['F87F466D87CC1150'] }))
    writeFileSync(path.join(root, 'delisted', 'io.x.z.json'), JSON.stringify({ id: 'io.other', delisted_at: '2026-10-18' }))
    assert.deepEqual(loadDelisted(root), [{ id: 'io.x.y', reason: 'Abandoned.', delisted_at: '2026-10-18', revoked_signers: ['F87F466D87CC1150'] }])
    assert.deepEqual(delistedProblems({ id: 'io.other', delisted_at: 'today' }, 'delisted/io.x.z.json'), ['id must be io.x.z', 'delisted_at must be a date'])
    assert.deepEqual(loadDelisted(path.join(root, 'none')), [])
  }
  finally {
    rmSync(root, { recursive: true, force: true })
  }
})
