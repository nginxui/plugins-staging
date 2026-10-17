// Store documents the developer portal sends for plugins whose store source
// is the catalog (spec 7.1): store/<id>/store.json and store/<id>/README.md.
// A change to a name waits for a maintainer, everything else is committed
// directly once the checks pass. A move of the entry's store field to the
// catalog travels with the first document and is always reviewed.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify } from '../ci/classify.mjs'
import { descriptionProblem, reservedWord } from '../ci/names.mjs'
import { validateAgainstSchemaFile } from '../lib/schema-validator.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const STORE_SCHEMA = path.join(ROOT, 'schema', 'store.schema.json')
const README_LIMIT = 64 * 1024

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
// Fields an update sets as a whole, and texts it sets one language at a time.
const WHOLE_FIELDS = new Set(['homepage_url', 'screenshots'])
const TEXT_FIELDS = new Set(['name', 'description', 'permission_reasons'])

/**
 * The document an update leads to. An update with fields or texts changes
 * only those on the document the catalog holds: fields as a whole, texts per
 * language (null takes one out), keyed "name", "description" or
 * "permission_reasons.<permission>". So two updates sent close together, or
 * one drafted on an older document, never undo each other. Without either
 * the update is the whole document.
 */
export function updatedDoc(before, update) {
  if (!Array.isArray(update.fields) && !update.texts)
    return update.doc
  const doc = structuredClone(before ?? {})
  for (const field of update.fields ?? []) {
    if (!WHOLE_FIELDS.has(field))
      continue
    if (update.doc?.[field] === undefined)
      delete doc[field]
    else
      doc[field] = update.doc[field]
  }
  for (const [key, values] of Object.entries(update.texts ?? {})) {
    const [field, permission] = key.split('.')
    if (!TEXT_FIELDS.has(field) || (field === 'permission_reasons') !== !!permission || !values || typeof values !== 'object')
      continue
    const holder = field === 'permission_reasons' ? (doc.permission_reasons ??= {}) : doc
    const name = field === 'permission_reasons' ? permission : field
    const texts = { ...(holder[name] ?? {}) }
    for (const [locale, value] of Object.entries(values)) {
      if (value === null)
        delete texts[locale]
      else if (typeof value === 'string')
        texts[locale] = value
    }
    if (Object.keys(texts).length)
      holder[name] = texts
    else
      delete holder[name]
  }
  if (doc.permission_reasons && !Object.keys(doc.permission_reasons).length)
    delete doc.permission_reasons
  return doc
}

/** The problems of a document, empty when it may be listed. */
export function storeProblems(doc) {
  const problems = validateAgainstSchemaFile(STORE_SCHEMA, doc).map(e => (typeof e === 'string' ? e : `${e.path ?? ''} ${e.message ?? JSON.stringify(e)}`.trim()))
  for (const [locale, name] of Object.entries(doc?.name ?? {})) {
    const word = reservedWord(name)
    if (word)
      problems.push(`name.${locale} holds ${word}`)
  }
  for (const [locale, text] of Object.entries(doc?.description ?? {})) {
    const problem = descriptionProblem(text)
    if (problem)
      problems.push(`description.${locale} holds ${problem}`)
  }
  for (const shot of doc?.screenshots ?? []) {
    for (const p of [shot.path, shot.dark_path]) {
      if (p && !p.startsWith('media:'))
        problems.push(`screenshots.${shot.id}: a catalog hosted image is an upload, not ${p}`)
    }
  }
  return problems
}

/**
 * Applies a store update. entry is plugins/<id>.json on main, before the
 * current store/<id>/store.json (null when absent), update { doc, readme,
 * setSource, fields, texts }. Returns { files, entry, class, fields, summary } or { error }.
 */
export function applyStoreUpdate(entry, before, input) {
  const update = { ...input, doc: updatedDoc(before, input) }
  if (!entry)
    return { error: 'The plugin is not listed.' }
  const moving = !!update.setSource
  if (moving && !same(update.setSource, { source: 'catalog' }))
    return { error: 'A store document in the catalog moves the store source to the catalog only.' }
  if (!moving && entry.store?.source !== 'catalog')
    return { error: 'The store source of this plugin is not the catalog.' }
  const problems = storeProblems(update.doc)
  if (problems.length)
    return { error: `The store document cannot be listed: ${problems.join('; ')}.` }

  const dir = `store/${entry.id}`
  const files = { [`${dir}/store.json`]: `${JSON.stringify(update.doc, null, 2)}\n` }
  if (typeof update.readme === 'string' && update.readme.trim())
    files[`${dir}/README.md`] = `${update.readme.slice(0, README_LIMIT).trimEnd()}\n`

  const after = moving ? { ...entry, store: { source: 'catalog' } } : entry
  const classified = classify(entry, after)
  const fields = [...classified.fields]
  const names = !same(before?.name, update.doc.name)
  for (const key of ['name', 'description', 'homepage_url', 'screenshots', 'permission_reasons']) {
    if (!same(before?.[key], update.doc[key]))
      fields.push({ field: `store.${key}`, change: before?.[key] === undefined ? 'added' : update.doc[key] === undefined ? 'removed' : 'changed', class: key === 'name' ? 'reviewed' : 'self_service' })
  }
  if (files[`${dir}/README.md`])
    fields.push({ field: 'store.readme', change: 'changed', class: 'self_service' })
  if (!fields.length)
    return { error: 'The store document already is as asked.' }
  const reviewed = moving || names
  if (moving)
    files[`plugins/${entry.id}.json`] = `${JSON.stringify(after, null, 2)}\n`
  return {
    files,
    entry: after,
    class: reviewed ? 'reviewed' : 'self_service',
    fields,
    summary: moving ? 'move the store texts to the catalog' : 'update the store texts',
  }
}
