import { Context } from '../../../lib/src/context';
import { CancellationToken } from '../cancellation';

import { ensureAuthenticated } from '../auth/authDecorator';
import { addMethodHandlerValidation } from '../schemaValidation';
import { MatchRequest, FileMatchRequest } from '../../../lib/src/snippy/snippy.proto';
import { Match, FilesForMatch } from '../../../lib/src/snippy/index';

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
