import { Unknown } from '../types.ts';
import type { Turn, Conversation } from '../conversation/conversation.ts';
import type { DocumentUri, Range } from 'vscode-languageserver-types';
import type { TextDocumentResultStatus } from '../fileReader.ts';
import { Reference } from './schema.ts';
import { CodeEdit } from './codeEdits.ts';

// might be implementation of a lsp type
abstract class ConversationProgress {
  // await this.conversationProgress.begin(this.conversation, this.turn, workDoneToken);
  abstract begin(conversation: Conversation, turn: Turn, workDoneToken: Unknown.WorkDoneToken): Promise<void>;
  abstract cancel(
    conversation: Conversation,
    turn: Turn,
    // optional ./extensibility/remoteAgentTurnProcessor.ts
    error?: unknown
  ): Promise<void>;
  abstract end(conversation: Conversation, turn: Turn, payload: unknown): Promise<void>;
  abstract report(
    conversation: Conversation,
    turn: Turn,
    payload: {
      // ../../../agent/src/conversation/syntheticTurnProcessor.ts
      reply?: string;
      annotations?: Unknown.Annotation[];
      // ./steps.ts
      steps?: unknown[];
      // ./turnProcessor.ts
      hideText?: boolean;
      // ./turnContext.ts
      references?: Reference[];
      // ./turnContext.ts
      warnings?: unknown[];
      codeEdits?: CodeEdit[];
    }
  ): Promise<void>;
}

export { ConversationProgress };
