import { type Context } from '../context';
import { call } from './network';
import { assertShape } from '../util/typebox';
import { MatchRequest, MatchResponse, FileMatchRequest, FileMatchResponse } from './snippy.proto';

async function Match(ctx: Context, { source }: MatchRequest, signal?: AbortSignal): Promise<MatchResponse> {
  const result = await call(ctx, 'Match', { method: 'POST', body: assertShape(MatchRequest, { source }) }, signal);
  return assertShape(MatchResponse, result);
}

async function FilesForMatch(
  ctx: Context,
  { cursor }: FileMatchRequest,
  signal?: AbortSignal
): Promise<FileMatchResponse> {
  const result = await call(
    ctx,
    'FilesForMatch',
    { method: 'POST', body: assertShape(FileMatchRequest, { cursor }) },
    signal
  );
  return assertShape(FileMatchResponse, result);
}

export { Match, FilesForMatch };
