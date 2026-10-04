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
// service operations (scripts/submission/operations.mjs) to the entry on main.
//
// Outputs: result (ok or rejected), message, id, path, drafts, entry, class,
// fields (the classified changes as JSON), eligibility, submitter,
// submitter_id, and tag and release_url of the release drafted from.

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { classify } from '../ci/classify.mjs'
import { draftEntry, knownCategories } from './core.mjs'
import { applyOperations } from './operations.mjs'

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
  const submitter = payload?.submitter
  if (!submitter || typeof submitter.login !== 'string' || !LOGIN.test(submitter.login) || !Number.isSafeInteger(submitter.id))
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
  if (parsed.update)
    return updateEntry(parsed)
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
