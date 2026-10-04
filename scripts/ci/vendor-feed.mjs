// Releases of a plugin its vendor distributes (spec 8 of the developer
// portal): no GitHub repository, a release feed the vendor publishes instead.
// Packages stay on the vendor's hosting. The catalog verifies a new package
// once, as it does a GitHub one, and pins its digest; a pinned release whose
// digest the feed changes stops the build.
//
// Feed, JSON at distribution.releases_url (https):
//   { "releases": [ { "version": "1.2.0", "released_at": "...", "channel": "stable",
//       "min_nginx_ui_version": "2.8.0", "release_notes_url": "https://...",
//       "downloads": { "linux-amd64": { "url": "https://...", "sha256": "..." }, "any": { ... } } } ] }

import { createHash } from 'node:crypto'
import { platformsFromManifest, trimManifestSnapshot } from './manifest-snapshot.mjs'
import { isSemver } from './semver.mjs'
import { verifyRelease } from './verify-release.mjs'

const SHA256 = /^[0-9a-f]{64}$/
const PLATFORM = /^(?:any|[a-z0-9]+-[a-z0-9]+)$/

/** The releases of a feed that can be read, with why the others cannot. */
export function parseFeed(feed) {
  const releases = []
  const problems = []
  for (const item of Array.isArray(feed?.releases) ? feed.releases : []) {
    const version = String(item?.version ?? '')
    if (!isSemver(version)) {
      problems.push(`version ${JSON.stringify(item?.version)} is not semantic`)
      continue
    }
    const downloads = {}
    for (const [platform, download] of Object.entries(item.downloads ?? {})) {
      if (!PLATFORM.test(platform) || typeof download?.url !== 'string' || !download.url.startsWith('https://') || !SHA256.test(download.sha256 ?? '')) {
        problems.push(`${version} ${platform}: a download needs an https url and a sha256`)
        continue
      }
      downloads[platform] = { url: download.url, sha256: download.sha256 }
    }
    if (!Object.keys(downloads).length) {
      problems.push(`${version}: no package to download`)
      continue
    }
    releases.push({
      version,
      ...(typeof item.released_at === 'string' ? { released_at: item.released_at } : {}),
      ...(typeof item.min_nginx_ui_version === 'string' ? { min_nginx_ui_version: item.min_nginx_ui_version } : {}),
      ...(typeof item.release_notes_url === 'string' && item.release_notes_url.startsWith('https://') ? { release_notes_url: item.release_notes_url } : {}),
      ...(item.channel && item.channel !== 'stable' ? { channel: String(item.channel) } : {}),
      downloads,
    })
  }
  return { releases, problems }
}

/** The record a feed release becomes: one portable package or per platform downloads. */
export function recordOf(release) {
  const { downloads, ...rest } = release
  if (downloads.any && Object.keys(downloads).length === 1)
    return { ...rest, download_url: downloads.any.url, sha256: downloads.any.sha256 }
  const { any: _any, ...platforms } = downloads
  return { ...rest, downloads: platforms }
}

function fingerprint(entry, release) {
  return createHash('sha256').update(JSON.stringify([release, entry.trust, process.env.PLUGIN_SIGNING_PUBLIC_KEY ?? ''])).digest('hex')
}

/** The digests a feed serves that differ from a pinned release. */
function changedPins(pinned, record) {
  const out = []
  if (pinned.sha256 && record.sha256 && pinned.sha256 !== record.sha256)
    out.push(`portable: ${pinned.sha256} became ${record.sha256}`)
  for (const [platform, download] of Object.entries(pinned.downloads ?? {})) {
    const now = record.downloads?.[platform]
    if (now && now.sha256 !== download.sha256)
      out.push(`${platform}: ${download.sha256} became ${now.sha256}`)
  }
  return out
}

/** Releases of a vendor distributed entry, shaped like entryReleases gives them. */
export async function vendorReleases(entry, published, { failed, visited, fetchImpl = fetch, verify = verifyRelease }) {
  const failures = []
  const icons = new Map()
  const pinned = new Map((published?.releases ?? []).map(release => [release.version, release]))
  const url = entry.distribution?.releases_url
  let feed
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } })
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)
    feed = await response.json()
  }
  catch (err) {
    console.warn(`::warning title=${entry.id}::cannot read the release feed ${url}, keeping the published releases: ${err.message}`)
    return { releases: [...pinned.values()], provides: published?.provides, failures, repo: null, tags: new Map(), icons }
  }
  const { releases: offered, problems } = parseFeed(feed)
  for (const problem of problems)
    console.warn(`::warning title=${entry.id}::release feed: ${problem}`)

  const releases = []
  for (const release of offered) {
    const record = recordOf(release)
    const listed = pinned.get(release.version)
    if (listed) {
      const changes = changedPins(listed, record)
      if (changes.length) {
        failures.push(`${entry.id} ${release.version}: the release feed serves other packages than the catalog pins:\n  ${changes.join('\n  ')}`)
        continue
      }
      releases.push({ ...listed, ...(record.release_notes_url ? { release_notes_url: record.release_notes_url } : {}) })
      continue
    }
    const key = `${entry.id}@${release.version}`
    visited.add(key)
    const print = fingerprint(entry, release)
    if (failed[key] === print)
      continue
    const verified = await verify(entry, record)
    if (!verified.ok || !verified.manifest || verified.manifest.id !== entry.id || (verified.manifest.version && verified.manifest.version !== release.version)) {
      failed[key] = print
      console.warn(`::warning title=${entry.id}::${release.version} is left out, its packages do not verify or name another plugin or version`)
      continue
    }
    delete failed[key]
    const manifest = verified.manifest
    releases.push({
      ...record,
      api_version: manifest.api_version,
      ...(manifest.min_nginx_ui_version && !record.min_nginx_ui_version ? { min_nginx_ui_version: manifest.min_nginx_ui_version } : {}),
      platforms: platformsFromManifest(manifest),
      ...(verified.signer ? { signer: verified.signer } : {}),
      manifest: trimManifestSnapshot(manifest),
    })
    if (verified.icon)
      icons.set(release.version, verified.icon)
  }
  return { releases, provides: published?.provides, failures, repo: null, tags: new Map(), icons }
}
