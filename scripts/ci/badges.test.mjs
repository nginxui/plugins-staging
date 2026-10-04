import assert from 'node:assert/strict'
import { test } from 'node:test'
import { badgeContent, badgeSvg, renderBadges, textWidth } from '../badges.mjs'

const plugin = { id: 'io.x.y', name: { en: 'Y', ja_JP: 'ワイ' }, description: { en: 'D', zh_CN: '描述' }, releases: [{ version: '1.2.0', min_nginx_ui_version: '2.8.0' }] }

test('badges tell the listing state, version, coverage and host version', () => {
  assert.deepEqual(badgeContent(plugin, 'status', 'zh_CN'), { label: 'Nginx UI 插件', value: '已上架', color: '#389e0d' })
  assert.equal(badgeContent(plugin, 'version', 'en').value, 'v1.2.0')
  assert.equal(badgeContent(plugin, 'translations', 'en').value, '3 / 14')
  assert.equal(badgeContent(plugin, 'requires', 'en').value, 'Nginx UI 2.8.0+')
})

test('a yanked newest version shows in red', () => {
  const yanked = { ...plugin, releases: [{ version: '1.3.0', yanked: true }, ...plugin.releases] }
  assert.deepEqual(badgeContent(yanked, 'version', 'zh_CN'), { label: '版本', value: 'v1.3.0 已撤回', color: '#cf1322' })
  assert.equal(badgeContent(yanked, 'requires', 'en').value, 'Nginx UI 2.8.0+')
})

test('the svg escapes text and sizes to it', () => {
  const svg = badgeSvg('a<b', 'c&d', '#000', 'square')
  assert.match(svg, /a&lt;b/)
  assert.match(svg, /c&amp;d/)
  assert.match(svg, /rx="0"/)
  assert.ok(textWidth('插件') > textWidth('ab'))
})

test('every plugin gets each kind, style and language', () => {
  const files = renderBadges({ plugins: [plugin] }).map(([file]) => file)
  assert.ok(files.includes('badge/io.x.y/status.svg'))
  assert.ok(files.includes('badge/io.x.y/version.large.svg'))
  assert.ok(files.includes('badge/io.x.y/zh_CN/translations.square.svg'))
  assert.equal(files.length, 4 * 3 * 15)
})
