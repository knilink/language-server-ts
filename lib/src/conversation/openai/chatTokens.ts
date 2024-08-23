import { Chat, Model } from '../../types';

import { getTokenizer } from '../../../../prompt/src/tokenization';

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

      for (const [key, value] of Object.entries(message)) {
        numTokens += tokenizer.tokenize(value).length;

        if (key === 'name') {
          numTokens += modelConfiguration.baseTokensPerName;
        }
      }
    } else {
      throw new Error('Invalid message format');
    }
  }

  return numTokens + modelConfiguration.baseTokensPerCompletion;
}

export { countMessagesTokens };
