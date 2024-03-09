import translations from "./_translations.json";

export const defaultLocale: "en_US" = "en_US";

function* interleave<T>(...args: Iterable<T>[]): Iterable<T> {
  const its = Array.from(args).map((x) => x[Symbol.iterator]());
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
  } while (!done);
}

/**
 * Translate a template literal
 */
export function i18n(strings: TemplateStringsArray, ...args: any[]): string {
  // obtain the translation key
  let placeholders = [...Array(strings.length).keys()].slice(1).map((n) => `{${n}}`);
  let rawKey = [...interleave(strings, placeholders)].join("");
  let leadingWhitespace = rawKey.match(/^\s+/);
  let trailingWhitespace = rawKey.match(/\s+$/);
  if (leadingWhitespace && leadingWhitespace?.index === trailingWhitespace?.index) {
    // the key contains only whitespace
    return rawKey;
  }
  let key = rawKey.trim();
  // obtain the locale
  let locale = defaultLocale;
  if (!translations.hasOwnProperty(locale)) {
    locale = "en_US";
  }

  // obtain the translation
  type Key = keyof (typeof translations)[typeof locale];
  let translation = (translations[locale] ?? {})[key as Key];
  if (!translation) {
    // fallback to the untranslated string
    translation = key;
  }
  // replace the placeholders with the arguments
  let translated = translation;
  for (let i = 0; i < args.length; i++) {
    translated = translated.replace(`{${i + 1}}`, args[i].toString());
  }
  return leadingWhitespace[0] + translated + trailingWhitespace[0];
}
