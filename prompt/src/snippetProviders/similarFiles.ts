import { Snippet } from '../types';
// import { } from '../snippetInclusion/similarFiles'; // circular // TODO unused
import { SnippetProvider, SnippetContext } from './snippetProvider';
// import { } from '../lib'; // TODO unused

class SimilarFilesProvider extends SnippetProvider {
  type = 'similar-files';

  async buildSnippets(context: SnippetContext): Promise<Snippet[]> {
    let { currentFile: currentFile, similarFiles: similarFiles, options: options } = context;
    return options && similarFiles && similarFiles.length && options.similarFiles !== 'none'
      ? await this.api.getSimilarSnippets(currentFile, similarFiles, options.similarFiles, options.cacheReferenceTokens)
      : [];
  }
}

export { SimilarFilesProvider };
