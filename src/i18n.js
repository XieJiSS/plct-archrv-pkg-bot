/**
 * @type {Record<string, Record<string, string>>}
 */
const translations = require('./_translations.json')

/**
 * @type {string}
 */
const defaultLocale = 'en_US'

function* interleave() {
  const its = Array.from(arguments).map(x => x[Symbol.iterator]());
  let done;
  do {
    done = true;
    for (const it of its) {
      const next = it.next();
      if (!next.done) {
        yield next.value;
        done = false;
      }
    }
  } while (!done)
}

/**
 * Translate a template literal
 * @param {TemplateStringsArray} strings 
 * @param  {...any} args 
 * @returns {string}
 */
function i18n(strings, ...args) {
  // obtain the translation key
  let placeholders = [...Array(strings.length).keys()].slice(1).map(n => `{${n}}`)
  let rawKey = [...interleave(strings, placeholders)].join('')
  let leadingWhitespace = rawKey.match(/^\s+/)
  let trailingWhitespace = rawKey.match(/\s+$/)
  if (leadingWhitespace.index === trailingWhitespace.index) {
    // the key contains only whitespace
    return rawKey
  }
  let key = rawKey.trim()
  // obtain the locale
  let locale = defaultLocale
  // obtain the translation
  let translation = (translations[locale] ?? {})[key]
  if (!translation) {
    // fallback to the untranslated string
    translation = key
  }
  // replace the placeholders with the arguments
  let translated = translation
  for (let i = 0; i < args.length; i++) {
    translated = translated.replace(`{${i + 1}}`, args[i].toString())
  }
  return leadingWhitespace[0] + translated + trailingWhitespace[0]
}

module.exports = {
  i18n,
  defaultLocale
}