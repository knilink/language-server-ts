import { DocumentUri, Position } from 'vscode-languageserver-types';

import { EventEmitter } from 'node:events';
import { Context } from './context.ts';
import { TelemetryWithExp } from './telemetry.ts';

type PostInsertionEvent = {
  ctx: Context;
  insertionCategory: string;
  insertionOffset: number;
  uri: DocumentUri;
  completionText: string;
  telemetryData: TelemetryWithExp;
  // ./postInsertion.ts
  start: Position;
};

class PostInsertionNotifier extends EventEmitter<{ onPostInsertion: [PostInsertionEvent] }> {}

export { PostInsertionNotifier };
