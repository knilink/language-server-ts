import { Type, type Static } from '@sinclair/typebox';
import { Skill } from "../../types.ts";
import { TurnContext } from "../turnContext.ts";

import { ElidableText } from "../../../../prompt/src/elidableText/elidableText.ts";

const ProjectLabelsSkillId: 'project-labels' = 'project-labels';

const ProjectLabelsSchema = Type.Object({ labels: Type.Array(Type.String()) });

type ProjectLabelsType = Static<typeof ProjectLabelsSchema>;

class ProjectLabelsSkillProcessor implements Skill.ISkillProcessor<ProjectLabelsType> {
  constructor(private turnContext: TurnContext) { }

  value(): number {
    return 1;
  }

  async processSkill(skill: ProjectLabelsType): Promise<ElidableText> {
    const chunks: [ElidableText, number][] = [];

    chunks.push([
      new ElidableText([
        'The developer is working on a project with the following characteristics (languages, frameworks):',
      ]),
      1,
    ]);

    skill.labels.forEach((label) => {
      chunks.push([new ElidableText([`- ${label}`]), 0.9]);
      this.turnContext.collectLabel(ProjectLabelsSkillId, label);
    });

    return new ElidableText(chunks);
  }
}

class ProjectLabelsSkill {
  readonly id = ProjectLabelsSkillId;
  readonly type = 'explicit';

  constructor(private _resolver: Skill.ISkillResolver<ProjectLabelsType>) { }

  description(): string {
    return 'The characteristics of the project the developer is working on (languages, frameworks)';
  }

  resolver(): Skill.ISkillResolver<ProjectLabelsType> {
    return this._resolver;
  }

  processor(turnContext: TurnContext): ProjectLabelsSkillProcessor {
    return new ProjectLabelsSkillProcessor(turnContext);
  }
}

export {
  ProjectLabelsSchema,
  ProjectLabelsType,
  ProjectLabelsSkillProcessor,
  ProjectLabelsSkillId,
  ProjectLabelsSkill,
};
