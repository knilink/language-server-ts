import { SnippetContext, SnippetProvider } from './snippetProvider.ts';
import { commentBlockAsSingles, newLineEnded } from '../languageMarker.ts';
import { normalizeLanguageId } from '../prompt.ts';
// import '../snippetInclusion/snippets.ts';
import { Snippet } from '../types.ts';

class TraitProvider extends SnippetProvider {
  readonly type = 'trait';

  async buildSnippets(context: SnippetContext): Promise<Snippet[]> {
    if (context.traits.length === 0) {
      return [];
    }
    const { currentFile } = context;
    currentFile.languageId = normalizeLanguageId(currentFile.languageId);
    return [
      {
        provider: this.type,
        semantics: 'snippet',
        snippet: commentBlockAsSingles(
          `Consider this related information:\n  ` +
            context.traits
              .map((trait) =>
                trait.kind === 'string' ? newLineEnded(trait.value) : newLineEnded(`${trait.name}: ${trait.value}`)
              )
              .join(''),
          currentFile.languageId
        ),
        relativePath: currentFile.relativePath,
        startLine: 0,
        endLine: 0,
        score: 0,
      },
    ];
  }
}

export { TraitProvider };
