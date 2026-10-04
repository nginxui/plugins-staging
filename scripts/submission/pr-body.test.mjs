// Run with: node --test scripts/submission/*.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cell, prBody, reviewItems, trimPreview } from './pr-body.mjs'

const entry = {
  id: 'io.github.hintay.hello',
  name: { en: 'Hello Templates', zh_CN: 'Hello 模板' },
  author: 'Hintay',
  repository_url: 'https://github.com/Hintay/nginx-ui-plugin-hello',
  categories: ['templates'],
  trust: 'community',
}
const base = {
  change: 'c_abcdefgh12345678',
  portalUrl: 'https://portal.example',
  entry,
  submitter: 'Hintay',
  eligibility: '@Hintay has admin permission on Hintay/nginx-ui-plugin-hello',
  preview: '#### io.github.hintay.hello\n\n| Field | Listed as |\n| --- | --- |\n| Name | Hello |',
  release: { tag: 'v0.1.0', url: 'https://github.com/Hintay/nginx-ui-plugin-hello/releases/tag/v0.1.0' },
}

test('a new listing names the plugin, the claim and what to review', () => {
  const body = prBody({ ...base, fields: [{ field: 'listing', change: 'added', class: 'reviewed' }] })
  assert.match(body, /^## New listing: Hello Templates$/m)
  assert.match(body, /\| Release \| \[v0\.1\.0\]\(https:\/\/github\.com\/Hintay\/nginx-ui-plugin-hello\/releases\/tag\/v0\.1\.0\) \|/)
  assert.match(body, /\| Submitted by \| @Hintay, who has admin permission on Hintay\/nginx-ui-plugin-hello \|/)
  assert.match(body, /\[Follow this change\]\(https:\/\/portal\.example\/changes\/c_abcdefgh12345678\)/)
  assert.equal((body.match(/- \[ \] /g) ?? []).length, 4)
  assert.match(body, /Merging lists the plugin/)
  // The submitter is mentioned once.
  assert.equal((body.match(/@Hintay/g) ?? []).length, 1)
})

test('the preview loses the heading that repeats the id', () => {
  assert.equal(trimPreview(base.preview).startsWith('| Field |'), true)
})

test('an update shows each field before and after and asks only what it touches', () => {
  const before = { ...entry, name: { en: 'Hello' } }
  const body = prBody({ ...base, before, fields: [{ field: 'name', change: 'changed', class: 'reviewed' }] })
  assert.match(body, /^## Update: Hello Templates$/m)
  assert.match(body, /\| `name` \| `\{"en":"Hello"\}` \| `\{"en":"Hello Templates","zh_CN":"Hello 模板"\}` \|/)
  assert.deepEqual(reviewItems('update', [{ field: 'name' }]), ['The names in every language describe the plugin and claim nothing official'])
  assert.match(body, /Merging updates the listing/)
})

test('a delisting asks whether the author wanted it', () => {
  const body = prBody({ ...base, entry: null, before: entry, fields: [{ field: 'listing', change: 'removed', class: 'reviewed' }] })
  assert.match(body, /^## Delisting: Hello Templates$/m)
  assert.match(body, /- \[ \] The author of the listing asked to remove it/)
  assert.doesNotMatch(body, /Listing preview/)
})

test('text from the author can neither mention, break a table nor open a tag', () => {
  assert.equal(cell('a|b\n@all <img>'), 'a\\|b @​all &lt;img>')
  const body = prBody({ ...base, entry: { ...entry, name: { en: '<script>@here' } }, fields: [{ field: 'listing', change: 'added' }] })
  // GitHub mentions nobody inside a code block, so only the rest counts.
  const outside = body.replace(/```[\s\S]*?```/g, '')
  assert.doesNotMatch(outside, /<script>/)
  assert.doesNotMatch(outside, /@here/)
  assert.doesNotMatch(body, /<script>/)
})

test('a store document change lists its parts and asks to check the names', () => {
  const body = prBody({ change: 'c_x', portalUrl: 'https://portal.example', entry: { id: 'io.x.y', name: { en: 'Y' } }, before: { id: 'io.x.y', name: { en: 'Y' } }, fields: [{ field: 'store.name', change: 'changed', class: 'reviewed' }, { field: 'store.description', change: 'added', class: 'self_service' }], eligibility: '', submitter: 'octo', preview: '' })
  assert.match(body, /### Store document/)
  assert.match(body, /`name` changed, `description` added/)
  assert.match(body, /claim nothing official/)
  assert.doesNotMatch(body, /### Changes/)
})

