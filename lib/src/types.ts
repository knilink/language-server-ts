import { Position, Range } from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';
import { Context } from './context.ts';
import { TelemetryData, TelemetryWithExp } from './telemetry.ts';
import { TurnContext } from './conversation/turnContext.ts';
import { ElidableText } from '../../prompt/src/elidableText/elidableText.ts';
import { TSchema } from '@sinclair/typebox';
import { ChatModelFamily } from './conversation/modelMetadata.ts';
import { DocumentUri } from 'vscode-languageserver-types';

// export { WorkspaceFolder } from 'vscode-languageserver-types';

export type LanguageId = string;

export type SkillId = string;

export type TurnId = string;

// export type ChatGPTModelName = 'gpt-4o' | 'gpt-4-turbo' | 'gpt-4' | 'gpt-3.5-turbo';

export type Replacement = {
  prefix: string;
  path: string;
};

export type ExperimentConfig = {};

// prompt/repository.ts
export type RepoUrlInfo = {
  // required ./ghostText/ghostText.ts telemetryData.properties.gitRepoHost = repoInfo.hostname;
  hostname: string;
  owner: string;
  repo: string;
  // required ./ghostText/ghostText.ts telemetryData.properties.gitRepoPath = repoInfo.pathname;
  // optional ./prompt/repository.ts
  pathname: string;
};
// Mark maybe Remote | Local
export type RepoInfo = RepoUrlInfo & {
  // ./prompt/repository
  // ./conversation/skills/projectContextSnippetProviders/BlackbirdSnippetProvider.ts
  baseFolder: string;
  // required string ./ghostText/ghostText.ts telemetryData.properties.gitRepoUrl = repoInfo.url;
  // optional string {url, ...repoInfo} ./conversation/skills/projectContextSnippetProviders/BlackbirdSnippetProvider.ts
  // optional ./prompt/repository.ts
  // URI optional ./conversation/skills/projectContextSnippetProviders/BlackbirdSnippetProvider.ts
  url: string;
};
// | 0;

// remove 1.40.0
// export type CopilotNeighboringTabs =
//   | 'none'
//   | 'conservative'
//   | 'medium'
//   | 'eager'
//   | 'eagerButLittle'
//   | 'eagerButMedium'
//   | 'eagerButMuch';

export type TelemetryProperties = Record<string, string>;

export type TelemetryRawProperties = Record<string, unknown>;

// ./ghostText/contextualFilter.ts 'foo' in measurements so has to be record
export type TelemetryMeasurements = Record<string, number>;

export enum TelemetryStore {
  OPEN = 0,
  RESTRICTED = 1,
}

export type BlockMode = 'parsing' | 'parsingandserver' | 'server' | 'parsingandserver';

export interface IReporter {
  sendTelemetryEvent(
    eventName: string,
    properties?: TelemetryRawProperties,
    measurements?: TelemetryMeasurements
  ): void;
  sendTelemetryErrorEvent(
    eventName: string,
    properties?: TelemetryProperties,
    measurements?: TelemetryMeasurements,
    errorProps?: unknown
  ): void;
  dispose(): Promise<void>;
}

export type OpenAIRequestId = {
  headerRequestId: string;
  completionId: string;
  created: number;
  serverExperiments: string;
  deploymentId: string;
};

export type Token = unknown;
export type TextOffset = unknown;
export type Logprob = unknown;
export type TopLogprob = unknown;
export type TokenLogprob = unknown;

export type Tool = {
  type: 'function';
  function: {
    name: string;
    // ./conversation/skills/projectContextSnippetProviders/localSnippets/UserQueryParser.ts
    description: string;
    // ./conversation/skills/projectContextSnippetProviders/localSnippets/UserQueryParser.ts
    parameters: TSchema;
  };
};

export type ToolChoice = {
  type: Tool['type'];
  function: { name: Tool['function']['name'] };
};

export type ToolCall = {
  type: 'function';
  function: {
    name: string;
    arguments: {
      context: { skillIds: SkillId[] }; // was PromptContext
      skillIds: SkillId[];
      // ./conversation/prompt/strategies/suggestionsPromptStrategy.ts
      suggestedTitle: string;
      // ./conversation/prompt/strategies/suggestionsPromptStrategy.ts
      // should be the same as return value of extractArguments
      followUp: string;
      // ./conversation/skills/projectContextSnippetProviders/localSnippets/UserQueryParser.ts
      keywords: { keyword: string; variations: string[] }[];
    };
  };
  approxNumTokens: number;
  // index: number;
  skillIds?: SkillId[];
};

export type AnnotationsMap = Record<string, Unknown.Annotation[]>;

export type FunctionCall = {
  name?: string;
  arguments: string[];
};

export type Delta = {
  content: string;
  tool_calls: // indux:number ./openai/stream.ts
  { index: number; function: { name?: 'string'; arguments: string } }[];
  copilot_annotations: AnnotationsMap;
  // ./openai/stream.ts
  role: 'function';
  function_call: {
    name?: string;
    // chunk of arguments
    arguments: string;
  };
};

export type Choice = {
  index: number;
  delta?: Delta;
  text: string;
  logprobs: Partial<{
    tokens: Token[];
    text_offset: TextOffset[];
    token_logprobs: TokenLogprob[];
    top_logprobs: TopLogprob[];
  }>;
  // AnnotationsMap
  copilot_annotations: AnnotationsMap;
  completionText: string;
};

export type JsonData = {
  id?: string;
  created?: number;
  logprobs?: Record<string, string>;
};

export type DocumentEvaluateResult = {
  isBlocked: boolean;
  reason?: string;
  message?: string;
};

export type UiKind =
  | 'ghostText'
  | 'synthesize'
  | 'conversationInline'
  | 'conversationPanel'
  | 'conversation'
  // ../../agent/src/methods/testing/chatML.ts
  | 'conversationIntegrationTest';

export type FetchResult =
  | {
      type: 'success';
      toolCalls: ToolCall[];
      numTokens: number;
      requestId: string;
    }
  | { type: 'offTopic' }
  | { type: 'canceled' }
  | { type: 'filtered' }
  | { type: 'length' }
  | { type: 'agentAuthRequired'; authUrl: string }
  | { type: 'successMultiple' }
  | { type: 'failed'; reason: string; code: number }
  | {
      type: 'failure';
      reason?: string;
    }
  | { type: 'successMultiple' }
  | { type: 'tool_calls' }
  | { type: 'unknown' };

export namespace Chat {
  // ../../agent/src/methods/testing/chatML.ts
  export type Role = 'system' | 'user' | 'assistant' | 'function';

  export type ChatMessage = {
    role: Role;
    content: string;
    // ../../agent/src/methods/testing/chatML.ts
    name?: string;

    copilot_references?: ConversationReference.OutgoingReference[];
  };

  export type ElidableChatMessage =
    | ChatMessage
    | {
        role: Role;
        // ./conversation/prompt/conversationPromptEngine.ts
        content: ElidableText;
        // ../../agent/src/methods/testing/chatML.ts
        name?: string;
      };
}

// ./conversation/prompt/strategies/promptStrategyFactory.ts
// ./conversation/modelMetadata.ts
export type PromptType = 'user' | 'inline' | 'meta' | 'suggestions' | 'synonyms';

// ../agent/src/textDocumentManager.ts
// WorkspaceFolder from lsp
// export type WorkspaceFolder = URI; // ../../lib/src/textDocumentManager.ts:URI

//  ./ghostText/last.ts
// ./ghostText/ghostText.ts
export enum CompletionResultType {
  New = 0,
  Cached = 1,
  UserTyping = 2,
  WithCompletion = 3,
}

// ./ghostText/copilotCompletion.ts
export type Completion = {
  index: number;
  uuid: string;
  insertText: string;
  range: Range;
  // file: DocumentUri; // maybe removed
  uri: DocumentUri;
  // TelemetryWithExp ./ghostText/last.ts
  telemetry: TelemetryWithExp;
  displayText: string;
  position: Position;
  offset: number;
  resultType: CompletionResultType;
  // required ../../agent/src/commands/panel.ts
  // optional ./ghostText/copilotCompletion.ts
  triggerCategory: string;
};

// ./conversation/modelMetadata.ts
export namespace Model {
  export type Supports = Record<string, boolean>;
  export type Capabilities = {
    type: 'chat' | 'embeddings';
    family: ChatModelFamily;
    limits?: {
      // ./conversation/modelConfigurations.ts
      max_prompt_tokens: number;
      // ./conversation/modelConfigurations.ts
      max_inputs: number;
    };
    // ./conversation/modelConfigurations.ts
    supports?: Supports;
  };
  export type Metadata = {
    id: string;
    name: string; // ui name
    version: string;
    // ./conversation/modelConfigurations.ts
    // omit ./conversation/modelMetadata.ts
    capabilities: Capabilities;
    // ./conversation/modelConfigurations.ts
    isExperimental: boolean;
  };

  // ./conversation/modelConfigurations.ts
  export type TokenConfiguration = {
    // ./conversation/skills/projectContextSnippetProviders/localSnippets/EmbeddingsFetcher.ts
    // removed 1.40.0 ./conversation/extensibility/remoteAgentTurnProcessor.ts
    // maxTokens: number;
    maxRequestTokens: number;
    maxResponseTokens: number;
  };

  // ./conversation/modelConfigurations.ts
  export type Configuration = TokenConfiguration & {
    modelId: string;
    uiName?: string;
    modelFamily: ChatModelFamily;
    baseTokensPerMessage: number;
    baseTokensPerName: number;
    baseTokensPerCompletion: number;
    tokenizer: 'cl100k_base' | 'o200k_base' | 'cl100k_base';
    isExperimental: boolean;
  };

  export type EmbeddingModelConfig = {
    modelId: string;
    modelFamily: string;
    // required ./conversation/skills/projectContextSnippetProviders/localSnippets/EmbeddingsFetcher.ts
    maxBatchSize: number;
    maxTokens: number;
    tokenizer: string;
  };
}

export namespace Skill {
  export interface ISkillDescriptor {
    id: SkillId;
    type: 'implicit' | 'explicit';
    // required ./conversation/dump.ts
    description(): string;
    examples?(): string[];
    isAvailable?(ctx: Context): Promise<boolean>;
  }

  export interface ISkill<K extends SkillId, T> extends ISkillDescriptor {
    id: K;
    resolver(turnContext: TurnContext): ISkillResolver<T>;
    processor(turnContext: TurnContext): ISkillProcessor<T>;
  }

  export interface ISkillResolver<T extends unknown> {
    resolveSkill(turnContext: TurnContext): Promise<
      | T
      // undefined ./conversation/skills/ProjectContextSkill.ts
      | undefined
    >;
  }

  export interface ITurnContextStep {
    start(stepId: string, stepTitle: string): Promise<void>;
    finish(stepId: string): Promise<void>;
    error(stepId: string, errorMessage: string): Promise<void>;
  }

  export interface ISkillProcessor<T extends unknown> {
    processSkill(skill: T, turnContext: TurnContext): Promise<ElidableText | string | undefined>;
    value: () => number;
  }
}

export namespace SolutionHandler {
  export type UnformattedSolution = {
    requestId: OpenAIRequestId;
    completionText: string;
    insertText: string;
    range: Range;
    meanProb: number;
    meanLogProb: number;
    choiceIndex: number;
    telemetryData: TelemetryWithExp;
  };
  export interface ISolutionHandler {
    offset: number;
    onSolution(unformattedSolution: UnformattedSolution): void;
    onFinishedNormally(): void;
  }
}

// lib/src/conversation/conversationProgress.ts
// string(uuid) lsp-type
// string | number ../../agent/src/methods/conversation/conversationCreate.ts
export type WorkDoneToken = string | number;

export namespace ConversationReference {
  type ReferenceBase<T extends string, D> = string extends T
    ? never
    : {
        type: T;
        id: string;
        data: D;
      };

  type ClientFile = { content: string; language: LanguageId };
  type ClientSelection = {
    start: { line: number; col: number };
    end: { line: number; col: number };
    content: string;
  };
  type GithubRepository = {
    type: 'repository';
    name: string;
    ownerLogin: string;
    id: string;
  };
  // ./conversation/extensibility/references.ts
  type GithubWebSearch = {
    query: string;
    type: string;
    results?: { title: string; excerpt: string; url: string }[];
  };

  // outgoingReferences
  export type OutgoingReference =
    | ReferenceBase<'client.file', ClientFile>
    | ReferenceBase<'client.selection', ClientSelection>
    | ReferenceBase<'github.repository', GithubRepository>
    | (ReferenceBase<'github.web-search', GithubWebSearch> & {
        metadata?: { display_name?: string; display_icon?: string };
      });
}

export namespace Unknown {
  // ./conversation/conversationFinishCallback.ts
  // DebugCodeVulnerability ./conversation/vulnerabilityDebugHandler.ts
  export type Annotation = {
    id: number;
    start_offset: number;
    stop_offset: number;
    // ./conversation/conversationFinishCallback.ts
    type: 'code_vulnerability';
    details: {
      type: 'server-side-unvalidated-url-redirection';
      description: string;
      ui_type: 'test';
      ui_description: 'test';
    };
  };

  // ./conversation/turnProcessor.ts
  export type FollowUp = {
    // undefined (schema) ../../agent/src/methods/conversation/conversationTurn.ts
    // enrichedFollowup ./conversation/fetchPostProcessor.ts
    // message: SuggestionsFetchResult['followUp'];
    id: string; // telemetryPropertiesToUse.suggestionId,
    // string ./conversation/turnProcessor.ts
    type: string; // telemetryPropertiesToUse.suggestionType,
  };

  // lib/src/conversation/fetchPostProcessor.ts
  export type Suggestions = {
    // enrichedFollowup ./conversation/fetchPostProcessor.ts
    followUp: FollowUp & { message: string };
    suggestedTitle: string;
  };

  export type SkillResolution = {
    skillId: SkillId | 'unknown';
    // 'resolved' | 'failed' | 'unprocessable' | 'unresolvable' conversation/prompt/fromSkills.ts
    resolution: 'resolved' | 'failed' | 'unprocessable' | 'unresolvable' | 'ignored';
    files?: { status: unknown; uri: string }[];
    tokensPreEliding?: number;
    resolutionTimeMs?: number;
    processingTimeMs?: number;
    // 1.40.0 removed
    // labels: string[]; // ./conversation/prompt/fromSkills.ts
    fileCount?: number;
    chunkCount?: number;
    chunkingTimeMs?: number;
    rankingTimeMs?: number;
  };

  export interface ToolConfig {
    skillIds?: SkillId[];
    extractArguments(toolCall: ToolCall): {
      //  ./conversation/prompt/strategies/metaPromptStrategy.ts
      skillIds?: SkillId[];
      // ./conversation/prompt/strategies/suggestionsPromptStrategy.ts
      // ./conversation/turnSuggestions.ts
      followUp?: string;
      suggestedTitle?: string;
      // conversation/prompt/strategies/userQuerySynonymsPromptStrategy.ts
      keywords?: string[];
    };

    // ../lib/src/conversation/prompt/metaPrompt.ts
    // ./conversation/prompt/strategies/suggestionsPromptStrategy.ts
    tool_choice: ToolChoice;
    // ../lib/src/conversation/prompt/metaPrompt.ts
    // ./conversation/prompt/strategies/suggestionsPromptStrategy.ts
    tools: Tool[];
  }

  export type ConversationPrompt = {
    // ../lib/src/conversation/prompt/conversationPromptEngine.ts
    messages: Chat.ElidableChatMessage[];
    // ./conversation/extensibility/remoteAgentTurnProcessor.ts:226
    tokens: number;
    skillResolutions: SkillResolution[];

    // required ./conversation/turnSuggestions.ts
    // optional ./conversation/prompt/conversationPromptEngine.ts
    toolConfig?: ToolConfig;
  };
}

export namespace Snippet {
  export type SnippetProviderStatus = 'not_indexed' | 'indexed' | 'indexing';

  export type Measurement = Partial<{
    chunkCount: number;
    fileCount: number;
    chunkingTimeMs: number;
    rankingTimeMs: number;
  }>;
  // schema ./conversation/skills/ProjectContextSkill.ts
  export type Snippet = {
    uri: string;
    range: Range;
    snippet: string;
  };
  export interface ISnippetProvider {
    // ./conversation/skills/projectContextSnippetProviders/localSnippets/LocalSnippetProvider.ts
    readonly providerType: 'local';
    provideSnippets(turnContext: TurnContext): Promise<{ snippets: Snippet[]; measurements?: Snippet.Measurement }>;
    snippetProviderStatus(turnContext: TurnContext): Promise<SnippetProviderStatus>;
  }
}
