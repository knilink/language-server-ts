export interface CopilotConfirmation {
  title: string;
  message: string;
  // ../conversation/promptDebugTemplates.ts
  confirmation?: { answer: 'yes' };
  // ../conversation/promptDebugTemplates.ts
  type: 'action';
  // ../conversation/promptDebugTemplates.ts
  agentSlug: string;
}
