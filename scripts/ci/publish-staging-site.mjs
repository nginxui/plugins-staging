#!/usr/bin/env node
// Sends the catalog files of the test catalog to the developer portal staging
// site, which serves them at plugins-staging.nginxui.com: the test catalog has
// no Pages site of its own. Authenticated like report-deploy.mjs, with the
// OIDC token of the run.
//
// Usage: node scripts/ci/publish-staging-site.mjs [dist]
// Env: PORTAL_URL and the ACTIONS_ID_TOKEN_REQUEST_* variables.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/** The files under dist/v1 the site serves, by published path, in base64. */
export function siteFiles(dist) {
  const files = {}
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory())
        walk(full)
      else
        files[path.relative(dist, full).split(path.sep).join('/')] = readFileSync(full).toString('base64')
    }
  }
  walk(path.join(dist, 'v1'))
  return files
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
  const portal = (process.env.PORTAL_URL || 'https://portal-staging.nginxui.com').replace(/\/+$/, '')
  const files = siteFiles(process.argv[2] || 'dist')
  const response = await fetch(`${portal}/api/hooks/site`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${await idToken(new URL(portal).host)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  const text = await response.text()
  if (!response.ok)
    throw new Error(`the portal answered ${response.status}: ${text}`)
  console.log(`published ${Object.keys(files).length} file(s): ${text}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.stack || err.message || err)
    process.exit(1)
  })
}
