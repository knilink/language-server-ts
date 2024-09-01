import { Context } from '../../../lib/src/context.ts';
import { CancellationToken } from '../cancellation.ts';

import { ensureAuthenticated } from '../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { MatchRequest, FileMatchRequest } from '../../../lib/src/snippy/snippy.proto.ts';
import { Match, FilesForMatch } from '../../../lib/src/snippy/index.ts';

const handleMatch = ensureAuthenticated(
  addMethodHandlerValidation(MatchRequest, async (ctx: Context, signal: CancellationToken, params: MatchRequest) => [
    await Match(ctx, params),
    null,
  ])
);

const handleFilesForMatch = ensureAuthenticated(
  addMethodHandlerValidation(
    FileMatchRequest,
    async (
      ctx: Context,
      signal: CancellationToken,
      params: FileMatchRequest
    ): Promise<[Awaited<ReturnType<typeof FilesForMatch>>, null]> => [await FilesForMatch(ctx, params), null]
  )
);

export { handleMatch, handleFilesForMatch };
