import { Chat, Model } from '../../types.ts';

import { getTokenizer } from '../../../../prompt/src/tokenization/index.ts';

function countMessagesTokens(
  // ../prompt/conversationPromptEngine.ts
  messages: Chat.ChatMessage[],
  modelConfiguration: Model.Configuration
): number {
  let tokenizer = getTokenizer(modelConfiguration.tokenizer);
  let numTokens = 0;

  for (let message of messages) {
    if (typeof message === 'object' && message !== null) {
      numTokens += modelConfiguration.baseTokensPerMessage;

      if (message.role) {
        numTokens += tokenizer.tokenize(message.role).length;
      }

      if (message.name) {
        numTokens += tokenizer.tokenize(message.name).length + modelConfiguration.baseTokensPerName;
      }

      if (message.content) {
        numTokens += tokenizer.tokenize(message.content).length;
      }
    } else {
      throw new Error('Invalid message format');
    }
  }

  return numTokens + modelConfiguration.baseTokensPerCompletion;
}

export { countMessagesTokens };
