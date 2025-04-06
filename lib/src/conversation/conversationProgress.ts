import type { CopilotConfirmation } from '../openai/types.ts';

import type { Unknown, WorkDoneToken } from '../types.ts';
import type { Turn, Conversation } from '../conversation/conversation.ts';
import type { DocumentUri, Range } from 'vscode-languageserver-types';
import type { TextDocumentResultStatus } from '../fileReader.ts';
import type { Reference } from './schema.ts';
import type { CodeEdit } from './codeEdits.ts';
import type { Steps } from './steps.ts';

namespace ConversationProgress {
  export type Severity = 'warning' | 'info';

  export interface IPayloadStep {
    id: string;
    title: string;
    // optional ./steps.ts
    description?: string;
    // optional ./steps.ts
    status: 'completed' | 'cancelled' | 'running' | 'failed';
    // optional ./steps.ts
    error?: unknown;
  }

  export interface IReportPayload {
    // ../../../agent/src/conversation/syntheticTurnProcessor.ts
    reply?: string;
    // ./extensibility/remoteAgentTurnProcessor.ts
    annotations?: Unknown.Annotation[];
    // ./turnContext.ts
    // ./extensibility/remoteAgentTurnProcessor.ts
    references?: Reference[];
    // ./extensibility/remoteAgentTurnProcessor.ts
    notifications?: { message: string; severity: ConversationProgress.Severity }[];
    // ./extensibility/remoteAgentTurnProcessor.ts
    confirmationRequest?: CopilotConfirmation;
    // ./turnProcessor.ts
    hideText?: boolean;
    codeEdits?: CodeEdit[];
    steps?: Steps.Step[];
  }

  export interface IEndPayload {
    // ./steps.ts
    steps?: IPayloadStep[];

    // ./turnContext.ts
    warnings?: unknown[];
    codeEdits?: CodeEdit[];
    // ./extensibility/remoteAgentTurnProcessor.ts
    unauthorized?: {
      authorizationUri: string;
      agentSlug: string;
      agentName: string;
    };
    // ./extensibility/remoteAgentTurnProcessor.ts
    error?: {
      message: string;
      responseIsFiltered?: boolean;
      responseIsIncomplete?: boolean;
      code?: number;
    };
    // ./extensibility/remoteAgentTurnProcessor.ts
    followUp?: Unknown.FollowUp & { message: string };
    suggestedTitle?: string;
    skillResolutions?: never[];
    updatedDocuments?: { uri: string; text: string }[];
  }

  // ../testing/conversationProgress.ts
  export interface IStep extends ConversationProgress.IEndPayload {
    workDoneToken: WorkDoneToken;
    conversationId: string;
    turnId: string;
    type: 'BEGIN' | 'CANCEL' | 'END' | 'REPORT';
    agentSlug?: string;
  }
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
  abstract end(conversation: Conversation, turn: Turn, payload?: ConversationProgress.IEndPayload): Promise<void>;
  abstract report(conversation: Conversation, turn: Turn, payload: ConversationProgress.IReportPayload): Promise<void>;
}

export { ConversationProgress };
