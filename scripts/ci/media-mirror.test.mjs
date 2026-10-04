import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mirrorConfig, mirrorScreenshots, signedHeaders } from './media-mirror.mjs'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const config = { account: 'acct', key: 'AKID', secret: 'secret', bucket: 'plugin-media' }

test('mirroring needs R2 credentials', () => {
  assert.equal(mirrorConfig({}), null)
  assert.deepEqual(mirrorConfig({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }), { account: 'a', key: 'k', secret: 's', bucket: 'plugin-media' })
})

test('requests to R2 are signed with SigV4', () => {
  const { url, headers } = signedHeaders(config, 'PUT', 'abc.png', Buffer.from('x'), 'image/png', new Date('2026-10-05T00:00:00Z'))
  assert.equal(url, 'https://acct.r2.cloudflarestorage.com/plugin-media/abc.png')
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20261005\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
})

test('screenshots are stored once by digest and listed from the mirror', async () => {
  const puts = []
  globalThis.fetch = async (url, init = {}) => {
    if (url === 'https://raw.example/a.png')
      return new Response(Buffer.from('png'), { headers: { 'content-type': 'image/png' } })
    if (url === 'https://raw.example/b.svg')
      return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
    if (init.method === 'HEAD')
      return new Response(null, { status: 404 })
    if (init.method === 'PUT') {
      puts.push(url)
      return new Response(null, { status: 200 })
    }
    return new Response(null, { status: 404 })
  }
  const seen = new Map()
  const { screenshots, warnings } = await mirrorScreenshots(config, [{ url: 'https://raw.example/a.png', dark_url: 'https://raw.example/a.png', caption: { en: 'A' } }, { url: 'https://raw.example/b.svg' }], seen)
  assert.match(screenshots[0].url, /^https:\/\/plugin-media\.nginxui\.com\/[0-9a-f]{64}\.png$/)
  assert.equal(screenshots[0].dark_url, screenshots[0].url)
  assert.equal(puts.length, 1)
  assert.equal(screenshots[1].url, 'https://raw.example/b.svg')
  assert.match(warnings[0], /not PNG, JPEG or WebP/)
})
