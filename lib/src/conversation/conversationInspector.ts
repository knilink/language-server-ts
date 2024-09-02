import type { PromptType } from '../types.ts';
import { ChatMLFetcher } from './chatMLFetcher.ts';

export abstract class ConversationInspector {
  abstract inspectFetchResult(fetchResult: ChatMLFetcher.Response): void;
  // ./prompt/conversationPromptEngine.ts
  abstract inspectPrompt(options: { type: PromptType; prompt: string; tokens: number }): void;
  // turnProcessorStrategy.ts
  abstract documentDiff(diff: { original: string; updated: string }): void;
}
