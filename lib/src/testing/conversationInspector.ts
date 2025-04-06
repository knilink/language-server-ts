import { ChatMLFetcher } from '../conversation/chatMLFetcher.ts';
import { ConversationInspector, IInspectPromptOptions, IDiffOptions } from '../conversation/conversationInspector.ts';

class TestConversationInspector extends ConversationInspector {
  prompts: IInspectPromptOptions[] = [];
  fetchResults: unknown[] = [];
  diffs: IDiffOptions[] = [];

  shouldInspect() {
    return true;
  }

  async inspectPrompt(promptInspection: IInspectPromptOptions) {
    if (this.shouldInspect()) {
      this.prompts.push(promptInspection);
    }
  }
  async inspectFetchResult(fetchResult: ChatMLFetcher.Response) {
    if (this.shouldInspect()) {
      this.fetchResults.push(fetchResult);
    }
  }
  async documentDiff(documentDiff: IDiffOptions) {
    if (this.shouldInspect()) {
      this.diffs.push(documentDiff);
    }
  }
}

export { TestConversationInspector };
