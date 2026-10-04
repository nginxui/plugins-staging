// The body of a pull request that .github/workflows/apply.yml opens for a
// change submitted in the developer portal: what the change is, who sent it
// and why they may, what to review, the listing preview and the entry.
//
// Everything from the portal or the author is escaped, so it neither renders
// HTML, breaks a table nor mentions anyone. Only the submitter is mentioned,
// once, so GitHub notifies them.

/** Text from the author as plain Markdown text. */
export function plain(text) {
  return String(text ?? '').replace(/</g, '&lt;').replace(/@/g, '@​')
}

/** Text from the author inside a table cell. */
export function cell(text) {
  return plain(text).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
}

function kindOf(fields) {
  const listing = fields.find(item => item.field === 'listing')
  if (listing?.change === 'added')
    return 'new'
  if (listing?.change === 'removed')
    return 'delisting'
  return 'update'
}

const HEADINGS = { new: 'New listing', delisting: 'Delisting', update: 'Update' }

/** What a maintainer checks, by the fields a change touches. */
export function reviewItems(kind, fields) {
  if (kind === 'new') {
    return [
      'The names in every language describe the plugin and claim nothing official',
      'The description and README match what the plugin does',
      'The permissions and network hosts fit its purpose',
      'The repository is the author\'s own work, not a copy of another plugin',
    ]
  }
  if (kind === 'delisting')
    return ['The author of the listing asked to remove it']
  const items = []
  const touched = new Set(fields.map(item => item.field))
  if (touched.has('name'))
    items.push('The names in every language describe the plugin and claim nothing official')
  if (touched.has('author_public_key'))
    items.push('The author announced the new primary key, for example in the repository or a release')
  if (touched.has('repository_url'))
    items.push('The new repository belongs to the same author and holds the same plugin')
  if (touched.has('homepage_url') || touched.has('icon_url'))
    items.push('The new link or icon impersonates nobody')
  if (items.length === 0)
    items.push('The change matches what the author asked for in the portal')
  return items
}

function shortValue(value) {
  if (value === undefined)
    return '*none*'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return `\`${cell(text.length > 160 ? `${text.slice(0, 157)}...` : text).replace(/`/g, '\'')}\``
}

/** The preview of check-entries.yml without its heading, which repeats the id. */
export function trimPreview(preview) {
  return String(preview ?? '').replace(/^#{1,6} .*\n+/, '').trim()
}

/**
 * Builds the body. change is the portal change id, portalUrl the portal's
 * origin, entry the drafted entry and before the one on main (null for a new
 * listing), fields the classified changes, eligibility why the submitter may
 * submit, release { tag, url } of the release the entry is drafted from.
 */
export function prBody({ change, portalUrl, entry, before = null, fields, eligibility, submitter, preview, release }) {
  const kind = kindOf(fields)
  const subject = entry ?? before
  const name = subject?.name?.en ?? subject?.id ?? ''
  const repo = subject?.repository_url ?? ''
  const lines = [
    `## ${HEADINGS[kind]}: ${plain(name)}`,
    '',
    '| | |',
    '| --- | --- |',
    `| Plugin | **${cell(name)}** \`${cell(subject?.id)}\` |`,
  ]
  if (repo)
    lines.push(`| Repository | [${cell(repo.replace(/^https:\/\/github\.com\//, ''))}](${repo}) |`)
  if (release?.tag && release?.url)
    lines.push(`| Release | [${cell(release.tag)}](${release.url}) |`)
  // The portal states the claim as "@login has admin permission on ...".
  const claim = String(eligibility ?? '').replace(/^@\S+\s+/, '')
  lines.push(`| Submitted by | @${submitter}${claim ? `, who ${cell(claim)}` : ''} |`)
  lines.push(`| Developer portal | [Follow this change](${portalUrl}/changes/${change}) |`)
  lines.push('')

  if (kind === 'update') {
    lines.push('### Changes', '', '| Field | Was | Becomes |', '| --- | --- | --- |')
    for (const item of fields)
      lines.push(`| \`${item.field}\` | ${shortValue(before?.[item.field])} | ${shortValue(entry?.[item.field])} |`)
    lines.push('')
  }

  lines.push('### Review', '', ...reviewItems(kind, fields).map(item => `- [ ] ${item}`), '')

  const trimmed = trimPreview(preview)
  if (trimmed && kind !== 'delisting')
    lines.push('### Listing preview', '', trimmed, '')

  if (entry) {
    lines.push(
      `<details><summary>Entry file <code>plugins/${cell(entry.id)}.json</code></summary>`,
      '',
      '```json',
      // < keeps the JSON valid and its text from opening a tag.
      JSON.stringify(entry, null, 2).replace(/</g, '\\u003c'),
      '```',
      '',
      '</details>',
      '',
    )
  }

  const outcome = kind === 'new'
    ? 'Merging lists the plugin at the next deploy.'
    : kind === 'delisting'
      ? 'Merging removes the listing at the next deploy.'
      : 'Merging updates the listing at the next deploy.'
  lines.push('---', `<sub>Opened by the developer portal. ${outcome} When the author resubmits in the portal, this pull request is updated.</sub>`)
  return lines.join('\n')
}
