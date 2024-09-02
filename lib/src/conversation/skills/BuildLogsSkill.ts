import { Type, type Static } from '@sinclair/typebox';
import { Skill } from '../../types.ts';
import { SingleStepReportingSkill } from '../prompt/conversationSkill.ts';
import { type TurnContext } from '../turnContext.ts';

const BuildLogsSchema = Type.String();

type BuildLogs = Static<typeof BuildLogsSchema>;

class BuildLogsSkillProcessor implements Skill.ISkillProcessor<string> {
  constructor(readonly turnContext: TurnContext) {}

  value(): number {
    return 0.9;
  }

  async processSkill(skill: string): Promise<string> {
    const context = this.turnContext;
    context.collectLabel(BuildLogsSkillId, 'build logs');
    return `The contents of the application build logs:\n\`\`\`\n${skill}\n\`\`\``;
  }
}

const BuildLogsSkillId: 'build-logs' = 'build-logs';

class BuildLogsSkill extends SingleStepReportingSkill<typeof BuildLogsSkillId, BuildLogs> {
  constructor(_resolver: Skill.ISkillResolver<BuildLogs>) {
    super(
      BuildLogsSkillId,
      'The application build logs, which can be used to fix build or compilation errors.',
      'Reading build logs',
      () => _resolver,
      (turnContext: TurnContext): BuildLogsSkillProcessor => new BuildLogsSkillProcessor(turnContext)
    );
  }
}

export { BuildLogsSchema, BuildLogsSkillProcessor, BuildLogsSkillId, BuildLogsSkill };
