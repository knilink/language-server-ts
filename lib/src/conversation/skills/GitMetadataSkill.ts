import { Type, type Static } from '@sinclair/typebox';

import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';
import { SingleStepReportingSkill } from '../prompt/conversationSkill.ts';
import { Skill } from '../../types.ts';
import { TurnContext } from '../turnContext.ts';

const RemoteSchema = Type.Object({
  name: Type.String(),
  url: Type.String(),
});

const GitMetadataSchema = Type.Object({
  path: Type.String(),
  head: Type.Optional(Type.Object({ name: Type.String(), upstream: Type.Optional(RemoteSchema) })),
  remotes: Type.Optional(Type.Array(RemoteSchema)),
});

type GitMetadata = Static<typeof GitMetadataSchema>;

const GitMetadataSkillId: 'git-metadata' = 'git-metadata';

class GitMetadataSkillProcessor implements Skill.ISkillProcessor<GitMetadata> {
  constructor(readonly turnContext: TurnContext) {}

  value() {
    return 0.8;
  }

  async processSkill(skill: GitMetadata): Promise<ElidableText> {
    this.turnContext.collectLabel(GitMetadataSkillId, 'git repository information');

    const chunks: [ElidableText, number][] = [];
    chunks.push([new ElidableText(['Metadata about the current git repository:']), 1]);

    if (skill.head?.name) {
      chunks.push([new ElidableText([`- Current branch name: ${skill.head.name}`]), 1]);
      if (skill.head.upstream) {
        chunks.push([
          new ElidableText([`- Upstream name and url: ${skill.head.upstream.name} - ${skill.head.upstream.url || ''}`]),
          1,
        ]);
      }
    } else {
      chunks.push([new ElidableText(['- Detached HEAD: yes']), 1]);
    }

    if (skill.remotes && skill.remotes.length > 0) {
      chunks.push([new ElidableText([`- Remotes: ${skill.remotes.map((r) => r.name).join(', ')}`]), 1]);
    }

    return new ElidableText(chunks);
  }
}

namespace GitMetadataSkill {
  export type Skill = GitMetadata;
}

class GitMetadataSkill extends SingleStepReportingSkill<typeof GitMetadataSkillId, GitMetadata> {
  constructor(_resolver: Skill.ISkillResolver<GitMetadata>) {
    super(
      GitMetadataSkillId,
      'Metadata about the current git repository, useful for questions about branch management and git related commands',
      'Reading git information',
      () => _resolver,
      (turnContext: TurnContext) => new GitMetadataSkillProcessor(turnContext)
    );
  }
}

export { RemoteSchema, GitMetadataSchema, GitMetadataSkillProcessor, GitMetadataSkillId, GitMetadataSkill };
