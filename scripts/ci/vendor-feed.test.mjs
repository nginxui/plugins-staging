import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseFeed, recordOf, vendorReleases } from './vendor-feed.mjs'

const sha = 'a'.repeat(64)
const entry = { id: 'com.example.log', trust: 'verified', distribution: { type: 'vendor', releases_url: 'https://example.com/releases.json' } }
const feed = { releases: [
  { version: '1.1.0', released_at: '2026-10-01T00:00:00Z', downloads: { 'linux-amd64': { url: 'https://cdn.example.com/a.tar.gz', sha256: sha } } },
  { version: '1.0.0', downloads: { any: { url: 'https://cdn.example.com/p.tar.gz', sha256: sha } } },
  { version: 'one', downloads: {} },
  { version: '0.9.0', downloads: { any: { url: 'http://insecure', sha256: sha } } },
] }

test('a feed gives releases with https downloads and digests only', () => {
  const { releases, problems } = parseFeed(feed)
  assert.deepEqual(releases.map(r => r.version), ['1.1.0', '1.0.0'])
  assert.equal(problems.length, 3)
  assert.deepEqual(recordOf(releases[1]), { version: '1.0.0', download_url: 'https://cdn.example.com/p.tar.gz', sha256: sha })
  assert.deepEqual(recordOf(releases[0]).downloads, { 'linux-amd64': { url: 'https://cdn.example.com/a.tar.gz', sha256: sha } })
})

test('new releases are verified once, pinned ones must keep their digests', async () => {
  const fetchImpl = async () => Response.json(feed)
  const verify = async (_entry, record) => ({ ok: true, signer: 'ABCDEF0123456789', manifest: { id: 'com.example.log', version: record.version, api_version: 1 } })
  const built = await vendorReleases(entry, undefined, { failed: {}, visited: new Set(), fetchImpl, verify })
  assert.deepEqual(built.releases.map(r => [r.version, r.signer]), [['1.1.0', 'ABCDEF0123456789'], ['1.0.0', 'ABCDEF0123456789']])
  assert.equal(built.failures.length, 0)

  const published = { releases: [{ version: '1.0.0', download_url: 'https://cdn.example.com/p.tar.gz', sha256: 'b'.repeat(64) }] }
  const changed = await vendorReleases(entry, published, { failed: {}, visited: new Set(), fetchImpl, verify })
  assert.match(changed.failures[0], /other packages than the catalog pins/)
})

test('a package naming another plugin is left out', async () => {
  const fetchImpl = async () => Response.json({ releases: [feed.releases[0]] })
  const verify = async () => ({ ok: true, manifest: { id: 'com.other.thing', version: '1.1.0' } })
  const failed = {}
  const built = await vendorReleases(entry, undefined, { failed, visited: new Set(), fetchImpl, verify })
  assert.equal(built.releases.length, 0)
  assert.ok(failed['com.example.log@1.1.0'])
})
