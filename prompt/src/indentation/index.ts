import { registerLanguageSpecificParser } from './parsing.ts';
import { processJava } from './java.ts';
import { processMarkdown } from './markdown.ts';

registerLanguageSpecificParser('markdown', processMarkdown);
registerLanguageSpecificParser('java', processJava);

export * from './classes.ts';
export * from './parsing.ts';
export * from './description.ts';
export * from './manipulation.ts';
