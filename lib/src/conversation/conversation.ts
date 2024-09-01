import type { Reference } from "./schema.ts";

import { Unknown } from "../types.ts";
import { v4 as uuidv4 } from 'uuid';

class Turn {
  id: string = uuidv4();
  timestamp: number = Date.now();
  status:
    | 'success'
    | 'in-progress'
    | 'error'
    | 'cancelled' // lib/src/conversation/extensibility/remoteAgentTurnProcessor.ts
    | 'filtered' // lib/src/conversation/promptDebugTemplates.ts
    | 'off-topic' = 'in-progress'; // lib/src/conversation/fetchPostProcessor.ts
  // ./turnProcessor.js
  // this.turn.skills = promptContext.skillIds.map((skill) => ({ skillId: skill }))
  skills: (Pick<Unknown.SkillResolution, 'skillId'> & Partial<Unknown.SkillResolution>)[] = [];
  // ./skills/ReferencesSkill.ts
  // ./conversations.ts
  references: Reference[] = [];
  annotations: Unknown.Annotation[] = [];

  ////////////////////////////////////////////////////////////////////////////////

  // ./conversation.ts
  // string ./skills/projectContextSnippetProviders/localSnippets/LocalSnippetProvider.ts
  workspaceFolder?: string;
  // ./conversation.ts
  agent?: { agentSlug: string };
  // required ./turnProcessor.ts
  // set ./conversations.ts
  template?: { templateId: string; userQuestion: string };
  // lib/src/conversation/extensibility/remoteAgentTurnProcessor.ts
  // ./fetchPostProcessor.ts
  response?: { message: string; type: 'meta' | 'server' | 'model' | 'user' | 'offtopic-detection' };

  constructor(
    // editable ./conversations.ts
    public request: {
      message: string;
      type:
      | 'user'
      | 'template'
      // ./turnProcessor.ts
      | 'follow-up';
    }
  ) { }
}

class Conversation {
  private _id: string;
  private _timestamp: number;

  constructor(
    public turns: Turn[] = [],
    readonly source:
      | 'panel'
      // ./skills/CurrentEditorSkill.ts
      | 'inline' = 'panel'
  ) {
    this._id = uuidv4();
    this._timestamp = Date.now();
  }

  copy(): Conversation {
    const turnsCopy = JSON.parse(JSON.stringify(this.turns)) as Turn[];
    const conversationCopy = new Conversation(turnsCopy, this.source);
    conversationCopy._id = this.id;
    conversationCopy._timestamp = this.timestamp;
    return conversationCopy;
  }

  get id(): string {
    return this._id;
  }

  get timestamp(): number {
    return this._timestamp;
  }

  addTurn(turn: Turn): void {
    this.turns.push(turn);
  }

  deleteTurn(turnId: string): void {
    this.turns = this.turns.filter((turn) => turn.id !== turnId);
  }

  // ./dump.ts
  // not nil ./prompt/strategies/metaPromptStrategy.ts
  getLastTurn(): Turn {
    return this.turns[this.turns.length - 1]; // MARK not sure why it doens't complain about undefined
  }

  hasTurn(turnId: string): boolean {
    return this.turns.some((turn) => turn.id === turnId);
  }
}

export { Turn, Conversation, Reference };
