import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyPartnerUpdate, draftVendorEntry } from './partner.mjs'

const key = 'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3'

test('a new partner and a key change go to a maintainer', () => {
  const added = applyPartnerUpdate(null, { name: 'example-cloud', public_key: key, profile: { display_name: 'Example Cloud', kind: 'vendor', homepage_url: 'https://example.com' } })
  assert.equal(added.class, 'maintainer')
  assert.deepEqual(Object.keys(added.files), ['partners/example-cloud.json'])
  assert.equal(added.partner.display_name, 'Example Cloud')
  assert.match(applyPartnerUpdate(null, { name: 'x', public_key: 'nope' }).error, /not a minisign/)
})

test('a revocation is committed directly and needs a reason', () => {
  const before = { name: 'example-cloud', public_key: key }
  assert.match(applyPartnerUpdate(before, { name: 'example-cloud', revoke: {} }).error, /reason/)
  const revoked = applyPartnerUpdate(before, { name: 'example-cloud', revoke: { reason: 'The key leaked.' } })
  assert.equal(revoked.class, 'self_service')
  assert.equal(revoked.partner.revoked, true)
})

test('a vendor plugin is drafted for a vendor partner only', () => {
  const listing = { id: 'com.example.log', name: { en: 'Log Shipper' }, partner: 'example-cloud', releases_url: 'https://example.com/releases.json', categories: ['logs'], license: 'Proprietary' }
  const vendor = { name: 'example-cloud', kind: 'vendor', display_name: 'Example Cloud', public_key: key }
  const { entry } = draftVendorEntry(listing, { blocked: { plugins: [] }, partner: vendor })
  assert.deepEqual(entry.distribution, { type: 'vendor', releases_url: 'https://example.com/releases.json' })
  assert.equal(entry.trust, 'verified')
  assert.equal(entry.author, 'Example Cloud')
  assert.match(draftVendorEntry(listing, { blocked: { plugins: [] }, partner: { ...vendor, kind: 'github_organization' } }).rejection, /vendor partner/)
  assert.match(draftVendorEntry({ ...listing, id: 'io.github.x.y' }, { blocked: { plugins: [] }, partner: vendor }).rejection, /reverse domain/)
})
