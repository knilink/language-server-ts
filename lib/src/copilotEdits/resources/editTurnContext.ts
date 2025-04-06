import { DocumentUri } from 'vscode-languageserver-types';
import type { Context } from '../../context.ts';
import { CopilotEditsPromptUriUtils } from '../prompts/promptUriUtils.ts';
import { EditConversation, EditTurn } from './editConversation.ts';

class EditTurnContext {
  workingSetUriToPathMap: Map<DocumentUri, string> = new Map();

  constructor(
    readonly ctx: Context,
    readonly editConversation: EditConversation,
    readonly currentTurn: EditTurn,
    readonly partialResultToken: unknown,
    readonly userSelectedModel: unknown
  ) {
    for (const file of currentTurn.workingSet) {
      this.workingSetUriToPathMap.set(file.uri, CopilotEditsPromptUriUtils.uriToPath(file.uri));
    }
  }

  get editTurnId() {
    return this.currentTurn.id;
  }

  get editConversationId() {
    return this.editConversation.id;
  }

  mapToUriInWorkingSet(path: string) {
    for (let [uri, p] of this.workingSetUriToPathMap)
      if (p === path) {
        return uri;
      }
  }
}

export { EditTurnContext };
