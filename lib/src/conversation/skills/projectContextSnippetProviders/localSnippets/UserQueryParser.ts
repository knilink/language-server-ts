import { Type } from '@sinclair/typebox';
import { type CancellationToken } from '../../../../../../agent/src/cancellation.ts';
import { type Context } from '../../../../context.ts';
import { ModelConfigurationProvider } from '../../../modelConfigurations.ts';
import { conversationLogger } from '../../../logger.ts';
import { ChatMLFetcher } from '../../../chatMLFetcher.ts';
import { Chat, Tool } from '../../../../types.ts';
import { ChatRole } from '../../../openai/openai.ts';
import { ChatModelFamily } from '../../../modelMetadata.ts';
import { createTelemetryWithExpWithId } from '../../../telemetry.ts';
import { telemetryException } from '../../../../telemetry.ts';
import { LocalSnippetProviderError } from './LocalSnippetProvider.ts';

const userQuerySystemPrompt = `
You are a coding assistant that helps developers find relevant code in their workspace by providing a list of relevant keywords they can search for.
The user will provide you with potentially relevant information from the workspace. This information may be incomplete.

# Additional Rules

Think step by step:
1. Read the user's question to understand what they are asking about their workspace.
2. If there are pronouns in the question, such as 'it', 'that', 'this', try to understand what they refer to by looking at the rest of the question and the conversation history.
3. Output a list of up to 8 relevant keywords that the user could search to answer their question. These keywords could be used as file names, symbol names, abbreviations, or comments in the relevant code. Put the keywords most relevant to the question first. Do not include overly generic keywords. Do not repeat keywords.
4. For each keyword in the list of relevant keywords, output a list of relevant variations of the keyword if applicable. Consider synonyms and plural forms. Do not include overly generic variations. Do not repeat variations.

# Example

User: Where is the code for base64 encoding?

Response:

queryWithKeywords([
    { "keyword": "base64 encoding", "variations": ["base64 encoder", "base64 encode"] },
    { "keyword": "base64", "variations": ["base 64"] },
    { "keyword": "encode", "variations": ["encoding", "encoded", "encoder", "encoders"] }
]);
`;

const tools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'queryWithKeywords',
      description:
        'Searches the workspace for synonyms and relevant keywords related to the original user query. These keywords could be used as file names, symbol names, abbreviations, or comments in the relevant code.',
      parameters: Type.Object({
        keywords: Type.Array(
          Type.Object({
            keyword: Type.String({
              description:
                'A keyword or phrase relevant to the original user query that a user could search to answer their question. Keywords are not generic and do not repeat.',
            }),
            variations: Type.Array(Type.String(), {
              description:
                'An array of relevant variations of the keyword. Variations include synonyms and plural forms. Variations are not generic and do not repeat.',
            }),
          })
        ),
      }),
    },
  },
];

async function parseUserQuery(
  ctx: Context,
  userQuery: string,
  token: CancellationToken
): Promise<string[] | undefined> {
  const fetcher = new ChatMLFetcher(ctx);
  const messages: Chat.ElidableChatMessage[] = [
    { role: ChatRole.System, content: userQuerySystemPrompt },
    { role: ChatRole.User, content: userQuery.toLowerCase() },
  ];
  const params: ChatMLFetcher.Params = {
    modelConfiguration: await ctx
      .get(ModelConfigurationProvider)
      .getBestChatModelConfig([ChatModelFamily.Gpt35turbo], { tool_calls: true }),
    uiKind: 'conversationPanel',
    messages: messages,
    tools,
    tool_choice: { type: 'function', function: { name: 'queryWithKeywords' } },
  };

  const fetchResult = await fetcher.fetchResponse(params, token, await createTelemetryWithExpWithId(ctx, '', ''));

  if (fetchResult.type === 'success' && fetchResult.toolCalls && fetchResult.toolCalls.length > 0) {
    const args = fetchResult.toolCalls[0].function.arguments.keywords;
    const keywordsSet = new Set<string>();
    for (let arg of args)
      if ((keywordsSet.add(arg.keyword.toLowerCase()), arg.variations))
        for (let variation of arg.variations) keywordsSet.add(variation.toLowerCase());
    const keywords = Array.from(keywordsSet);

    conversationLogger.debug(
      ctx,
      `UserQueryParser: Parsed ${keywords.length} keywords from the original user query: ${keywords.join(', ')}`
    );
    return keywords.length ? keywords : undefined;
  } else {
    const reason = 'reason' in fetchResult ? fetchResult.reason : '';
    telemetryException(
      ctx,
      new LocalSnippetProviderError(
        `Failed to request user query synonyms, result type: ${fetchResult.type}, reason: ${reason}`
      ),
      'LocalSnippetProvider.parseUserQuery'
    );
  }
}
export { parseUserQuery };
