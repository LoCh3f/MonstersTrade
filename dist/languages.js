export const CATALOGUE_LANGUAGES = Object.freeze([
  { code: 'en', label: 'English', example: 'Pikachu' },
  { code: 'it', label: 'Italian', example: 'Pikachu' },
  { code: 'ja', label: 'Japanese', example: 'Pikachu' },
  { code: 'ko', label: 'Korean', example: 'Surskit' },
  { code: 'zh-tw', label: 'Traditional Chinese', example: 'Pikachu' },
  { code: 'zh-cn', label: 'Simplified Chinese', example: 'Exeggcute' },
  { code: 'th', label: 'Thai', example: 'Cacnea' },
  { code: 'id', label: 'Indonesian', example: 'Pikachu' },
]);
const ASIAN_LANGUAGES = new Set(CATALOGUE_LANGUAGES.slice(2).map(({code}) => code));

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
