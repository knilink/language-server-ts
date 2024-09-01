import { dedent } from 'ts-dedent';
import { Range, Position } from 'vscode-languageserver-types';

import { elidableTextForSourceCode } from "../../../../prompt/src/elidableText/fromSourceCode.ts";
import { ElidableText } from "../../../../prompt/src/elidableText/elidableText.ts";
import { TextDocument } from "../../textDocument.ts";

function isEmptyRange(range: Range) {
  return range.start.line == range.end.line && range.start.character == range.end.character;
}

class ElidableDocument {
  constructor(
    readonly doc: TextDocument,
    readonly selection?: Range,
    readonly visibleRange?: Range
  ) { }

  fromSelectedCode(options: { trimNewLines?: boolean }): [ElidableText, Range] {
    let expandedSelectionRange = this.getExpandedSelection();
    let trimmedSelectionRange = expandedSelectionRange;

    if (options.trimNewLines) {
      const selection = this.doc.getText(expandedSelectionRange);
      const leadingNewLines = (selection.match(/^\n*/) ?? [])[0]?.length ?? 0;
      const trailingNewLines = (selection.match(/\n*$/) ?? [])[0]?.length ?? 0;

      trimmedSelectionRange = {
        start: this.getLineStart(expandedSelectionRange.start.line + leadingNewLines),
        end: this.expandLineToEnd(expandedSelectionRange.end.line - trailingNewLines),
      };
    }

    const elidableSelection = new ElidableText([dedent(this.doc.getText(trimmedSelectionRange)).trim()]);

    return [this.wrapInTicks(elidableSelection), trimmedSelectionRange];
  }

  fromAllCode(options: { addLineNumbers?: boolean }): ElidableText {
    const documentRange = this.getDocumentRange();
    const expandedSelection = this.getExpandedSelection();
    let expandedVisibleRange = expandedSelection;

    // EDITED
    if (this.visibleRange && this.rangeContainedIn(this.visibleRange, expandedSelection)) {
      expandedVisibleRange = {
        start: this.getLineStart(this.visibleRange!.start.line),
        end: this.expandLineToEnd(this.visibleRange!.end.line),
      };
    }

    const beforeVisibleRange = {
      start: documentRange.start,
      end:
        expandedVisibleRange.start.line > 0
          ? this.expandLineToEnd(expandedVisibleRange.start.line - 1)
          : documentRange.start,
    };

    const beforeSelection = {
      start: expandedVisibleRange.start,
      end:
        expandedSelection.start.line > 0 && expandedSelection.start.line > expandedVisibleRange.start.line
          ? this.expandLineToEnd(expandedSelection.start.line - 1)
          : expandedVisibleRange.start,
    };

    const afterSelection = {
      start:
        expandedSelection.end.line < this.doc.lineCount - 1 &&
          expandedSelection.end.line < expandedVisibleRange.end.line
          ? this.getLineStart(expandedSelection.end.line + 1)
          : expandedVisibleRange.end,
      end: expandedVisibleRange.end,
    };

    const afterVisibleRange = {
      start:
        expandedVisibleRange.end.line < this.doc.lineCount - 1
          ? this.getLineStart(expandedVisibleRange.end.line + 1)
          : documentRange.end,
      end: documentRange.end,
    };

    const blocksWithWeights: [Range, number][] = [
      [beforeVisibleRange, 0.6],
      [beforeSelection, 0.8],
      [expandedSelection, 1],
      [afterSelection, 0.4],
      [afterVisibleRange, 0.2],
    ];

    const elidableCode = new ElidableText(
      blocksWithWeights
        .filter(([range, weight]) => !isEmptyRange(range) || weight === 1)
        .map(([range, weight]) => {
          let blockText = options.addLineNumbers ? this.addLineNumbers(range) : this.doc.getText(range);
          return [weight === 1 ? blockText : elidableTextForSourceCode(blockText), weight];
        })
    );

    return this.wrapInTicks(elidableCode);
  }

  selectionIsDocument(): boolean {
    return this.rangeEquals(this.getExpandedSelection(), this.getDocumentRange());
  }

  selectionIsEmpty(): boolean {
    return !this.selection || isEmptyRange(this.selection);
  }

  getExpandedSelection(): Range {
    return this.selection
      ? { start: this.getLineStart(this.selection.start.line), end: this.expandLineToEnd(this.selection.end.line) }
      : this.getDocumentRange();
  }

  getDocumentRange(): Range {
    return { start: this.getLineStart(0), end: this.expandLineToEnd(this.doc.lineCount - 1) };
  }

  private getLineStart(line: number): Position {
    return { line, character: 0 };
  }

  private expandLineToEnd(line: number): Position {
    if (line > this.doc.lineCount - 1) {
      line = this.doc.lineCount - 1;
    }
    const character = this.doc.lineAt({ line, character: 0 }).text.length;
    return { line, character };
  }

  private rangeContainedIn(containerRange: Range, range: Range): boolean {
    return containerRange.start.line <= range.start.line && containerRange.end.line >= range.end.line;
  }

  private rangeEquals(range: Range, otherRange: Range): boolean {
    return range.start.line === otherRange.start.line && range.end.line === otherRange.end.line;
  }

  wrapInTicks(code: ElidableText, codeWeight?: number): ElidableText {
    return new ElidableText([
      ['```' + this.doc.languageId, 1],
      [code, codeWeight ?? 1],
      ['```', 1],
    ]);
  }

  private addLineNumbers(range: Range): string {
    const lines = this.doc.getText(range).split('\n');
    const maxLineNumberLength = this.doc.lineCount.toString().length;
    return lines
      .map((line, index) => `${(range.start.line + index + 1).toString().padEnd(maxLineNumberLength, ' ')}:${line}`)
      .join('\n');
  }
}

export { isEmptyRange, ElidableDocument };
