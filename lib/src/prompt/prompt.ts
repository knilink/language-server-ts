import type { LanguageId } from '../types.ts';
import type {
  Snippet,
  SnippetContext,
  OpenDocument,
  PromptInfo,
  Prompt,
  PromptBackground,
  CurrentDocument,
} from '../../../prompt/src/lib.ts';
import { ProviderTimeoutError, PromptChoices, PromptOptions } from '../../../prompt/src/lib.ts';

import { Context } from '../context.ts';
import { Features } from '../experiments/features.ts';
import { getNumberOfSnippets, getSimilarFilesOptions } from '../experiments/similarFileOptionsProvider.ts';
import { NeighborSource, considerNeighborFile } from './similarFiles/neighborFiles.ts';
import { telemetryException, telemetryRaw, TelemetryWithExp } from '../telemetry.ts';
import {
  SnippetOrchestrator,
  providersSnippets,
  providersErrors,
  providersPerformance,
} from '../../../prompt/src/orchestrator.ts';
import { mkBasicResultTelemetry } from '../ghostText/telemetry.ts';
import { promptLibProxy } from './promptLibProxy.ts';
import { CopilotContentExclusionManager } from '../contentExclusion/contentExclusionManager.ts';
import { TextDocumentManager, INotebook, NotebookCell } from '../textDocumentManager.ts';
import { commentBlockAsSingles } from '../../../prompt/src/languageMarker.ts';
import { getMaxSolutionTokens } from '../openai/openai.ts';
import { DocumentUri, Position } from 'vscode-languageserver-types';
import { TextDocument } from '../textDocument.ts';
import { type CancellationToken } from '../../../agent/src/cancellation.ts';

type ExtractedPrompt =
  | {
      type: 'prompt';
      prompt: Prompt;
      trailingWs: string;
      promptChoices: PromptChoices;
      computeTimeMs: number;
      promptBackground: PromptBackground;
      neighborSource: Map<string, string[]>;
    }
  | { type: 'contextTooShort' }
  | { type: 'copilotNotAvailable' };

const MIN_PROMPT_CHARS = 10;
const _contextTooShort: ExtractedPrompt = { type: 'contextTooShort' };
const _copilotNotAvailable: ExtractedPrompt = { type: 'copilotNotAvailable' };

async function getPromptForSource(
  ctx: Context,
  source: string,
  offset: number,
  relativePath: string | undefined,
  uri: DocumentUri,
  languageId: LanguageId,
  telemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken | undefined,
  ifInserted: { tooltipSignature?: SnippetContext['tooltipSignature'] } | undefined,
  data: unknown
): Promise<{ neighborSource: Map<string, string[]> } & PromptInfo> {
  const docInfo: CurrentDocument = {
    uri: uri.toString(),
    source,
    offset,
    relativePath,
    languageId,
  };
  const promptOptions = getPromptOptions(ctx, telemetryData, languageId);

  const snippets: Snippet[] = [];
  let docs = new Map<string, OpenDocument>();
  let neighborSource = new Map<string, string[]>();
  let traits: SnippetContext['traits'] = [];
  try {
    let result = await NeighborSource.getNeighborFilesAndTraits(
      ctx,
      uri,
      languageId,
      telemetryData,
      cancellationToken,
      data
    );
    docs = result.docs;
    neighborSource = result.neighborSource;
    traits = result.traits
      .filter((trait) => trait.includeInPrompt)
      .map((trait) =>
        trait.promptTextOverride
          ? { kind: 'string', value: trait.promptTextOverride }
          : { kind: 'name-value', name: trait.name, value: trait.value }
      );
  } catch (e) {
    telemetryException(ctx, e, 'prompt.getPromptForSource.exception');
  }

  try {
    const spContext: SnippetContext = {
      currentFile: docInfo,
      similarFiles: Array.from(docs.values()),
      traits,
      tooltipSignature: ifInserted?.tooltipSignature,
      options: new PromptOptions(promptOptions, languageId),
    };
    const snippetProviderResults = await ctx.get(SnippetOrchestrator).getSnippets(spContext);
    const orchestratorSnippets = providersSnippets(snippetProviderResults);
    const errors = providersErrors(snippetProviderResults);
    const { runtimes, timeouts } = providersPerformance(snippetProviderResults);
    telemetryData.extendWithConfigProperties(ctx);
    telemetryData.sanitizeKeys();
    const telemetryResult = mkBasicResultTelemetry(telemetryData);
    if (docs.size > 0) {
      await telemetryRaw(
        ctx,
        'prompt.stat',
        { ...telemetryResult, neighborFilesTimeout: `${timeouts['similar-files']}` },
        { neighborFilesRuntimeMs: runtimes['similar-files'] }
      );
    } else {
      await telemetryRaw(ctx, 'prompt.stat', { ...telemetryResult }, {});
    }
    for (const e of errors) {
      if (!(e.error instanceof ProviderTimeoutError)) {
        await telemetryException(ctx, e.error, 'getSnippets');
      }
    }
    snippets.push(...orchestratorSnippets);
  } catch (e) {
    await telemetryException(ctx, e, 'prompt.orchestrator.getSnippets.exception');
    throw e;
  }

  let promptInfo: PromptInfo;
  try {
    promptInfo = await promptLibProxy.getPrompt(docInfo, promptOptions, snippets);
  } catch (e) {
    await telemetryException(ctx, e, 'prompt.getPromptForSource.exception');
    throw e;
  }
  return { neighborSource, ...promptInfo };
}

function trimLastLine(source: string): [string, string] {
  const lines = source.split(`\n`);
  const lastLine = lines[lines.length - 1];
  const extraSpace = lastLine.length - lastLine.trimEnd().length;
  const promptTrim = source.slice(0, source.length - extraSpace);
  const trailingWs = source.slice(promptTrim.length);
  return [lastLine.length === extraSpace ? promptTrim : source, trailingWs];
}

async function extractPromptForSource(
  ctx: Context,
  source: string,
  offset: number,
  relativePath: string | undefined,
  uri: DocumentUri,
  languageId: LanguageId,
  telemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken | undefined,
  ifInserted: { tooltipSignature?: SnippetContext['tooltipSignature'] } | undefined,
  data: unknown
): Promise<ExtractedPrompt> {
  if ((await ctx.get(CopilotContentExclusionManager).evaluate(uri, source, 'UPDATE')).isBlocked)
    return _copilotNotAvailable;

  const suffixPercent = ctx.get(Features).suffixPercent(telemetryData);
  if ((suffixPercent > 0 ? source.length : offset) < MIN_PROMPT_CHARS) return _contextTooShort;

  const startTime = Date.now();
  const {
    prefix,
    suffix,
    prefixLength,
    suffixLength,
    promptChoices,
    promptBackground,
    promptElementRanges,
    neighborSource,
  } = await getPromptForSource(
    ctx,
    source,
    offset,
    relativePath,
    uri,
    languageId,
    telemetryData,
    cancellationToken,
    ifInserted,
    data
  );
  const [resPrompt, trailingWs] = trimLastLine(prefix);
  const endTime = Date.now();
  return {
    type: 'prompt',
    prompt: {
      prefix: resPrompt,
      suffix: suffix,
      prefixTokens: prefixLength,
      suffixTokens: suffixLength,
      isFimEnabled: suffixPercent > 0 && suffix.length > 0,
      promptElementRanges: promptElementRanges.ranges,
    },
    trailingWs,
    promptChoices,
    computeTimeMs: endTime - startTime,
    promptBackground,
    neighborSource,
  };
}

async function extractPromptForDocument(
  ctx: Context,
  doc: TextDocument,
  position: Position,
  telemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken | undefined,
  ifInserted: { tooltipSignature?: SnippetContext['tooltipSignature'] } | undefined,
  data: unknown
): Promise<ExtractedPrompt> {
  const relativePath = await ctx.get(TextDocumentManager).getRelativePath(doc);
  return extractPromptForSource(
    ctx,
    doc.getText(),
    doc.offsetAt(position),
    relativePath,
    doc.uri,
    doc.languageId,
    telemetryData,
    cancellationToken,
    ifInserted,
    data
  );
}

function addNeighboringCellsToPrompt(neighboringCell: NotebookCell, activeCellLanguageId: string): string {
  const languageId = neighboringCell.document.languageId;
  const text = neighboringCell.document.getText();
  return languageId === activeCellLanguageId ? text : commentBlockAsSingles(text, activeCellLanguageId);
}

async function extractPromptForNotebook(
  ctx: Context,
  doc: TextDocument,
  notebook: INotebook,
  position: Position,
  telemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken | undefined,
  ifInserted: { tooltipSignature?: SnippetContext['tooltipSignature'] } | undefined,
  data: unknown
): Promise<ExtractedPrompt> {
  const activeCell = notebook.getCellFor(doc);
  if (activeCell) {
    const beforeCells = notebook
      .getCells()
      .filter(
        (cell) =>
          cell.index < activeCell.index &&
          considerNeighborFile(activeCell.document.languageId, cell.document.languageId)
      );
    const beforeSource =
      beforeCells.length > 0
        ? beforeCells.map((cell) => addNeighboringCellsToPrompt(cell, activeCell.document.languageId)).join(`\n\n`) +
          `\n\n`
        : '';
    const source = beforeSource + doc.getText();
    const offset = beforeSource.length + doc.offsetAt(position);
    return extractPromptForSource(
      ctx,
      source,
      offset,
      undefined,
      doc.uri,
      activeCell.document.languageId,
      telemetryData,
      cancellationToken,
      ifInserted,
      data
    );
  } else {
    return extractPromptForDocument(ctx, doc, position, telemetryData, cancellationToken, ifInserted, data);
  }
}

function extractPrompt(
  ctx: Context,
  doc: TextDocument,
  position: Position,
  telemetryData: TelemetryWithExp,
  cancellationToken?: CancellationToken,
  ifInserted?: { tooltipSignature?: SnippetContext['tooltipSignature'] },
  data?: unknown
): Promise<ExtractedPrompt> {
  const notebook = ctx.get(TextDocumentManager).findNotebook(doc);
  return notebook === undefined
    ? extractPromptForDocument(ctx, doc, position, telemetryData, cancellationToken, ifInserted, data)
    : extractPromptForNotebook(ctx, doc, notebook, position, telemetryData, cancellationToken, ifInserted, data);
}

function getPromptOptions(
  ctx: Context,
  telemetryData: TelemetryWithExp,
  languageId: LanguageId
): Partial<PromptOptions> {
  const features = ctx.get(Features);
  const maxPromptLength = features.maxPromptCompletionTokens(telemetryData) - getMaxSolutionTokens(ctx);
  const numberOfSnippets = getNumberOfSnippets(telemetryData, languageId);
  const similarFilesOptions = getSimilarFilesOptions(telemetryData, languageId);
  const promptOrderListPreset = features.promptOrderListPreset(telemetryData);
  const promptPriorityPreset = features.promptPriorityPreset(telemetryData);
  const suffixPercent = features.suffixPercent(telemetryData);
  const suffixMatchThreshold = features.suffixMatchThreshold(telemetryData);

  let promptOptions: Partial<PromptOptions> = {
    maxPromptLength,
    similarFilesOptions,
    numberOfSnippets,
    promptOrderListPreset,
    promptPriorityPreset,
  };

  if (suffixPercent > 0 && suffixMatchThreshold > 0) {
    promptOptions = {
      ...promptOptions,
      suffixPercent,
      suffixMatchThreshold,
    };
  }
  return promptOptions;
}

export { extractPrompt, ExtractedPrompt, trimLastLine };
