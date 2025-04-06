import { Range } from 'vscode-languageserver-types';
import { TelemetryData } from '../telemetry.ts';
import { CopilotTextDocument } from '../textDocument.ts';
import { Position } from 'vscode-languageserver-types';

function positionAndContentForCompleting(
  telemetryData: TelemetryData,
  textDocument: CopilotTextDocument,
  { range, text }: { range: Range; text: string }
): { position: Position; textDocument: CopilotTextDocument; lineLengthIncrease: number } {
  let lineLengthIncrease = 0;
  const position = { ...range.end };

  if (text.length > 0) {
    textDocument = CopilotTextDocument.withChanges(textDocument, [{ range, text }], textDocument.version);
    position.character = range.start.character + text.length;
    lineLengthIncrease = text.length - (range.end.character - range.start.character);
    telemetryData.properties.completionsActive = 'true';
  }

  return { position, textDocument, lineLengthIncrease };
}

export { positionAndContentForCompleting };
