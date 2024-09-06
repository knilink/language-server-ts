import { Position } from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';

import { EventEmitter } from 'node:events';
import { Context } from './context.ts';
import { TelemetryWithExp } from './telemetry.ts';

type PostInsertionEvent = {
  ctx: Context;
  insertionCategory: string;
  insertionOffset: number;
  fileURI: URI;
  completionText: string;
  telemetryData: TelemetryWithExp;
  completionId: string;
  // ./postInsertion.ts
  start: Position;
};

class PostInsertionNotifier extends EventEmitter<{ onPostInsertion: [PostInsertionEvent] }> {}

export { PostInsertionNotifier };
