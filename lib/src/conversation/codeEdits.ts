import { type TextDocument } from '../textDocument.ts';

type CodeEditMode = 'replace' | 'delete';

interface PartialCodeEdit {
  mode: CodeEditMode;
  codeblock: string;
  start: number;
  end: number;
}

type Document = {
  text: string;
  uri: string;
};

type CodeEdit = {
  mode: CodeEditMode;
  codeblock: string;
  start: number;
  end: number;
  updatedDocument: Document;
};

const rawTripleBacktick = '```';
const markdownCommentRegexp = String.raw`<!-- (?<mode>[\w-]+) lines? (?<start>\d+)(?: to (?<end>\d+))? -->`;
const codeblockRegexp = String.raw`${rawTripleBacktick}[\w]*?\n(?<codeblock>[\s\S]*?)\n${rawTripleBacktick}`;
const taggedCodeblockRegexp = new RegExp(`${markdownCommentRegexp}\n${codeblockRegexp}`, 'gs');
const codeEditModes: CodeEditMode[] = ['replace', 'delete'];

function isCodeEditMode(mode: string): mode is CodeEditMode {
  return codeEditModes.some((a) => a === mode);
}

function getIndentation(str: string): string {
  return str.match(/^\s*/)?.[0] ?? '';
}

function extractEditsFromTaggedCodeblocks(responseText: string, doc: TextDocument): CodeEdit[] {
  let matchesIter = responseText.matchAll(taggedCodeblockRegexp);

  const matches = Array.from(matchesIter);
  const edits: CodeEdit[] = [];

  for (let match of matches) {
    const matchGroups = match.groups;
    if (!matchGroups || !isCodeEditMode(matchGroups.mode)) continue;

    const start = matchGroups.start ? parseInt(matchGroups.start) - 1 : -1;
    const end = matchGroups.end ? parseInt(matchGroups.end) - 1 : start;
    let codeblockLines = matchGroups.codeblock.split('\n');
    const firstLineIndentation = getIndentation(codeblockLines[0]).length;

    codeblockLines = codeblockLines.map((line) => line.slice(firstLineIndentation));

    const partialCodeEdit: PartialCodeEdit = {
      mode: matchGroups.mode,
      codeblock: codeblockLines.join('\n'),
      start,
      end,
    };

    const updatedDocumentText = applyEditsToDocument([partialCodeEdit], doc);
    if (!updatedDocumentText) continue;

    const updatedDocument: Document = { text: updatedDocumentText, uri: doc.uri };
    edits.push({ ...partialCodeEdit, updatedDocument });
  }

  return edits;
}

function applyEditsToDocument(edits: PartialCodeEdit[], currentDocument: TextDocument): string | undefined {
  if (edits.length === 0) {
    return;
  }
  edits.sort((a, b) => (a.start !== b.start ? b.start - a.start : b.end - a.end));
  let documentRows = currentDocument.getText().split(`\n`);
  for (let edit of edits) {
    let start = edit.start;
    let end = edit.end;
    let mode = edit.mode;

    let codeblockRows = edit.codeblock.split(`\n`);

    if (!(start < 0 || end < 0 || end < start) && !(start >= documentRows.length || end >= documentRows.length)) {
      if (mode === 'delete') {
        documentRows.splice(start, end - start + 1);
      } else if (mode === 'replace') {
        let indentation = documentRows[start].match(/^\s*/)?.[0] ?? '';
        codeblockRows.forEach((line, index) => {
          codeblockRows[index] = indentation + line;
        });
        documentRows.splice(start, end - start + 1, ...codeblockRows);
      }
    }
  }
  return documentRows.join(`\n`);
}

export { extractEditsFromTaggedCodeblocks, applyEditsToDocument, CodeEdit, codeEditModes, markdownCommentRegexp };
