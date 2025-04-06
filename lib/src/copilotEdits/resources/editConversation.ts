import type { FileReference } from '../../conversation/schema.ts';

import { v4 as uuidv4 } from 'uuid';
import { EditTurnNotFoundException } from '../exceptions/editTurnNotFoundException.ts';
import { CopilotTextDocument } from '../../textDocument.ts';

class EditTurn {
  id = uuidv4();
  timestamp = Date.now();

  status: // ../services/copilotEditsService.ts
  'success' | 'in-progress' | 'cancelled' = 'in-progress';
  // ./editTurnContext.ts
  workingSet: FileReference[] = [];
  // ../services/copilotEditsService.ts
  workspaceFolder?: string;

  // ../../../../agent/src/methods/copilotEdits/editConversationCreate.ts
  response?: { message: string; type: 'model' };

  constructor(
    readonly request: {
      // ../services/copilotEditsService.ts
      message: string;
      // ../../../../agent/src/methods/copilotEdits/editConversationTurn.ts
      type: 'user';
    },
    workingSet?: FileReference[]
  ) {
    if (workingSet && workingSet.length > 0) {
      this.workingSet = workingSet;
    }
  }
}

class EditTurnManager {
  constructor(public turns: EditTurn[] = []) {}

  addTurn(turn: EditTurn) {
    this.turns.push(turn);
  }
  deleteTurn(turnId: string) {
    this.turns = this.turns.filter((turn) => turn.id !== turnId);
  }
  getLastTurn() {
    if (this.turns.length !== 0) {
      return this.turns[this.turns.length - 1];
    }
  }
  hasTurn(turnId: string) {
    return this.turns.some((turn) => turn.id === turnId);
  }
  getTurns() {
    return [...this.turns];
  }
}

class EditConversation {
  _id = uuidv4();
  _timestamp = Date.now();
  turnsManager: EditTurnManager;

  constructor(
    turns = [],
    readonly source: 'panel' = 'panel',
    readonly userLanguage = 'en'
  ) {
    this.turnsManager = new EditTurnManager(turns);
  }

  get id() {
    return this._id;
  }

  get timestamp() {
    return this._timestamp;
  }

  getUserLanguage() {
    return this.userLanguage;
  }

  getTurns() {
    return this.turnsManager.getTurns();
  }

  getSource() {
    return this.source;
  }

  addTurn(turn: EditTurn) {
    this.turnsManager.addTurn(turn);
  }

  deleteTurn(turnId: string) {
    this.turnsManager.deleteTurn(turnId);
  }

  getLastTurn() {
    let lastTurn = this.turnsManager.getLastTurn();
    if (lastTurn === undefined) {
      throw new EditTurnNotFoundException(`No turns in the conversation ${this._id}`);
    }
    return lastTurn;
  }

  hasTurn(turnId: string) {
    return this.turnsManager.hasTurn(turnId);
  }
}

export { EditConversation, EditTurn };
