import { URI } from 'vscode-uri';
import { dump as yamlDump } from 'js-yaml';
import { dedent } from 'ts-dedent';

import { PromptType, SkillId, TurnId, Unknown } from '../types.ts';
import { localAgents } from './agents/agents.ts';
import { Conversation, Turn } from './conversation.ts';
import { TurnContext } from './turnContext.ts';
import { CancellationToken } from '../../../agent/src/cancellation.ts';

import { Context } from '../context.ts';
import { logger } from '../logger.ts';
import { EditorAndPluginInfo } from '../config.ts';
import { ConversationSkillRegistry } from './prompt/conversationSkill.ts';
import { Conversations } from './conversations.ts';
import { TextDocumentManager } from '../textDocumentManager.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { SkillMap } from './skills/skillMap.ts';

function filterConversationTurns(conversation: Conversation): Conversation {
  let conversationCopy = conversation.copy();
  conversationCopy.turns = conversationCopy.turns.filter((turn: Turn) => {
    return turn.status !== 'in-progress' && (turn.response === undefined || turn.response?.type === 'model');
  });
  return conversationCopy;
}

function getLastTurnId(conversation: Conversation): string | undefined {
  return filterConversationTurns(conversation).getLastTurn()?.id;
}

async function getConversationDump(turnContext: TurnContext) {
  let filteredConversation = filterConversationTurns(turnContext.conversation),
    lastTurnId = getLastTurnId(turnContext.conversation);

  if (!lastTurnId) return 'Nothing to dump because no request has been sent to the model yet.';

  let dump = turnContext.ctx.get(ConversationDumper).getDump(lastTurnId),
    yml = toSimulationFormat(dump, filteredConversation.turns);

  logger.debug(turnContext.ctx, `conversation.dump`, `${yml}`);

  let files = await fileDump(dump, turnContext.ctx);

  return `
${getInfoDumpMessage(turnContext.conversation, lastTurnId)}
${getEditorInfoDumpMessage(turnContext.ctx)}

The following code can be copied into a chat simulation \`yml\` file. This response has not polluted the conversation history and did not cause any model roundtrip.
\`\`\`yaml
${yml}
\`\`\`${files || ''}
    `;
}

function getEditorInfoDumpMessage(ctx: Context): string {
  let info = ctx.get(EditorAndPluginInfo);
  return `
- IDE: \`${info.getEditorInfo().name} (${info.getEditorInfo().version})\`
- Plugin: \`${info.getEditorPluginInfo().version}\`
    `;
}

function getInfoDumpMessage(conversation: Conversation, lastTurnId: string): string {
  return `
Debug information for the last turn of the conversation.

- ConversationId: \`${conversation.id}\`
- MessageId: \`${lastTurnId}\`
    `;
}

async function getSkillsDump(
  turnContext: TurnContext,
  cancellationToken: CancellationToken,
  skillId?: string
): Promise<string> {
  const skillRegistry = turnContext.ctx.get(ConversationSkillRegistry);
  let resp = '# Available skills';
  let supportedSkills = skillRegistry
    .getDescriptors()
    .filter((s) => turnContext.ctx.get(Conversations).getSupportedSkills(turnContext.conversation.id).includes(s.id));
  if (skillId) supportedSkills = supportedSkills.filter((s) => s.id === skillId);
  else {
    let localAgentsSkills = (await Promise.all(localAgents.map((a) => a.additionalSkills(turnContext.ctx)))).flat();
    supportedSkills = supportedSkills.filter((s) => !localAgentsSkills.includes(s.id));
  }
  if (supportedSkills.length === 0) return `No skill with id ${skillId} available`;
  for (let skill of supportedSkills)
    resp += `
    - ${skill.id}`;

  if (turnContext.turn.request.message && turnContext.turn.request.message.trim().length > 0) {
    resp += `

        **User message**: ${turnContext.turn.request.message}`;
  }

  for (let skill of supportedSkills) {
    resp += `
        ## ${skill.id}`;

    resp += dedent`
                    \n\n
                    **Description**

                    ${skill.description()}`;

    let skillProperties = skillRegistry.getSkill(skill.id);
    let skillResolution = await skillProperties?.resolver(turnContext).resolveSkill(turnContext);
    if (skillResolution) {
      resp += dedent`
                        \n\n
                        **Resolution**

                        \`\`\`yaml
                        ${yamlDump(skillResolution)}
                        \`\`\``;
      let processedSkill = await skillProperties?.processor(turnContext).processSkill(skillResolution, turnContext);
      if (processedSkill) {
        let processedSkillValue = typeof processedSkill == 'string' ? processedSkill : processedSkill.makePrompt(1e3);
        resp += dedent`
                            \n\n
                            **Processed value**

                            ${processedSkillValue}`;
      } else
        resp += `

        **Unprocessable**`;
    } else
      resp += `

        **Unresolvable**`;
  }
  return resp;
}

function toSimulationFormat<T = SkillMap>(dump: SkillDump<T>, turns: Turn[]): string {
  let ymlDump = {
    state: { skills: dump.resolvedSkills },
    turns: turns.map((t: Turn) => {
      if (t.response) return { request: t.request.message, response: t.response.message };
      return { request: t.request.message };
    }),
  };
  return yamlDump(ymlDump);
}

async function fileDump<T = SkillMap>(dump: SkillDump<T>, ctx: Context): Promise<string | undefined> {
  const files = dump.resolutions.map((resolution) => resolution.files).flat();
  const uniqueFiles = files.filter((file, index) => file && files.indexOf(file) === index);
  let fileDump: string | undefined;

  for (let file of uniqueFiles) {
    if (file && file.status === 'included') {
      fileDump ||= `The following files have been used:`;
      const document = await ctx.get(TextDocumentManager).getTextDocument(file);
      const text = document?.getText();

      logger.debug(ctx, `conversation.dump.file`, text);
      fileDump += `
**${file.uri}**

\`\`\`${document?.languageId}
${text}
\`\`\``;
    }
  }

  return fileDump;
}

class SkillDump<T extends Record<keyof T & SkillId, any>> {
  resolvedSkills: Partial<T> = {};
  resolutions: Unknown.SkillResolution[] = [];
}

class ConversationDumper<T extends Record<keyof T & SkillId, any> = SkillMap> {
  dump = new LRUCacheMap<string, SkillDump<T>>(25);
  promptsDump = new LRUCacheMap<TurnId, Map<PromptType, string>>(1);

  addResolvedSkill<K extends keyof T & SkillId>(turnId: TurnId, skillId: K, resolvedSkill: T[K]) {
    let dump = this.getDump(turnId);
    dump.resolvedSkills[skillId] = resolvedSkill;
  }

  getResolvedSkill<K extends keyof T & SkillId>(turnId: TurnId, skillId: K): T[K] | undefined {
    return this.getDump(turnId).resolvedSkills[skillId];
  }

  addResolution(turnId: TurnId, resolution: Unknown.SkillResolution) {
    this.getDump(turnId).resolutions.push(resolution);
  }

  getDump(turnId: TurnId): SkillDump<T> {
    let dump = this.dump.get(turnId);
    if (!dump) {
      dump = new SkillDump();
      this.dump.set(turnId, dump);
    }
    return dump;
  }

  addPrompt(
    turnId: TurnId,
    // string ./prompt/conversationPromptEngine.ts
    prompt: string,
    promptType: PromptType
  ) {
    let promptDump = this.promptsDump.get(turnId);
    if (!promptDump) {
      promptDump = new Map();
      this.promptsDump.set(turnId, promptDump);
    }
    promptDump.set(promptType, prompt);
  }

  // Map<string, string> ./promptDebugTemplates.ts
  getLastTurnPrompts(): Map<PromptType, string> | undefined {
    if (!this.promptsDump) return;
    let promptsDumpIterator = this.promptsDump.values().next();
    if (promptsDumpIterator.done) return;
    return promptsDumpIterator.value;
  }
}

export {
  filterConversationTurns,
  getLastTurnId,
  toSimulationFormat,
  fileDump,
  getInfoDumpMessage,
  getEditorInfoDumpMessage,
  getConversationDump,
  getSkillsDump,
  ConversationDumper,
};
