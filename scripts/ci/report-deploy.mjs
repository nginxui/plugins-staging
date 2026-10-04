#!/usr/bin/env node
// Tells the developer portal what a deploy published, so changes merged into
// the catalog move to "live" there: the commit, the entry of every plugin in
// the sources and the plugins the published index lists. The request carries
// an OIDC token of the run, which the portal checks against GitHub's keys,
// this repository and this workflow, so no shared secret is needed.
//
// Usage: node scripts/ci/report-deploy.mjs
// Env: PORTAL_URL (default https://portal.nginxui.com), GITHUB_SHA, and the
// ACTIONS_ID_TOKEN_REQUEST_* variables a job with id-token: write gets.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/** The report of a deploy from the entry files, the published index and the
 * names waiting for review, which the portal turns into reviewed changes. */
export function buildReport({ commit, entriesDir = 'plugins', indexFile = 'dist/v1/index.json', pendingFile = 'pending-names.json' }) {
  const entries = {}
  for (const file of readdirSync(entriesDir).filter(name => name.endsWith('.json'))) {
    const entry = JSON.parse(readFileSync(path.join(entriesDir, file), 'utf8'))
    entries[entry.id] = entry
  }
  // A plugin is listed once a release of it verified, not when its entry exists.
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { plugins: [] }
  const listed = index.plugins.filter(plugin => plugin.releases?.length).map(plugin => plugin.id).sort()
  const pending = existsSync(pendingFile)
    ? (JSON.parse(readFileSync(pendingFile, 'utf8')).plugins ?? []).filter(p => Object.keys(p.names ?? {}).length).map(p => ({ id: p.id, version: p.version, names: p.names }))
    : []
  return { commit, entries, listed, pending }
}

async function idToken(audience) {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !token)
    throw new Error('no OIDC token in this job, it needs permissions id-token: write')
  const response = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok)
    throw new Error(`OIDC token request: ${response.status}`)
  return (await response.json()).value
}

async function main() {
  const portal = (process.env.PORTAL_URL || 'https://portal.nginxui.com').replace(/\/+$/, '')
  const report = buildReport({ commit: process.env.GITHUB_SHA })
  const response = await fetch(`${portal}/api/hooks/deploy`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${await idToken(new URL(portal).host)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  })
  const text = await response.text()
  if (!response.ok)
    throw new Error(`the portal answered ${response.status}: ${text}`)
  console.log(`reported ${report.commit} with ${Object.keys(report.entries).length} entries: ${text}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
