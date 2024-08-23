import type { Skill, LanguageId, Unknown, SkillId } from '../../types';

import { ProjectLabelsSkillId } from '../skills/ProjectLabelsSkill';
import { ProjectMetadataSkillId } from '../skills/ProjectMetadataSkill';
import { weighElidableList } from './elidableList';
import { mandatorySkills } from './conversationContextCollector';
import { ConversationSkillRegistry } from './conversationSkill';
import { conversationLogger } from '../logger';
import { ModelConfigurationProvider } from '../modelConfigurations';
import { getSupportedModelFamiliesForPrompt } from '../modelMetadata';
import { ConversationDumper } from '../dump';
import { Features } from '../../experiments/features';
import { ElidableText } from '../../../../prompt/src/elidableText';
import { TurnContext, ConversationAbortError } from '../turnContext';

import { getTokenizer } from '../../../../prompt/src/lib';

type SkillPromptOptions = { languageId?: LanguageId };

async function fromSkills(
  turnContext: TurnContext,
  promptOptions?: SkillPromptOptions
): Promise<[ElidableText | null, Unknown.SkillResolution[]]> {
  const [elidableSkills, nonElidableSkills, skillResolutions] = await handleSkillsInReverse(turnContext, promptOptions);
  return elidableSkills.length > 0 || nonElidableSkills.length > 0
    ? [
      new ElidableText([
        [new ElidableText(['Consider the additional context:']), 1],
        [weighElidableList(elidableSkills, 'inverseLinear'), 0.9],
        ...nonElidableSkills,
      ]),
      skillResolutions,
    ]
    : [null, skillResolutions];
}

async function handleSkillsInReverse(
  turnContext: TurnContext,
  promptOptions?: SkillPromptOptions
): Promise<[ElidableText.Chunk[], ElidableText.Chunk[], Unknown.SkillResolution[]]> {
  const skillResolutions: Unknown.SkillResolution[] = [];
  const elidableSkills: ElidableText.Chunk[] = [];
  const nonElidableSkills: ElidableText.Chunk[] = [];
  const reverseSkills = [...turnContext.turn.skills].reverse();

  for (const skill of reverseSkills) {
    if (!(await includeSkill(turnContext, skill.skillId, promptOptions?.languageId ?? ''))) continue;

    const [elidedSkill, resolution] = await safelyProcessSkill(turnContext, skill.skillId);

    if (elidedSkill) {
      if (mandatorySkills().includes(skill.skillId)) {
        elidableSkills.push(elidedSkill);
      } else {
        nonElidableSkills.push(elidedSkill);
      }
    }
    skillResolutions.push(resolution);
  }

  return [elidableSkills.reverse(), nonElidableSkills.reverse(), skillResolutions.reverse()];
}

async function safelyProcessSkill(
  turnContext: TurnContext,
  skillId: string
): Promise<[ElidableText.Chunk | undefined, Unknown.SkillResolution]> {
  const skill = turnContext.ctx.get(ConversationSkillRegistry).getSkill(skillId);
  try {
    const resolutionStart = Date.now();
    const resolvedSkill = await turnContext.skillResolver.resolve(skillId);
    const resolutionTimeMs = Date.now() - resolutionStart;

    if (resolvedSkill) {
      const processor = skill?.processor?.(turnContext);
      const processingStart = Date.now();
      const processedSkill = await processor?.processSkill(resolvedSkill, turnContext);
      const processingTimeMs = Date.now() - processingStart;

      return processedSkill
        ? await handleProcessedSkill(turnContext, skill, processor, processedSkill, resolutionTimeMs, processingTimeMs)
        : [
          undefined,
          await determineResolution(
            turnContext,
            skill,
            'unprocessable',
            undefined,
            resolutionTimeMs,
            processingTimeMs
          ),
        ];
    } else {
      return [undefined, await determineResolution(turnContext, skill, 'unresolvable', undefined, resolutionTimeMs)];
    }
  } catch (e: unknown) {
    conversationLogger.exception(turnContext.ctx, e, `Error while resolving skill ${skillId}`);
    if (e instanceof ConversationAbortError) throw e;
    return [undefined, await determineResolution(turnContext, skill, 'failed')];
  }
}

async function handleProcessedSkill(
  turnContext: TurnContext,
  skill: Skill.ISkillDescriptor | undefined,
  processor: Skill.ISkillProcessor<unknown> | undefined,
  processedSkill: string | ElidableText,
  resolutionTimeMs: number,
  processingTimeMs: number
): Promise<[ElidableText.Chunk, Unknown.SkillResolution]> {
  const elidableSkill = typeof processedSkill === 'string' ? new ElidableText([[processedSkill, 1]]) : processedSkill;
  return [
    [elidableSkill, processor?.value() ?? 0],
    await determineResolution(turnContext, skill, 'resolved', elidableSkill, resolutionTimeMs, processingTimeMs),
  ];
}

async function determineResolution(
  turnContext: TurnContext,
  skill: Skill.ISkillDescriptor | undefined,
  resolutionState: Unknown.SkillResolution['resolution'],
  elidableSkill?: ElidableText,
  resolutionTimeMs?: number,
  processingTimeMs?: number
): Promise<Unknown.SkillResolution> {
  const collectibles = turnContext.collector.collectiblesForSkill(skill?.id ?? 'unknown');
  const files = collectibles.filter((c) => c.type === 'file');
  const labels = collectibles.filter((c) => c.type === 'label').map((c) => c.label);
  const resolution: Unknown.SkillResolution = {
    skillId: skill?.id ?? 'unknown',
    resolution: resolutionState,
    labels,
    files,
    resolutionTimeMs,
    processingTimeMs,
  };

  if (elidableSkill) {
    const modelConfiguration = await turnContext.ctx
      .get(ModelConfigurationProvider)
      .getBestChatModelConfig(getSupportedModelFamiliesForPrompt('user'));
    const fullyProcessedSkill = elidableSkill.makePrompt(modelConfiguration.maxRequestTokens);
    resolution['tokensPreEliding'] = getTokenizer(modelConfiguration.tokenizer).tokenLength(fullyProcessedSkill);
  }
  turnContext.ctx.get(ConversationDumper).addResolution(turnContext.turn.id, resolution);
  return resolution;
}

async function includeSkill(turnContext: TurnContext, skillId: SkillId, languageId?: LanguageId): Promise<boolean> {
  if (skillId !== ProjectMetadataSkillId && skillId !== ProjectLabelsSkillId) return true;

  const features = turnContext.ctx.get(Features);
  const telemetryDataWithExp = await features.updateExPValuesAndAssignments(turnContext.ctx, { languageId });

  return features.ideChatEnableProjectMetadata(telemetryDataWithExp)
    ? skillId === ProjectMetadataSkillId
    : skillId === ProjectLabelsSkillId;
}

export { fromSkills, SkillPromptOptions };
