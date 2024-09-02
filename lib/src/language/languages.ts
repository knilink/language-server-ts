import { knownLanguages } from './generatedLanguages.ts';
const knownTemplateLanguageExtensions: string[] = [
  '.ejs',
  '.erb',
  '.haml',
  '.hbs',
  '.j2',
  '.jinja',
  '.jinja2',
  '.liquid',
  '.mustache',
  '.njk',
  '.php',
  '.pug',
  '.slim',
  '.webc',
];
const templateLanguageLimitations: { [key: string]: string[] } = { '.php': ['.blade'] };
const knownFileExtensions: string[] = Object.keys(knownLanguages).flatMap(
  (language) => knownLanguages[language].extensions
);

export { knownTemplateLanguageExtensions, templateLanguageLimitations, knownFileExtensions };
