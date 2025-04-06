import type { CancellationToken } from 'vscode-languageserver';
import type { Context } from '../../../lib/src/context.ts';
import type { Static } from '@sinclair/typebox';
import { Chat } from '../../../lib/src/types.ts';

import { TestingOptions } from './testingOptions.ts';
import { ensureAuthenticated } from '../auth/authDecorator.ts';
import { ErrorCode } from '../rpc.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { ChatMLFetcher } from '../../../lib/src/conversation/chatMLFetcher.ts';
import { ModelConfigurationProvider } from '../../../lib/src/conversation/modelConfigurations.ts';
import { Features } from '../../../lib/src/experiments/features.ts';
import { Type } from '@sinclair/typebox';
import type {} from '../../../lib/src/conversation/modelMetadata.ts';
import type {} from '../../../lib/src/conversation/openai/openai.ts';
import type {} from '../../../lib/src/openai/fetch.ts';

function buildSystemMessage() {
  return [
    'You are an AI programming assistant, helping a software developer to come up with the best git commit message for their code changes.',
    "You excel in interpreting the purpose behind code changes to craft succinct, clear commit messages that adhere to the repository's guidelines.",
    '',
    '# First, think step-by-step:',
    "1. Analyze the CODE CHANGES thoroughly to understand what's been modified.",
    '2. Identify the purpose of the changes to answer the *why* for the commit messages, also considering the optionally provided RECENT USER COMMITS.',
    '3. Review the provided RECENT REPOSITORY COMMITS to identify established commit message conventions. Focus on the format and style, ignoring commit-specific details like refs, tags, and authors.',
    '4. Generate a thoughtful and succinct commit message for the given CODE CHANGES. It MUST follow the established writing conventions.',
    '5. Remove any meta information like issue references, tags, or author names from the commit message. The developer will add them.',
    '6. Now only show your message, wrapped with a single markdown ```text codeblock! Do not provide any explanations or details',
  ].join('\n');
}

function buildUserMessage(params: Static<typeof Params>) {
  const parts = [];

  if (params.userCommits.length > 0) {
    parts.push(
      '# RECENT USER COMMITS (For reference only, do not copy!):',
      params.userCommits.map((message) => `- ${message}`).join('\n'),
      ''
    );
  }

  if (params.recentCommits.length > 0) {
    parts.push(
      '# RECENT REPOSITORY COMMITS (For reference only, do not copy!):',
      params.recentCommits.map((message) => `- ${message}`).join('\n'),
      ''
    );
  }

  parts.push(
    '# CODE CHANGES:',
    params.changes.join('\n'),
    '',
    'Now generate a commit message that describes the CODE CHANGES.',
    'DO NOT COPY commits from RECENT COMMITS, but use them as reference for the commit style.',
    'ONLY return a single markdown code block, NO OTHER PROSE!',
    '```text',
    'commit message goes here',
    '```'
  );

  return parts.join('\n');
}

async function handleGitCommitGenerateChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[{ commitMessage: string }, null] | [null, { code: number; message: string }]> {
  if (params.changes.length === 0) {
    return [null, { code: ErrorCode.InvalidRequest, message: 'No changes provided' }];
  }
  const fetcher = new ChatMLFetcher(ctx);

  const modelConfiguration = await ctx
    .get(ModelConfigurationProvider)
    .getBestChatModelConfig(['gpt-4o-mini', 'gpt-4o', 'gpt-4']);

  const messages: Chat.ElidableChatMessage[] = [
    { role: 'system', content: buildSystemMessage() },
    { role: 'user', content: buildUserMessage(params) },
  ];

  const telemetryWithExp = await ctx.get(Features).updateExPValuesAndAssignments();

  const response = await fetcher.fetchResponse(
    {
      modelConfiguration,
      messages,
      uiKind: 'conversationPanel',
      intentParams: { intent: true },
    },
    token,
    telemetryWithExp
  );

  if (response.type !== 'success') {
    return [null, { code: ErrorCode.InternalError, message: 'Failed to generate commit message' }];
  }
  const match = response.value.match(/```text\n([\s\S]*?)\n```/);
  return [{ commitMessage: match ? match[1].trim() : response.value.trim() }, null];
}

const Params = Type.Object({
  changes: Type.Array(Type.String()),
  userCommits: Type.Array(Type.String()),
  recentCommits: Type.Array(Type.String()),
  options: Type.Optional(TestingOptions),
});

const handleGitCommitGenerate = ensureAuthenticated(addMethodHandlerValidation(Params, handleGitCommitGenerateChecked));

export { handleGitCommitGenerate };
