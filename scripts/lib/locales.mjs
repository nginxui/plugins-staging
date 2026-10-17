// The interface languages of Nginx UI, read from its LINGUAS when the site is
// built, so a language Nginx UI adds is counted without a change. The site and
// its badges show a language only once their own texts are translated by hand
// (site-strings.mjs, badges.mjs); plugin texts in it are listed before that.
//
// Env: HOST_LOCALES (space separated, skips the download), LINGUAS_URL.

export const LINGUAS_URL = 'https://raw.githubusercontent.com/0xJacky/nginx-ui/main/app/src/language/LINGUAS'

// The order known languages are shown in; others follow in LINGUAS order.
export const KNOWN_LOCALES = ['en', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'de_DE', 'fr_FR', 'es', 'it_IT', 'pt_PT', 'ru_RU', 'uk_UA', 'tr_TR', 'vi_VN', 'ar']

const LOCALE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/
const RTL_LANGUAGES = new Set(['ar', 'ckb', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi'])
// Chinese is told apart by script, not by region.
const NAME_TAGS = { zh_CN: 'zh-Hans', zh_TW: 'zh-Hant' }

/** The locales a LINGUAS file lists, in the order they are shown. */
export function parseLinguas(text) {
  const found = String(text).split(/\s+/).filter(item => LOCALE.test(item))
  return orderLocales(found)
}

/** English first, then known locales in their order, then the rest. */
export function orderLocales(found) {
  const set = new Set(found)
  set.add('en')
  const known = KNOWN_LOCALES.filter(locale => set.has(locale))
  return [...known, ...[...set].filter(locale => !KNOWN_LOCALES.includes(locale))]
}

/** The locales of Nginx UI. A failed download fails, so a build never drops the
 * pages of a language because GitHub did not answer once. */
export async function fetchHostLocales({ env = process.env, fetchImpl = fetch, attempts = 3 } = {}) {
  if (env.HOST_LOCALES)
    return parseLinguas(env.HOST_LOCALES)
  const url = env.LINGUAS_URL || LINGUAS_URL
  let problem
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      const locales = parseLinguas(await response.text())
      if (locales.length > 1)
        return locales
      throw new Error('it lists no language')
    }
    catch (err) {
      problem = err
    }
  }
  throw new Error(`cannot read the languages of Nginx UI from ${url}: ${problem.message}`)
}

/** The BCP 47 tag of a locale. The region is left out when it is the usual one
 * of the language and no other locale shares the language: ja_JP is ja,
 * pt_PT stays pt-PT. */
export function langTag(locale, locales = KNOWN_LOCALES) {
  const [language, region] = locale.split('_')
  if (!region)
    return language
  const shared = locales.filter(other => other.split('_')[0] === language).length > 1
  if (!shared && new Intl.Locale(language).maximize().region === region)
    return language
  return `${language}-${region}`
}

/** The name of a language, in that language by default. */
export function languageName(locale, inLocale = locale, locales = KNOWN_LOCALES) {
  const display = langTag(inLocale, locales)
  let name
  try {
    name = new Intl.DisplayNames([display], { type: 'language' }).of(NAME_TAGS[locale] ?? langTag(locale, locales))
  }
  catch {
    return locale
  }
  return name ? name.charAt(0).toLocaleUpperCase(display) + name.slice(1) : locale
}

export function isRtl(locale) {
  return RTL_LANGUAGES.has(locale.split('_')[0])
}
