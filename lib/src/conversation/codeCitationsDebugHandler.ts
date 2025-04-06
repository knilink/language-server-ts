import { Unknown } from '../types.ts';

const DebugCodeCitation: Unknown.Annotation = {
  id: 0,
  start_offset: 0,
  stop_offset: 0,
  type: 'ip_code_citations',
  // MARK details.citations may not be nullable,
  // details: citation.details.citations at ../postInsertion.ts
  // citation.details.map at ../../../agent/src/citationManager.ts
  details: {} as never,
  citations: {
    snippet: `html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Canvas Example</title>
<`,
    url: 'https://github.com/duonghle285/gnoud9x.github.io/tree/c95127bc5b7a491d9223f21ac3b8c5100996e754/26062020-vehinhchunhat%2Findex.html',
    ip_type: 'LICENSE',
    license: 'NOASSERTION',
  },
};

const DebugCodeCitationDefaultReply = 'Alright, This response contains a code citation.';

export { DebugCodeCitation, DebugCodeCitationDefaultReply };
