// Mirrors the screenshots a listing shows into the R2 bucket behind
// plugin-media.nginxui.com (spec 7.3 of the developer portal), so hosts load
// them from one fast address instead of raw.githubusercontent.com, and the
// bytes a listing shows stay pinned. Objects are named by their digest and
// never change. Without R2 credentials the build lists the source URLs.
//
// Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// (default plugin-media), MEDIA_URL (default https://plugin-media.nginxui.com).

import { createHash, createHmac } from 'node:crypto'
import { MEDIA_URL } from './store-source.mjs'

const MAX_BYTES = 2 * 1024 * 1024
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function mirrorConfig(env = process.env) {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)
    return null
  return { account: env.R2_ACCOUNT_ID, key: env.R2_ACCESS_KEY_ID, secret: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET || 'plugin-media' }
}

const sha256 = data => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

/** Headers of an AWS Signature Version 4 request to R2's S3 API. */
export function signedHeaders(config, method, key, body, contentType, now = new Date()) {
  const host = `${config.account}.r2.cloudflarestorage.com`
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const payload = sha256(body ?? '')
  const headers = { 'host': host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate, ...(contentType ? { 'content-type': contentType } : {}) }
  const names = Object.keys(headers).sort()
  const canonical = [method, `/${config.bucket}/${key}`, '', ...names.map(n => `${n}:${headers[n]}`), '', names.join(';'), payload].join('\n')
  const scope = `${day}/auto/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secret}`, day), 'auto'), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
  return {
    url: `https://${host}/${config.bucket}/${key}`,
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${config.key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
  }
}

/** The mirrored URL of an image, putting it into R2 when it is missing. */
export async function mirrorImage(config, url, seen = new Map()) {
  if (url.startsWith(`${MEDIA_URL}/`))
    return { url }
  if (seen.has(url))
    return seen.get(url)
  const response = await fetch(url)
  if (!response.ok)
    return { url, error: `${url} answers HTTP ${response.status}` }
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim()
  const ext = TYPES[type]
  if (!ext)
    return { url, error: `${url} is ${type || 'of no type'}, not PNG, JPEG or WebP` }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_BYTES)
    return { url, error: `${url} is ${bytes.length} bytes, more than ${MAX_BYTES}` }
  const key = `${sha256(bytes)}.${ext}`
  const head = signedHeaders(config, 'HEAD', key)
  const exists = await fetch(head.url, { method: 'HEAD', headers: head.headers })
  if (exists.status === 404) {
    const put = signedHeaders(config, 'PUT', key, bytes, type)
    const stored = await fetch(put.url, { method: 'PUT', headers: { ...put.headers, 'cache-control': 'public, max-age=31536000, immutable' }, body: bytes })
    if (!stored.ok)
      return { url, error: `storing ${key} answered HTTP ${stored.status}` }
  }
  else if (!exists.ok) {
    return { url, error: `checking ${key} answered HTTP ${exists.status}` }
  }
  const result = { url: `${MEDIA_URL}/${key}` }
  seen.set(url, result)
  return result
}

/** The screenshots of a listing with mirrored URLs, and what failed. */
export async function mirrorScreenshots(config, screenshots, seen) {
  const warnings = []
  const out = []
  for (const shot of screenshots ?? []) {
    const light = await mirrorImage(config, shot.url, seen)
    const dark = shot.dark_url ? await mirrorImage(config, shot.dark_url, seen) : null
    for (const failed of [light, dark].filter(r => r?.error))
      warnings.push(failed.error)
    out.push({ ...shot, url: light.url, ...(dark ? { dark_url: dark.url } : {}) })
  }
  return { screenshots: out, warnings }
}
