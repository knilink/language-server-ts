import { Position } from 'vscode-languageserver-types';
import { URI } from 'vscode-uri';

import { EventEmitter } from 'events';
import { Context } from './context';
import { TelemetryWithExp } from './telemetry';

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

class PostInsertionNotifier extends EventEmitter<{ onPostInsertion: [PostInsertionEvent] }> { }

export { PostInsertionNotifier };
