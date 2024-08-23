import type { Static } from '@sinclair/typebox';
import type { ReferenceSchema } from '../schema';
import type { ProjectMetadataSchema, ProjectMetadataSkillId } from './ProjectMetadataSkill';
import type { ProjectLabelsSchema, ProjectLabelsSkillId } from './ProjectLabelsSkill';
import type { CurrentEditorSchema, CurrentEditorSkillId } from './CurrentEditorSkill';
import type { RecentFilesSchema, RecentFilesSkillId } from './RecentFilesSkill';
import type { GitMetadataSchema, GitMetadataSkillId } from './GitMetadataSkill';
import type { ProblemsInActiveDocumentSchema, ProblemsInActiveDocumentSkillId } from './ProblemInActiveDocumentSkill';
import type { RuntimeLogsSchema, RuntimeLogsSkillId } from './RuntimeLogsSkill';
import type { BuildLogsSchema, BuildLogsSkillId } from './BuildLogsSkill';
import type { TestContextSchema, TestContextSkillId } from './TestContextSkill';
import type { TestFailuresSchema, TestFailuresSkillId } from './TestFailuresSkill';
import type { ProjectContextSnippetSchema, ProjectContextSkillId } from './ProjectContextSkill';
import type { ReferencesSkillId } from './ReferencesSkill';

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
  [ProjectContextSkillId]: Static<typeof ProjectContextSnippetSchema>[];
  [ReferencesSkillId]: Static<typeof ReferenceSchema>[];
};

export { SkillMap };
