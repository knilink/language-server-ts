import { ConversationReference } from '../../types.ts';
import { GitHubRepositoryApi } from '../gitHubRepositoryApi.ts';
import { extractRepoInfo } from '../repositoryInfo.ts';
import { CurrentEditorSkillId, CurrentEditor } from '../skills/CurrentEditorSkill.ts';
import { isEmptyRange } from '../skills/ElidableDocument.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { TurnContext } from '../turnContext.ts';
import { TextDocument } from '../../textDocument.ts';

type Reference = ConversationReference.OutgoingReference;

async function skillsToReference(turnContext: TurnContext): Promise<Reference[]> {
  const references: Reference[] = [];
  await addRepositoryReference(turnContext, references);
  await addSelectionReference(turnContext, references);
  await addFileReferences(turnContext, references);
  return references;
}
async function addRepositoryReference(turnContext: TurnContext, references: Reference[]): Promise<void> {
  const repositoryReference = await gitMetadataToReference(turnContext);

  if (repositoryReference) {
    references.push(repositoryReference);
  }
}
async function addSelectionReference(turnContext: TurnContext, references: Reference[]): Promise<void> {
  const selectionReference = await currentEditorToSelectionReference(turnContext);

  if (selectionReference) {
    references.push(selectionReference);
  }
}
async function addFileReferences(turnContext: TurnContext, references: Reference[]) {
  const fileReferences: Reference[] = [];
  const currentEditorReference = await currentEditorToFileReference(turnContext);

  if (currentEditorReference) {
    fileReferences.push(currentEditorReference);
  }

  fileReferences.push(...(await fileReferenceToPlatformFileReference(turnContext)));

  if (fileReferences.length > 0) {
    references.push(...fileReferences);
  }
}
async function gitMetadataToReference(turnContext: TurnContext): Promise<Reference | undefined> {
  const maybeRepoInfo = await extractRepoInfo(turnContext);
  if (maybeRepoInfo) {
    const repoApi = await turnContext.ctx.get(GitHubRepositoryApi);
    const owner = maybeRepoInfo.repoInfo.owner;
    const repo = maybeRepoInfo.repoInfo.repo;
    if (await repoApi.isAvailable(owner, repo))
      return {
        type: 'github.repository', // TODO ??? github.web-search fxck,
        id: `${owner}/${repo}`,
        data: {
          type: 'repository',
          name: repo,
          ownerLogin: owner,
          id: (await repoApi.getRepositoryInfo(owner, repo)).id,
        },
      };
  }
}
async function currentEditorToSelectionReference(turnContext: TurnContext) {
  let currentEditor = await turnContext.skillResolver.resolve(CurrentEditorSkillId);
  if (currentEditor?.selection) {
    let documentResult = await turnContext.ctx.get(FileReader).readFile(currentEditor.uri);
    let fileStatus = statusFromTextDocumentResult(documentResult);
    await turnContext.collectFile(
      turnContext.turn.agent!.agentSlug, // MARK !
      currentEditor.uri,
      fileStatus,
      currentEditor.selection
    );
    if (documentResult.status === 'valid') return await extractSelection(currentEditor, documentResult.document);
  }
}
async function extractSelection(currentEditor: CurrentEditor, doc: TextDocument): Promise<Reference | undefined> {
  if (currentEditor.selection && !isEmptyRange(currentEditor.selection)) {
    let selection = doc.getText(currentEditor.selection);
    return {
      type: 'client.selection',
      id: currentEditor.uri,
      data: {
        start: { line: currentEditor.selection.start.line, col: currentEditor.selection.start.character },
        end: { line: currentEditor.selection.end.line, col: currentEditor.selection.end.character },
        content: selection,
      },
    };
  }
}
async function currentEditorToFileReference(turnContext: TurnContext): Promise<Reference | undefined> {
  let currentEditor = await turnContext.skillResolver.resolve(CurrentEditorSkillId);
  if (currentEditor) {
    let documentResult = await turnContext.ctx.get(FileReader).readFile(currentEditor.uri);
    let fileStatus = statusFromTextDocumentResult(documentResult);
    await turnContext.collectFile(
      turnContext.turn.agent!.agentSlug, // MARK !
      currentEditor.uri,
      fileStatus
    );
    if (documentResult.status === 'valid')
      return {
        type: 'client.file',
        id: documentResult.document.uri,
        data: { content: documentResult.document.getText(), language: documentResult.document.languageId },
      };
  }
}
async function fileReferenceToPlatformFileReference(turnContext: TurnContext): Promise<Reference[]> {
  const platformReferences: Reference[] = [];
  const references = turnContext.turn.request.references;
  if (references && references?.length > 0) {
    let fileReader = turnContext.ctx.get(FileReader);
    for (let reference of references)
      if (reference.type === 'file') {
        let documentResult = await fileReader.readFile(reference.uri);
        let fileStatus = statusFromTextDocumentResult(documentResult);
        await turnContext.collectFile(
          turnContext.turn.agent!.agentSlug,
          reference.uri,
          fileStatus,
          reference.selection
        );
        if (documentResult.status === 'valid') {
          let content = documentResult.document.getText();
          platformReferences.push({
            type: 'client.file',
            id: reference.uri,
            data: { content: content, language: documentResult.document.languageId },
          });
        }
      }
  }
  return platformReferences;
}

export { skillsToReference };
