import { Type, Optional, type Static } from '@sinclair/typebox';

const MatchError = Type.Object({
  kind: Type.Literal('failure'),
  reason: Type.String(),
  code: Type.Number(),
  msg: Type.String(),
  meta: Optional(Type.Any()),
});
type MatchError = Static<typeof MatchError>;

const Snippet = Type.Object({
  matched_source: Type.String(),
  occurrences: Type.String(),
  capped: Type.Boolean(),
  cursor: Type.String(),
  github_url: Type.String(),
});
type Snippet = Static<typeof Snippet>;

const MatchRequest = Type.Object({ source: Type.String() });
type MatchRequest = Static<typeof MatchRequest>;

const MatchSuccess = Type.Object({ snippets: Type.Array(Snippet) });
type MatchSuccess = Static<typeof MatchSuccess>;

const MatchResponse = Type.Union([MatchSuccess, MatchError]);
type MatchResponse = Static<typeof MatchResponse>;

const FileMatchRequest = Type.Object({ cursor: Type.String() });
type FileMatchRequest = Static<typeof FileMatchRequest>;

const FileMatch = Type.Object({
  commit_id: Type.String(),
  license: Type.String(),
  nwo: Type.String(),
  path: Type.String(),
  url: Type.String(),
});
type FileMatch = Static<typeof FileMatch>;

const PageInfo = Type.Object({ has_next_page: Type.Boolean(), cursor: Type.String() });
type PageInfo = Static<typeof PageInfo>;

const LicenseStats = Type.Object({ count: Type.Record(Type.String(), Type.String()) });
type LicenseStats = Static<typeof LicenseStats>;

const FileMatchSuccess = Type.Object({
  file_matches: Type.Array(FileMatch),
  page_info: PageInfo,
  license_stats: LicenseStats,
});
type FileMatchSuccess = Static<typeof FileMatchSuccess>;

const FileMatchResponse = Type.Union([FileMatchSuccess, MatchError]);
type FileMatchResponse = Static<typeof FileMatchResponse>;

export {
  MatchError,
  Snippet,
  MatchRequest,
  MatchSuccess,
  MatchResponse,
  FileMatchRequest,
  FileMatch,
  PageInfo,
  LicenseStats,
  FileMatchSuccess,
  FileMatchResponse,
};
