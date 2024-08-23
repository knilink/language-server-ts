import { registerLanguageSpecificParser } from './parsing';
import { processJava } from './java';
import { processMarkdown } from './markdown';

registerLanguageSpecificParser('markdown', processMarkdown);
registerLanguageSpecificParser('java', processJava);

export * from './classes';
export * from './parsing';
export * from './description';
export * from './manipulation';
