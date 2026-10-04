#!/usr/bin/env node
// The developer portal front end of a submission: reads the change the portal
// dispatched .github/workflows/apply.yml with, drafts its entry with
// scripts/submission/core.mjs, classifies it with scripts/ci/classify.mjs and
// writes the outcome to $GITHUB_OUTPUT.
//
// The payload comes from the portal, which may be compromised, so it is
// checked here and nothing in it is trusted beyond what a reviewer sees: a
// new listing is always a pull request a maintainer merges.
//
// Usage: PAYLOAD='{...}' node scripts/submission/portal.mjs
//
// A new listing is drafted from the repository; an entry_update applies self
// service operations (scripts/submission/operations.mjs) to the entry on main;
// a store_update writes the store document of a catalog hosted plugin
// (scripts/submission/store.mjs).
//
// Outputs: result (ok or rejected), message, id, path, drafts, entry, class,
// fields (the classified changes as JSON), eligibility, submitter,
// submitter_id, and tag and release_url of the release drafted from.

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { classify } from '../ci/classify.mjs'
import { draftEntry, knownCategories } from './core.mjs'
import { applyOperations } from './operations.mjs'
import { loadBlocked } from './core.mjs'
import { applyMaintainerUpdate } from './maintainer.mjs'
import { applyPartnerUpdate, draftVendorEntry, readPartner } from './partner.mjs'
import { applyStoreUpdate } from './store.mjs'

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i
const PLUGIN_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/

/** The submission a portal payload describes, or { error }. */
export function submissionFromPayload(text) {
  let payload
  try {
    payload = JSON.parse(text)
  }
  catch {
    return { error: 'The payload is not JSON.' }
  }
  // Names a deploy found come from the catalog itself, with no submitter.
  const system = payload?.system === true && payload?.kind === 'entry_update' && Object.keys(payload.operations ?? {}).join() === 'names'
  const submitter = system ? { login: '', id: 0 } : payload?.submitter
  if (!system && (!submitter || typeof submitter.login !== 'string' || !LOGIN.test(submitter.login) || !Number.isSafeInteger(submitter.id)))
    return { error: 'The submitter is not a GitHub account.' }
  if (payload.kind === 'entry_update') {
    if (typeof payload.plugin_id !== 'string' || !PLUGIN_ID.test(payload.plugin_id))
      return { error: 'The plugin id is not valid.' }
    return {
      update: {
        pluginId: payload.plugin_id,
        operations: payload.operations,
        reason: typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 500) : '',
      },
      submitter: { login: submitter.login, id: submitter.id },
      eligibility: typeof payload.eligibility === 'string' ? payload.eligibility.slice(0, 300) : '',
    }
  }
  if (payload.kind === 'store_update') {
    if (typeof payload.plugin_id !== 'string' || !PLUGIN_ID.test(payload.plugin_id))
      return { error: 'The plugin id is not valid.' }
    if (!payload.doc || typeof payload.doc !== 'object' || Array.isArray(payload.doc))
      return { error: 'The store document is not an object.' }
    return {
      store: {
        pluginId: payload.plugin_id,
        doc: payload.doc,
        readme: typeof payload.readme === 'string' ? payload.readme : null,
        setSource: payload.set_source ?? null,
      },
      submitter: { login: submitter.login, id: submitter.id },
      eligibility: typeof payload.eligibility === 'string' ? payload.eligibility.slice(0, 300) : '',
    }
  }
  if (payload.kind === 'partner_update') {
    return {
      partner: payload.partner ?? {},
      submitter: { login: submitter.login, id: submitter.id },
      eligibility: typeof payload.eligibility === 'string' ? payload.eligibility.slice(0, 300) : '',
    }
  }
  // The author withdrew the change; its pull request is closed.
  if (payload.kind === 'close') {
    if (!Number.isSafeInteger(payload.pr_number) || payload.pr_number <= 0)
      return { error: 'The pull request number is not valid.' }
    return { close: payload.pr_number, submitter: { login: submitter.login, id: submitter.id } }
  }
  if (payload.kind === 'maintainer_update') {
    if (typeof payload.plugin_id !== 'string' || !PLUGIN_ID.test(payload.plugin_id))
      return { error: 'The plugin id is not valid.' }
    return {
      maintainer: payload,
      submitter: { login: submitter.login, id: submitter.id },
      eligibility: typeof payload.eligibility === 'string' ? payload.eligibility.slice(0, 300) : '',
    }
  }
  if (payload.kind === 'vendor_listing') {
    return {
      vendor: payload.listing ?? {},
      submitter: { login: submitter.login, id: submitter.id },
      eligibility: typeof payload.eligibility === 'string' ? payload.eligibility.slice(0, 300) : '',
    }
  }
  if (payload?.kind !== 'new_listing')
    return { error: `Unknown change kind ${JSON.stringify(payload?.kind)}.` }
  const { repository_url: url, author_public_key: key, categories, eligibility } = payload
  if (typeof url !== 'string' || typeof key !== 'string')
    return { error: 'The repository URL and the primary public key are required.' }
  if (categories !== undefined && (!Array.isArray(categories) || !categories.every(item => typeof item === 'string')))
    return { error: 'The categories are not a list of ids.' }
  return {
    submission: {
      repository_url: url,
      author_public_key: key,
      categories: categories ?? [],
      submitter: { login: submitter.login, id: submitter.id },
    },
    submitter: { login: submitter.login, id: submitter.id },
    eligibility: typeof eligibility === 'string' ? eligibility.slice(0, 300) : '',
  }
}

/** Applies a self service update to the entry on main and sets the outputs. */
function updateEntry(parsed) {
  const file = `plugins/${parsed.update.pluginId}.json`
  const before = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const result = applyOperations(before, parsed.update.operations, knownCategories())
  if (result.error) {
    setOutput('result', 'rejected')
    setOutput('message', result.error)
    return
  }
  const classified = classify(before, result.entry)
  if (!classified.class) {
    setOutput('result', 'rejected')
    setOutput('message', 'The entry already is as asked.')
    return
  }
  const content = `${JSON.stringify(result.entry, null, 2)}\n`
  console.log(`updated ${file}: ${result.summary}, ${classified.class}`)
  setOutput('result', 'ok')
  setOutput('message', `Updated \`${file}\`: ${result.summary}.`)
  setOutput('id', result.entry.id)
  setOutput('path', file)
  setOutput('entry', content)
  setOutput('drafts', JSON.stringify({ [file]: content }))
  setOutput('class', classified.class)
  setOutput('fields', JSON.stringify(classified.fields))
  setOutput('summary', result.summary)
  setOutput('reason', parsed.update.reason)
  setOutput('eligibility', parsed.eligibility)
  setOutput('submitter', parsed.submitter.login)
  setOutput('submitter_id', String(parsed.submitter.id))
}

/** Writes a store document of a catalog hosted plugin and sets the outputs. */
function updateStore(parsed) {
  const id = parsed.store.pluginId
  const file = `plugins/${id}.json`
  const entry = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const docFile = `store/${id}/store.json`
  const before = existsSync(docFile) ? JSON.parse(readFileSync(docFile, 'utf8')) : null
  const result = applyStoreUpdate(entry, before, parsed.store)
  if (result.error) {
    setOutput('result', 'rejected')
    setOutput('message', result.error)
    return
  }
  console.log(`store of ${id}: ${result.summary}, ${result.class}`)
  setOutput('result', 'ok')
  setOutput('message', `Updated the store document of \`${id}\`: ${result.summary}.`)
  setOutput('id', id)
  setOutput('path', file)
  setOutput('entry', `${JSON.stringify(result.entry, null, 2)}\n`)
  setOutput('drafts', JSON.stringify(result.files))
  setOutput('class', result.class)
  setOutput('fields', JSON.stringify(result.fields))
  setOutput('summary', result.summary)
  setOutput('reason', '')
  setOutput('eligibility', parsed.eligibility)
  setOutput('submitter', parsed.submitter.login)
  setOutput('submitter_id', String(parsed.submitter.id))
}

/** Writes a partner file and sets the outputs; the checks of entries do not apply. */
function updatePartner(parsed) {
  const result = applyPartnerUpdate(readPartner(parsed.partner.name ?? ''), parsed.partner)
  if (result.error) {
    setOutput('result', 'rejected')
    setOutput('message', result.error)
    return
  }
  console.log(`partner: ${result.summary}, ${result.class}`)
  setOutput('result', 'ok')
  setOutput('message', `${result.summary[0].toUpperCase()}${result.summary.slice(1)}.`)
  setOutput('id', parsed.partner.name)
  setOutput('path', '')
  setOutput('entry', '')
  setOutput('drafts', JSON.stringify(result.files))
  setOutput('class', result.class)
  setOutput('fields', JSON.stringify(result.fields))
  setOutput('summary', result.summary)
  setOutput('reason', parsed.partner.revoke?.reason ?? '')
  setOutput('eligibility', parsed.eligibility)
  setOutput('submitter', parsed.submitter.login)
  setOutput('submitter_id', String(parsed.submitter.id))
}

/** Applies a maintainer action and sets the outputs; always a pull request. */
function maintainerUpdate(parsed) {
  const id = parsed.maintainer.plugin_id
  const file = `plugins/${id}.json`
  const entry = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const result = applyMaintainerUpdate(entry, loadBlocked(), { ...parsed.maintainer, by: parsed.submitter.login })
  if (result.error) {
    setOutput('result', 'rejected')
    setOutput('message', result.error)
    return
  }
  const kept = typeof result.files[file] === 'string'
  setOutput('result', 'ok')
  setOutput('message', `${result.summary[0].toUpperCase()}${result.summary.slice(1)}.`)
  setOutput('id', id)
  // Only an entry that stays is checked again.
  setOutput('path', kept ? file : '')
  setOutput('entry', kept ? result.files[file] : '')
  setOutput('drafts', JSON.stringify(result.files))
  setOutput('class', 'maintainer')
  setOutput('fields', JSON.stringify(result.fields))
  setOutput('summary', result.summary)
  setOutput('reason', String(parsed.maintainer.delist?.reason ?? parsed.maintainer.block?.reason ?? ''))
  setOutput('eligibility', parsed.eligibility)
  setOutput('submitter', parsed.submitter.login)
  setOutput('submitter_id', String(parsed.submitter.id))
}

/** Drafts the entry of a vendor distributed plugin and sets the outputs. */
function listVendorPlugin(parsed) {
  const draft = draftVendorEntry(parsed.vendor)
  if (draft.rejection) {
    setOutput('result', 'rejected')
    setOutput('message', draft.rejection)
    return
  }
  const file = `plugins/${draft.entry.id}.json`
  const before = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  if (before) {
    setOutput('result', 'rejected')
    setOutput('message', `${draft.entry.id} is listed already.`)
    return
  }
  const content = `${JSON.stringify(draft.entry, null, 2)}\n`
  const classified = classify(null, draft.entry)
  setOutput('result', 'ok')
  setOutput('message', `Drafted \`${file}\` for the vendor feed ${draft.entry.distribution.releases_url}.`)
  setOutput('id', draft.entry.id)
  setOutput('path', file)
  setOutput('entry', content)
  setOutput('drafts', JSON.stringify({ [file]: content }))
  setOutput('class', classified.class)
  setOutput('fields', JSON.stringify(classified.fields))
  setOutput('eligibility', parsed.eligibility)
  setOutput('submitter', parsed.submitter.login)
  setOutput('submitter_id', String(parsed.submitter.id))
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT
  if (!file)
    return
  const delimiter = `EOF_${randomBytes(8).toString('hex')}`
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
}

async function main() {
  const parsed = submissionFromPayload(process.env.PAYLOAD ?? '')
  if (parsed.error) {
    setOutput('result', 'rejected')
    setOutput('message', parsed.error)
    return
  }
  if (parsed.close) {
    setOutput('result', 'close')
    setOutput('pr_number', String(parsed.close))
    setOutput('submitter', parsed.submitter.login)
    return
  }
  if (parsed.update)
    return updateEntry(parsed)
  if (parsed.store)
    return updateStore(parsed)
  if (parsed.partner)
    return updatePartner(parsed)
  if (parsed.vendor)
    return listVendorPlugin(parsed)
  if (parsed.maintainer)
    return maintainerUpdate(parsed)
  const draft = await draftEntry(parsed.submission, { token: process.env.GITHUB_TOKEN })
  if (draft.rejection) {
    console.log(`rejected: ${draft.rejection}`)
    setOutput('result', 'rejected')
    setOutput('message', draft.rejection)
    return
  }
  const { entry, repository, tag } = draft
  const file = `plugins/${entry.id}.json`
  const before = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const classified = classify(before, entry)
  const content = `${JSON.stringify(entry, null, 2)}\n`
  console.log(`drafted ${file} from ${repository.full_name}@${tag}, ${classified.class}`)
  setOutput('result', 'ok')
  setOutput('message', `Drafted \`${file}\` from ${repository.full_name}@${tag}.`)
  setOutput('id', entry.id)
  setOutput('path', file)
  setOutput('entry', content)
  setOutput('drafts', JSON.stringify({ [file]: content }))
  setOutput('class', classified.class ?? '')
  setOutput('fields', JSON.stringify(classified.fields))
  setOutput('eligibility', parsed.eligibility)
  setOutput('submitter', parsed.submission.submitter.login)
  setOutput('submitter_id', String(parsed.submission.submitter.id))
  setOutput('tag', tag)
  setOutput('release_url', `https://github.com/${repository.full_name}/releases/tag/${encodeURIComponent(tag)}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.stack || err.message || err)
    process.exit(1)
  })
}
