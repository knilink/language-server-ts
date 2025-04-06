import { Snippet } from '../types.ts';
// import { } from '../snippetInclusion/similarFiles'; // circular // TODO unused
import { SnippetProvider, SnippetContext } from './snippetProvider.ts';
// import { } from '../lib'; // TODO unused

class SimilarFilesProvider extends SnippetProvider {
  type = 'similar-files';

  async buildSnippets(context: SnippetContext): Promise<Snippet[]> {
    const { currentFile, similarFiles, options } = context;
    return options && similarFiles && similarFiles.length
      ? await this.api.getSimilarSnippets(currentFile, similarFiles, options.similarFilesOptions)
      : [];
  }
}

export { SimilarFilesProvider };
