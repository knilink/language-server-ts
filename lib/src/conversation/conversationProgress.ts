import { Unknown, WorkDoneToken } from '../types.ts';
import type { Turn, Conversation } from '../conversation/conversation.ts';
import type { DocumentUri, Range } from 'vscode-languageserver-types';
import type { TextDocumentResultStatus } from '../fileReader.ts';
import { Reference } from './schema.ts';
import { CodeEdit } from './codeEdits.ts';

namespace ConversationProgress {
  export type Severity = 'warning' | 'info';
}

// might be implementation of a lsp type
abstract class ConversationProgress {
  // await this.conversationProgress.begin(this.conversation, this.turn, workDoneToken);
  abstract begin(conversation: Conversation, turn: Turn, workDoneToken: WorkDoneToken): Promise<void>;
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
      // ./extensibility/remoteAgentTurnProcessor.ts
      notifications?: { message: string; severity: ConversationProgress.Severity }[];
    }
  ): Promise<void>;
}

export { ConversationProgress };
