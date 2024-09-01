import { Type, type Static } from '@sinclair/typebox';

import { Skill } from "../../types.ts";

import { IProjectMetadataLookup } from "./ProjectMetadataLookups.ts";

import { getMetadataLookup, determineProgrammingLanguage } from "./ProjectMetadata.ts";
import { ElidableText } from "../../../../prompt/src/elidableText/elidableText.ts";
import { TurnContext } from "../turnContext.ts";

const ProjectMetadataSkillId: 'project-metadata' = 'project-metadata';

const DependencySchema = Type.Object({
  name: Type.String(),
  version: Type.Optional(Type.String()),
});

const ProjectMetadataSchema = Type.Object({
  language: Type.Object({
    id: Type.String(),
    name: Type.String(),
    version: Type.Optional(Type.String()),
  }),
  libraries: Type.Array(DependencySchema),
  buildTools: Type.Array(DependencySchema),
});

type Dependency = Static<typeof DependencySchema>;
type ProjectMetadata = Static<typeof ProjectMetadataSchema>;

class ProjectMetadataSkillProcessor implements Skill.ISkillProcessor<ProjectMetadata> {
  constructor(readonly turnContext: TurnContext) { }

  value() {
    return 1;
  }

  async processSkill(skill: ProjectMetadata): Promise<ElidableText> {
    const chunks: [ElidableText, number][] = [];
    chunks.push([new ElidableText([`The user is working on a project with the following characteristics:`]), 1]);

    const lookup = getMetadataLookup(skill.language.id);
    this.addProgrammingLanguage(skill, chunks);
    this.addBuildTools(skill, chunks, lookup);
    this.addApplicationFramework(skill, chunks, lookup);
    this.addCoreLibraries(skill, chunks, lookup);
    this.addTestingFrameworks(skill, chunks, lookup);
    this.addTestingLibraries(skill, chunks, lookup);

    return new ElidableText(chunks);
  }

  addProgrammingLanguage(skill: ProjectMetadata, chunks: [ElidableText, number][]) {
    const language = determineProgrammingLanguage(skill);
    this.turnContext.collectLabel(ProjectMetadataSkillId, language);
    chunks.push([new ElidableText([`- programming language: ${language}`]), 1]);
  }

  addBuildTools(skill: ProjectMetadata, chunks: [ElidableText, number][], lookup: IProjectMetadataLookup) {
    this.addToPrompt(chunks, '- build tools:', lookup.determineBuildTools(skill));
  }

  addApplicationFramework(skill: ProjectMetadata, chunks: [ElidableText, number][], lookup: IProjectMetadataLookup) {
    this.addToPrompt(chunks, '- application frameworks:', lookup.determineApplicationFrameworks(skill));
  }

  addCoreLibraries(skill: ProjectMetadata, chunks: [ElidableText, number][], lookup: IProjectMetadataLookup) {
    this.addToPrompt(chunks, '- core libraries:', lookup.determineCoreLibraries(skill));
  }

  addTestingFrameworks(skill: ProjectMetadata, chunks: [ElidableText, number][], lookup: IProjectMetadataLookup) {
    this.addToPrompt(chunks, '- testing frameworks:', lookup.determineTestingFrameworks(skill));
  }

  addTestingLibraries(skill: ProjectMetadata, chunks: [ElidableText, number][], lookup: IProjectMetadataLookup) {
    this.addToPrompt(chunks, '- testing libraries:', lookup.determineTestingLibraries(skill));
  }

  private addToPrompt(chunks: [ElidableText, number][], description: string, dependencies: Dependency[]) {
    if (dependencies.length > 0) {
      dependencies.forEach((dep) => {
        this.turnContext.collectLabel(ProjectMetadataSkillId, `${dep.name}${dep.version ? ' ' + dep.version : ''}`);
      });

      const dependenciesList = dependencies
        .map((dep) => `  - ${dep.name}${dep.version ? ' ' + dep.version : ''}`)
        .join('\n');

      chunks.push([new ElidableText([`${description}\n${dependenciesList}`]), 1]);
    }
  }
}

class ProjectMetadataSkill implements Skill.ISkill<typeof ProjectMetadataSkillId, ProjectMetadata> {
  readonly id = ProjectMetadataSkillId;
  readonly type = 'explicit';

  constructor(private _resolver: Skill.ISkillResolver<ProjectMetadata>) { }

  description(): string {
    return 'The characteristics of the project the developer is working on (languages, frameworks)';
  }

  resolver() {
    return this._resolver;
  }

  processor(turnContext: TurnContext): ProjectMetadataSkillProcessor {
    return new ProjectMetadataSkillProcessor(turnContext);
  }
}

export {
  ProjectMetadataSchema,
  ProjectMetadataSkillProcessor,
  ProjectMetadataSkillId,
  ProjectMetadataSkill,
  ProjectMetadata,
  Dependency,
};
