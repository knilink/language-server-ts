import type { Static } from '@sinclair/typebox';
import type { ReferenceSchema } from '../schema.ts';
import type { ProjectMetadataSchema, ProjectMetadataSkillId } from './ProjectMetadataSkill.ts';
import type { ProjectLabelsSchema, ProjectLabelsSkillId } from './ProjectLabelsSkill.ts';
import type { CurrentEditorSchema, CurrentEditorSkillId } from './CurrentEditorSkill.ts';
import type { RecentFilesSchema, RecentFilesSkillId } from './RecentFilesSkill.ts';
import type { GitMetadataSchema, GitMetadataSkillId } from './GitMetadataSkill.ts';
import type {
  ProblemsInActiveDocumentSchema,
  ProblemsInActiveDocumentSkillId,
} from './ProblemInActiveDocumentSkill.ts';
import type { RuntimeLogsSchema, RuntimeLogsSkillId } from './RuntimeLogsSkill.ts';
import type { BuildLogsSchema, BuildLogsSkillId } from './BuildLogsSkill.ts';
import type { TestContextSchema, TestContextSkillId } from './TestContextSkill.ts';
import type { TestFailuresSchema, TestFailuresSkillId } from './TestFailuresSkill.ts';
import type { ProjectContextSnippetType, ProjectContextSkillId } from './ProjectContextSkill.ts';
import type { ReferencesSkillId } from './ReferencesSkill.ts';

type SkillMap = {
  [ProjectMetadataSkillId]: Static<typeof ProjectMetadataSchema>;
  [ProjectLabelsSkillId]: Static<typeof ProjectLabelsSchema>;
  [CurrentEditorSkillId]: Static<typeof CurrentEditorSchema>;
  [RecentFilesSkillId]: Static<typeof RecentFilesSchema>;
  [GitMetadataSkillId]: Static<typeof GitMetadataSchema>;
  [ProblemsInActiveDocumentSkillId]: Static<typeof ProblemsInActiveDocumentSchema>;
  [RuntimeLogsSkillId]: Static<typeof RuntimeLogsSchema>;
  [BuildLogsSkillId]: Static<typeof BuildLogsSchema>;
  [TestContextSkillId]: Static<typeof TestContextSchema>;
  [TestFailuresSkillId]: Static<typeof TestFailuresSchema>;
  [ProjectContextSkillId]: ProjectContextSnippetType[];
  [ReferencesSkillId]: Static<typeof ReferenceSchema>[];
};

export { SkillMap };
