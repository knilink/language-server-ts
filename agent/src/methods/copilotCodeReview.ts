import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Range } from 'vscode-languageserver-types';
import type { Context } from '../../../lib/src/context.ts';
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

interface Comment {
  uri: string;
  range: Range;
  message: string;
  kind: string;
  severity: string;
}

function buildSystemMessage(): string {
  return [
    'You are a world-class software engineer and the author and maintainer of the discussed code. Your feedback prefectly combines detailed feedback and explanation of context.',
    'When asked for your name, you must respond with "GitHub Copilot".',
    "Follow the user's requirements carefully & to the letter.",
    'Follow Microsoft content policies.',
    'Avoid content that violates copyrights.',
    `If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, violent, or completely irrelevant to software engineering, only respond with "Sorry, I can't assist with that."`,
    'Keep your answers short and impersonal.',
    'Use Markdown formatting in your answers.',
    'Make sure to include the programming language name at the start of the Markdown code blocks.',
    'Avoid wrapping the whole response in triple backticks.',
    'The user works in an IDE called Visual Studio Code which has a concept for editors with open files, integrated unit test support, an output pane that shows the output of running the code as well as an integrated terminal.',
    'The active document is the source code the user is looking at right now.',
    'You can only give one reply for each conversation turn.',
    '',
    'Additional Rules',
    'Think step by step:',
    '1. Examine the provided code and any other context like user question, related errors, project details, class definitions, etc.',
    '2. Provide feedback on the current selection on where it can be improved or introduces a problem.',
    '2a. Avoid commenting on correct code.',
    '2b. Avoid commenting on commented out code.',
    '2c. Keep scoping rules in mind.',
    '3. Reply with an enumerated list of feedback with source line number, filepath, kind (bug, performance, consistency, documentation, naming, readability, style, other), severity (low, medium, high), and feedback text.',
    '3a. E.g.: 1. Line 357 in src/flow.js, bug, high severity: `i` is not incremented.',
    '3b. E.g.: 2. Line 361 in src/arrays.js, documentation, low severity: Function `binarySearch` is not documented.',
    "3c. E.g.: 3. Line 176 in src/vs/platform/actionWidget/browser/actionWidget.ts, consistency, medium severity: The color id `'background.actionBar'` is not consistent with the other color ids used. Use `'actionBar.background'` instead.",
    '3d. E.g.: 4. Line 410 in src/search.js, documentation, medium severity: Returning `-1` when the target is not found is a common convention, but it should be documented.',
    '3e. E.g.: 5. Line 51 in src/account.py, bug, high severity: The deposit method is not thread-safe. You should use a lock to ensure that the balance update is an atomic operation.',
    '3f. E.g.: 6. Line 220 in src/account.py, readability, low severity: The withdraw method is very long and combines multipe logical steps, consider splitting it into multiple methods.',
    '4. Try to sort the feedback by file and line number.',
    '5. When there is no feedback to provide, reply with "No feedback to provide."',
    '',
    'Focus on being clear, helpful, and thorough.',
    'Use developer-friendly terms and analogies in your explanations.',
    'Provide clear and relevant examples when helpful.',
  ].join(`\n`);
}

function buildUserMessage(params: ParamsType) {
  const selectedLines = params.document.text
    .split(`\n`)
    .slice(params.selection.start.line, params.selection.end.line + 1);

  const fromLine = params.selection.start.line + 1;
  const toLine = params.selection.end.line + 1;

  const numberedCode = selectedLines
    .map((line, i) => {
      const actualLineNumber = params.selection.start.line + i + 1;
      return `/* ${actualLineNumber > fromLine && actualLineNumber < toLine ? 'Selected ' : ''}Line ${actualLineNumber} */${line}`;
    })
    .join(`\n`);

  return [
    '<currentChange>',
    'Current selection with the selected lines labeled as such:',
    '',
    `From the file: ${params.document.uri}`,
    `\`\`\`${params.document.languageId}/${params.document.uri}: FROM_LINE: ${fromLine} - TO_LINE: ${toLine}`,
    numberedCode,
    '```',
    '',
    '</currentChange>',
  ].join(`\n  `);
}

function parseReviewComments(document: ParamsType['document'], message: string): Comment[] {
  const comments: Comment[] = [];

  const lines = document.text.split(`\n`);

  const regex =
    /(\d+)\.\s*Line\s*(\d+)\s*in\s*([^,]+),\s*(\w+),\s*(\w+)\s*severity:\s*((?:[^`.\n]|`[^`]*`|\.(?=\s*[A-Z]))+)(?:\.|$)/gm;
  let match;
  while ((match = regex.exec(message)) !== null) {
    const [_, __, lineStr, ___, kind, severity, content] = match;
    if (
      !['bug', 'performance', 'consistency', 'documentation', 'naming', 'readability', 'style', 'other'].includes(
        kind.toLowerCase()
      )
    ) {
      continue;
    }
    const lineNum = parseInt(lineStr) - 1;
    if (lineNum < 0 || lineNum >= lines.length) {
      continue;
    }
    const line = lines[lineNum];
    const startChar = Math.max(line.search(/\S/), 0);
    const endChar = line.trimEnd().length;
    const comment = {
      uri: document.uri,
      range: { start: { line: lineNum, character: startChar }, end: { line: lineNum, character: endChar } },
      message: content.trim(),
      kind: kind.toLowerCase(),
      severity: severity.toLowerCase(),
    };
    comments.push(comment);
  }
  return comments;
}

async function handleCopilotCodeReviewChecked(
  ctx: Context,
  token: CancellationToken,
  params: ParamsType
): Promise<[{ comments: Comment[] }, null] | [null, { code: number; message: string }]> {
  if (!params.document.text) {
    return [null, { code: ErrorCode.InvalidRequest, message: 'Document text is required' }];
  }
  if (!params.document.uri) {
    return [null, { code: ErrorCode.InvalidRequest, message: 'Document URI is required' }];
  }
  if (!params.document.languageId) {
    return [null, { code: ErrorCode.InvalidRequest, message: 'Document language ID is required' }];
  }
  const lines = params.document.text.split(`\n`);
  if (params.selection.start.line < 0 || params.selection.end.line >= lines.length) {
    return [null, { code: ErrorCode.InvalidRequest, message: 'Invalid selection range' }];
  }
  if (params.selection.start.line > params.selection.end.line) {
    return [null, { code: ErrorCode.InvalidRequest, message: 'Selection start line must be before end line' }];
  }
  const fetcher = ctx.get(ChatMLFetcher);
  const modelConfiguration = await ctx.get(ModelConfigurationProvider).getBestChatModelConfig(['gpt-4']);
  const messages: Chat.ElidableChatMessage[] = [
    { role: 'system', content: buildSystemMessage() },
    { role: 'user', content: buildUserMessage(params) },
  ];
  const telemetryWithExp = await ctx.get(Features).updateExPValuesAndAssignments();
  const response = await fetcher.fetchResponse(
    { modelConfiguration, messages, uiKind: 'conversationPanel', intentParams: { intent: true } },
    token,
    telemetryWithExp
  );
  if (response.type !== 'success') {
    return [null, { code: ErrorCode.InternalError, message: 'Failed to generate code review' }];
  }
  const comments = parseReviewComments(params.document, response.value);
  comments.sort((a, b) => a.range.start.line - b.range.start.line);
  return [{ comments }, null];
}

const Params = Type.Object({
  document: Type.Object({ uri: Type.String(), text: Type.String(), languageId: Type.String(), version: Type.Number() }),
  selection: Type.Object({
    start: Type.Object({ line: Type.Number(), character: Type.Number() }),
    end: Type.Object({ line: Type.Number(), character: Type.Number() }),
  }),
  options: Type.Optional(TestingOptions),
});

type ParamsType = Static<typeof Params>;

const handleCopilotCodeReview = ensureAuthenticated(addMethodHandlerValidation(Params, handleCopilotCodeReviewChecked));

export { handleCopilotCodeReview };
