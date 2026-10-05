// Reads the store document of an entry (spec 7.1 of the developer portal):
// plugin.store.json in the plugin repository at the listed release, or, when
// the store field says so, at its default branch, or store/<id>/store.json in
// this repository. Without a store field a repository that has no
// plugin.store.json at the release keeps the manifest alone. scripts/ci/listing.mjs lays the document over the manifest of
// the listed release; fields the entry sets still win.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAgainstSchemaFile } from '../lib/schema-validator.mjs'

const STORE_SCHEMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'store.schema.json')

/** Why a crop region cannot be shown, empty when it can: it has to stay inside its image. */
export function cropProblem(crop) {
  if (!crop)
    return ''
  if (crop.x + crop.width > 1.0001 || crop.y + crop.height > 1.0001)
    return 'the crop reaches past the image'
  return ''
}

/**
 * A store document checked against schema/store.schema.json: a field with a
 * problem is left out, so the listing keeps what the manifest gives for it.
 * Returns { doc, warnings }, or { error } when it is not a document at all.
 */
export function cleanStoreDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    return { error: 'the store document is not a JSON object' }
  const problems = validateAgainstSchemaFile(STORE_SCHEMA, doc)
  const bad = new Set()
  const warnings = []
  for (const problem of problems) {
    const text = typeof problem === 'string' ? problem : JSON.stringify(problem)
    const unexpected = /^\/: unexpected property "([^"]+)"/.exec(text)
    const field = unexpected?.[1] ?? /^\/([^/[:]+)/.exec(text)?.[1]
    if (field)
      bad.add(field)
    warnings.push(`the store document is left out in part: ${text}`)
  }
  const kept = Object.fromEntries(Object.entries(doc).filter(([key]) => !bad.has(key) && key !== '$schema'))
  // A crop past its image leaves the screenshot whole.
  for (const shot of kept.screenshots ?? []) {
    for (const key of ['crop', 'dark_crop']) {
      const problem = cropProblem(shot[key])
      if (problem) {
        delete shot[key]
        warnings.push(`screenshots.${shot.id}.${key} is left out: ${problem}`)
      }
    }
  }
  return { doc: kept, warnings }
}

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
  try {
    // By default the document travels with the release, like the manifest.
    if (!store) {
      if (!repo || !tag)
        return null
      const response = await fetch(raw(repo.owner, repo.repo, tag, 'plugin.store.json'))
      if (response.status === 404)
        return null
      if (!response.ok)
        return { error: `plugin.store.json at ${tag} answers HTTP ${response.status}` }
      const checked = cleanStoreDoc(await response.json())
      if (checked.error)
        return checked
      return { doc: checked.doc, warnings: checked.warnings, ref: tag, image: imageResolver({ ...repo, ref: tag }), readmeUrl: raw(repo.owner, repo.repo, tag, 'README.md') }
    }
    if (store.source === 'catalog') {
      const dir = path.join(root, 'store', entry.id)
      const file = path.join(dir, 'store.json')
      if (!existsSync(file))
        return { error: `store/${entry.id}/store.json does not exist` }
      const checked = cleanStoreDoc(JSON.parse(readFileSync(file, 'utf8')))
      if (checked.error)
        return checked
      const [owner, name] = catalogRepo.split('/')
      const readmeUrl = existsSync(path.join(dir, 'README.md')) && commit ? raw(owner, name, commit, `store/${entry.id}/README.md`) : null
      return { doc: checked.doc, warnings: checked.warnings, ref: commit ?? 'main', image: imageResolver({}), readmeUrl }
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
    const checked = cleanStoreDoc(await response.json())
    if (checked.error)
      return checked
    return { doc: checked.doc, warnings: checked.warnings, ref, image: imageResolver({ ...repo, ref }), readmeUrl: raw(repo.owner, repo.repo, ref, 'README.md') }
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
    out.screenshots = doc.screenshots.map(shot => ({
      id: shot.id,
      path: shot.path,
      ...(shot.crop ? { crop: shot.crop } : {}),
      ...(shot.dark_path ? { dark_path: shot.dark_path } : {}),
      ...(shot.dark_path && shot.dark_crop ? { dark_crop: shot.dark_crop } : {}),
      ...(shot.caption?.en ? { caption: shot.caption.en } : {}),
    }))
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
