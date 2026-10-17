import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BADGE_STRINGS, badgeContent, renderBadges } from '../badges.mjs'
import { STRINGS } from '../site-strings.mjs'
import { renderSite } from '../site.mjs'
import { fetchHostLocales, isRtl, KNOWN_LOCALES, langTag, languageName, parseLinguas } from './locales.mjs'

test('LINGUAS is read in the known order, new languages after them', () => {
  assert.deepEqual(parseLinguas('en zh_CN zh_TW fr_FR es de_DE ru_RU vi_VN ko_KR tr_TR ar uk_UA ja_JP pt_PT it_IT\n'), KNOWN_LOCALES)
  assert.deepEqual(parseLinguas('pl_PL zh_CN en ../x'), ['en', 'zh_CN', 'pl_PL'])
  // English is always there, it is what every text falls back to.
  assert.deepEqual(parseLinguas('ja_JP'), ['en', 'ja_JP'])
})

test('language tags and names come from the locale alone', () => {
  const tags = Object.fromEntries(KNOWN_LOCALES.map(locale => [locale, langTag(locale)]))
  assert.deepEqual(tags, { en: 'en', zh_CN: 'zh-CN', zh_TW: 'zh-TW', ja_JP: 'ja', ko_KR: 'ko', de_DE: 'de', fr_FR: 'fr', es: 'es', it_IT: 'it', pt_PT: 'pt-PT', ru_RU: 'ru', uk_UA: 'uk', tr_TR: 'tr', vi_VN: 'vi', ar: 'ar' })
  assert.equal(languageName('zh_CN'), '简体中文')
  assert.equal(languageName('zh_TW'), '繁體中文')
  assert.equal(languageName('fr_FR'), 'Français')
  assert.equal(languageName('pl_PL', 'pl_PL', [...KNOWN_LOCALES, 'pl_PL']), 'Polski')
  assert.equal(languageName('it_IT', 'en'), 'Italian')
  assert.ok(isRtl('ar'))
  assert.ok(!isRtl('de_DE'))
})

test('the languages are downloaded, retried and never guessed', async () => {
  assert.deepEqual(await fetchHostLocales({ env: { HOST_LOCALES: 'en ja_JP' }, fetchImpl: () => assert.fail('no download') }), ['en', 'ja_JP'])

  let calls = 0
  const flaky = async () => {
    calls += 1
    return calls < 2 ? new Response('busy', { status: 503 }) : new Response('en de_DE pl_PL')
  }
  assert.deepEqual(await fetchHostLocales({ env: {}, fetchImpl: flaky }), ['en', 'de_DE', 'pl_PL'])

  await assert.rejects(fetchHostLocales({ env: {}, fetchImpl: async () => new Response('', { status: 404 }) }), /cannot read the languages of Nginx UI/)
})

test('a language Nginx UI adds is counted, and shown once the site has its texts', () => {
  const locales = [...KNOWN_LOCALES, 'pl_PL']
  const plugin = { id: 'io.x.y', name: { en: 'Y', pl_PL: 'Igrek' }, description: { en: 'D' }, author: 'a', trust: 'community', releases: [{ version: '1.0.0', platforms: ['any'], manifest: {} }] }
  const index = { plugins: [plugin] }

  // No Polish texts yet: no pages, no menu entry, no badges, but counted.
  let pages = new Map(renderSite(index, { locales }))
  assert.ok(!pages.has('pl_PL/index.html'))
  assert.ok(!pages.get('index.html').includes('Polski'))
  assert.ok(pages.get('index.html').includes(`<meta name="locales" content="${KNOWN_LOCALES.join(' ')}">`))
  assert.ok(!renderBadges(index, { locales }).some(([file]) => file.includes('/pl_PL/')))
  assert.equal(badgeContent(plugin, 'translations', 'en', locales).value, '2 / 16')

  // Once translated by hand, the language gets its pages and badges.
  STRINGS.pl_PL = STRINGS.en
  BADGE_STRINGS.pl_PL = BADGE_STRINGS.en
  try {
    pages = new Map(renderSite(index, { locales }))
    const page = pages.get('pl_PL/index.html')
    assert.ok(page.includes('<html lang="pl" data-locale="pl_PL">'))
    assert.ok(page.includes('Igrek'))
    assert.ok(page.includes('>Polski</a>'))
    assert.ok(renderBadges(index, { locales }).some(([file]) => file === 'badge/io.x.y/pl_PL/status.svg'))
  }
  finally {
    delete STRINGS.pl_PL
    delete BADGE_STRINGS.pl_PL
  }
})
