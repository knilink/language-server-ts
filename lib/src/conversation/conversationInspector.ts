import type { PromptType } from '../types.ts';
import { ChatMLFetcher } from './chatMLFetcher.ts';

interface IInspectPromptOptions {
  type: PromptType;
  prompt: string;
  tokens: number;
}

interface IDiffOptions {
  original: string;
  updated: string;
}

abstract class ConversationInspector {
  abstract inspectFetchResult(fetchResult: ChatMLFetcher.Response): Promise<void>;
  // ./prompt/conversationPromptEngine.ts
  abstract inspectPrompt(options: IInspectPromptOptions): Promise<void>;
  // turnProcessorStrategy.ts
  abstract documentDiff(diff: IDiffOptions): Promise<void>;
}

export { ConversationInspector, IInspectPromptOptions, IDiffOptions };
