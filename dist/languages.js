const westernSearchLanguages = [
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italian' },
];
const asianLanguages = [
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh-tw', label: 'Traditional Chinese' },
  { code: 'zh-cn', label: 'Simplified Chinese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
];
const otherWesternLanguages = [
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
];
export const SEARCH_LANGUAGES = Object.freeze([...westernSearchLanguages, ...asianLanguages]);
export const CATALOGUE_LANGUAGES = Object.freeze([...westernSearchLanguages, ...otherWesternLanguages, ...asianLanguages]);
const ASIAN_LANGUAGES = new Set(asianLanguages.map(({code}) => code));

function normalizedLanguage(code) {
  const language = typeof code === 'string' ? code.toLowerCase() : '';
  if (language === 'zh-hant') return 'zh-tw';
  if (language === 'zh-hans') return 'zh-cn';
  return language;
}

export function catalogueLanguage(code) {
  return CATALOGUE_LANGUAGES.find(language => language.code === code)?.code || 'en';
}

export function marketLanguage(code) {
  const language = normalizedLanguage(code);
  return ASIAN_LANGUAGES.has(language) ? language : 'en';
}

export function languageLabel(code) {
  const language = normalizedLanguage(code);
  if (!language || language === 'und') return 'Language unspecified';
  return CATALOGUE_LANGUAGES.find(item => item.code === language)?.label || language.toUpperCase();
}

export function marketCardKey(id, language) {
  return language === 'en' ? id : `${language}:${id.toLowerCase()}`;
}
