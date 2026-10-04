// Reads the store document an entry points to with its store field (spec 7.1
// of the developer portal): plugin.store.json in the plugin repository at its
// default branch or at the listed release, or store/<id>/store.json in this
// repository. scripts/ci/listing.mjs lays the document over the manifest of
// the listed release; fields the entry sets still win.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Uploaded screenshots, named by their digest.
export const MEDIA_URL = (process.env.MEDIA_URL || 'https://plugin-media.nginxui.com').replace(/\/+$/, '')

function raw(owner, repo, ref, file) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${file.split('/').map(encodeURIComponent).join('/')}`
}

async function getJson(url, token) {
  const response = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'nginxui-plugins-catalog', ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  if (!response.ok)
    throw new Error(`${url} answers HTTP ${response.status}`)
  return response.json()
}

/** Where an image of a document is served. */
export function imageResolver({ owner, repo, ref }) {
  return (file) => {
    if (file.startsWith('media:'))
      return `${MEDIA_URL}/${file.slice(6)}.webp`
    return owner && ref ? raw(owner, repo, ref, file) : null
  }
}

/**
 * The store document of an entry, or null when it keeps none. repo is
 * { owner, repo } of its repository, tag the tag of the listed release, root
 * this repository's checkout and commit the commit being built. Returns
 * { doc, ref, image, readmeUrl } or { error } when the source cannot be read.
 */
export async function readStoreSource(entry, { repo, tag, token, root = process.cwd(), commit = process.env.GITHUB_SHA, catalogRepo = process.env.GITHUB_REPOSITORY || 'nginxui/plugins' }) {
  const store = entry.store
  if (!store)
    return null
  try {
    if (store.source === 'catalog') {
      const dir = path.join(root, 'store', entry.id)
      const file = path.join(dir, 'store.json')
      if (!existsSync(file))
        return { error: `store/${entry.id}/store.json does not exist` }
      const doc = JSON.parse(readFileSync(file, 'utf8'))
      const [owner, name] = catalogRepo.split('/')
      const readmeUrl = existsSync(path.join(dir, 'README.md')) && commit ? raw(owner, name, commit, `store/${entry.id}/README.md`) : null
      return { doc, ref: commit ?? 'main', image: imageResolver({}), readmeUrl }
    }
    if (!repo)
      return { error: 'the entry has no GitHub repository to read plugin.store.json from' }
    let ref = tag
    if (store.follow === 'branch') {
      const info = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, token)
      const head = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(info.default_branch)}`, token)
      ref = head.sha
    }
    if (!ref)
      return { error: 'no listed release to read plugin.store.json at' }
    const response = await fetch(raw(repo.owner, repo.repo, ref, 'plugin.store.json'))
    if (!response.ok)
      return { error: `plugin.store.json at ${ref} answers HTTP ${response.status}` }
    const doc = await response.json()
    return { doc, ref, image: imageResolver({ ...repo, ref }), readmeUrl: raw(repo.owner, repo.repo, ref, 'README.md') }
  }
  catch (err) {
    return { error: err.message }
  }
}

/** A manifest with the texts and screenshots of a store document over it. */
export function withStore(manifest, doc) {
  const out = structuredClone(manifest ?? {})
  out.i18n = structuredClone(out.i18n ?? {})
  for (const key of ['name', 'description']) {
    if (!doc?.[key])
      continue
    out[key] = doc[key].en ?? out[key]
    for (const text of Object.values(out.i18n))
      delete text[key]
    for (const [locale, value] of Object.entries(doc[key])) {
      if (locale !== 'en')
        (out.i18n[locale] ??= {})[key] = value
    }
  }
  if (doc?.homepage_url)
    out.homepage_url = doc.homepage_url
  if (doc?.screenshots) {
    out.screenshots = doc.screenshots.map(shot => ({ id: shot.id, path: shot.path, ...(shot.dark_path ? { dark_path: shot.dark_path } : {}), ...(shot.caption?.en ? { caption: shot.caption.en } : {}) }))
    for (const text of Object.values(out.i18n))
      delete text.screenshot_captions
    for (const shot of doc.screenshots) {
      for (const [locale, caption] of Object.entries(shot.caption ?? {})) {
        if (locale !== 'en')
          ((out.i18n[locale] ??= {}).screenshot_captions ??= {})[shot.id] = caption
      }
    }
  }
  return out
}
