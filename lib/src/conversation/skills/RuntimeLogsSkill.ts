import { Type } from '@sinclair/typebox';
import { SingleStepReportingSkill } from '../prompt/conversationSkill';
import { TurnContext } from '../turnContext';
import { Skill } from '../../types';

const RuntimeLogsSchema = Type.String();

class RuntimeLogsSkillProcessor implements Skill.ISkillProcessor<string> {
  constructor(readonly turnContext: TurnContext) { }

  value(): number {
    return 0.9;
  }

  async processSkill(skillContent: string): Promise<string> {
    this.turnContext.collectLabel('runtime-logs', 'runtime logs');
    return `The contents of the application runtime logs:\n\`\`\`\n${skillContent}\n\`\`\``;
  }
}

const RuntimeLogsSkillId: 'runtime-logs' = 'runtime-logs';

class RuntimeLogsSkill extends SingleStepReportingSkill<typeof RuntimeLogsSkillId, string> {
  constructor(_resolver: Skill.ISkillResolver<string>) {
    super(
      RuntimeLogsSkillId,
      'The application runtime or debug logs, which are used to view output logs from the console. This is useful for debugging and troubleshooting runtime issues.',
      'Reading runtime logs',
      () => _resolver,
      (turnContext: TurnContext) => new RuntimeLogsSkillProcessor(turnContext) // TODO: resolve type RuntimeLogsSkillProcessor.processSkill
    );
  }
}

export { RuntimeLogsSchema, RuntimeLogsSkillId, RuntimeLogsSkillProcessor, RuntimeLogsSkill };
