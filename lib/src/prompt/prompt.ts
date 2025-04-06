import type { DocumentUri, Position } from 'vscode-languageserver-types';
import type { Context } from '../context.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { ExtractedPrompt, LanguageId } from '../types.ts';
import type {
  Snippet,
  SnippetContext,
  OpenDocument,
  PromptInfo,
  CurrentDocument,
  IPromptOptions,
} from '../../../prompt/src/lib.ts';
import type { TelemetryWithExp } from '../telemetry.ts';
import type { TraitType } from './contextProviders/contextItemSchemas.ts';
import type { CodeSnippetType, ContextItem } from './contextProviders/contextItemSchemas.ts';
import type { PromptStrategy } from './components/completionsPrompt.tsx';
import type { INotebook, NotebookCell } from '../textDocumentManager.ts';

import { performance } from 'node:perf_hooks';
import { CompletionsPromptFactory, getPromptStrategy } from './components/completionsPrompt.tsx';
import { ContextProviderRegistry, telemetrizeContextItems, useContextProviderAPI } from './contextProviderRegistry.ts';
import { ContextProviderStatistics } from './contextProviderStatistics.ts';
import { addRelativePathToCodeSnippets, getCodeSnippetsFromContextItems } from './contextProviders/codeSnippets.ts';
import {
  addKindToRelatedFileTrait,
  convertTraitsToRelatedFileTraits,
  getTraitsFromContextItems,
} from './contextProviders/traits.ts';
import { promptLibProxy } from './promptLibProxy.ts';
import { NeighborSource, considerNeighborFile } from './similarFiles/neighborFiles.ts';
import { CopilotContentExclusionManager } from '../contentExclusion/contentExclusionManager.ts';
import { Features } from '../experiments/features.ts';
import { getNumberOfSnippets, getSimilarFilesOptions } from '../experiments/similarFileOptionsProvider.ts';
import { mkBasicResultTelemetry } from '../ghostText/telemetry.ts';
import { getMaxSolutionTokens } from '../openai/openai.ts';
import { telemetryException, telemetryRaw } from '../telemetry.ts';
import { TextDocumentManager } from '../textDocumentManager.ts';
import { CopilotTextDocument } from '../textDocument.ts';
import { commentBlockAsSingles } from '../../../prompt/src/languageMarker.ts';
import {
  SnippetOrchestrator,
  providersErrors,
  providersPerformance,
  providersSnippets,
} from '../../../prompt/src/orchestrator.ts';
import { PromptOptions } from '../../../prompt/src/prompt.ts';
import { ProviderTimeoutError } from '../../../prompt/src/snippetProviders/snippetProvider.ts';
import type {} from '../../../prompt/src/lib.ts';

const MIN_PROMPT_CHARS = 10;
const _contextTooShort: ExtractedPrompt = { type: 'contextTooShort' };
const _copilotContentExclusion: ExtractedPrompt = { type: 'copilotContentExclusion' };
const _promptError: ExtractedPrompt = { type: 'promptError' };
const _promptCancelled: ExtractedPrompt = { type: 'promptCancelled' };

async function getPromptForSource(
  ctx: Context,
  source: string,
  offset: number,
  position: Position,
  relativePath: string | undefined,
  uri: DocumentUri,
  detectedLanguageId: LanguageId,
  clientLanguageId: LanguageId,
  version: number,
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
    languageId: detectedLanguageId,
  };
  const promptOptions = getPromptOptions(ctx, telemetryData, detectedLanguageId);

  const snippets: Snippet[] = [];
  let docs = new Map<string, OpenDocument>();
  let neighborSource = new Map<string, string[]>();
  let traits: SnippetContext['traits'] = [];
  let allContextItems: ContextItem[] = [];
  let codeSnippets: CodeSnippetType[] = [];
  let traitsFromContextProviders: TraitType[] = [];
  let turnOffNeighboringFiles = false;

  try {
    if (useContextProviderAPI(ctx, telemetryData)) {
      allContextItems = await ctx
        .get(ContextProviderRegistry)
        .resolveAllProviders(
          { uri: uri.toString(), languageId: clientLanguageId, version, offset, position },
          telemetryData,
          cancellationToken,
          data
        );

      if (
        !ctx.get(Features).includeNeighboringFiles(telemetryData) &&
        allContextItems.some((item) => item.resolution != 'error' && item.matchScore > 0)
      ) {
        turnOffNeighboringFiles = true;
      }

      traitsFromContextProviders = await getTraitsFromContextItems(ctx, allContextItems);
      codeSnippets = await getCodeSnippetsFromContextItems(ctx, allContextItems, detectedLanguageId);
    }

    const result = turnOffNeighboringFiles
      ? NeighborSource.defaultEmptyResult()
      : await NeighborSource.getNeighborFilesAndTraits(
          ctx,
          uri,
          detectedLanguageId,
          telemetryData,
          cancellationToken,
          data
        );

    docs = result.docs;
    neighborSource = result.neighborSource;
    traits = result.traits
      .concat(convertTraitsToRelatedFileTraits(traitsFromContextProviders))
      .filter((trait) => trait.includeInPrompt)
      .map(addKindToRelatedFileTrait);
  } catch (e) {
    telemetryException(ctx, e, 'prompt.getPromptForSource.exception');
  }

  try {
    const spContext: SnippetContext = {
      currentFile: docInfo,
      similarFiles: Array.from(docs.values()),
      traits,
      tooltipSignature: ifInserted?.tooltipSignature,
      options: new PromptOptions(promptOptions, detectedLanguageId),
      codeSnippets: addRelativePathToCodeSnippets(ctx, codeSnippets),
    };
    const snippetProviderResults = await ctx.get(SnippetOrchestrator).getSnippets(spContext);
    const orchestratorSnippets = providersSnippets(snippetProviderResults);
    const errors = providersErrors(snippetProviderResults);
    const { runtimes, timeouts } = providersPerformance(snippetProviderResults);
    telemetryData.extendWithConfigProperties(ctx);
    telemetryData.sanitizeKeys();
    const telemetryResult = mkBasicResultTelemetry(telemetryData);
    if (docs.size > 0) {
      telemetryRaw(
        ctx,
        'prompt.stat',
        { ...telemetryResult, neighborFilesTimeout: `${timeouts['similar-files']}` },
        { neighborFilesRuntimeMs: runtimes['similar-files'] }
      );
    } else {
      telemetryRaw(ctx, 'prompt.stat', { ...telemetryResult }, {});
    }
    for (const e of errors) {
      if (!(e.error instanceof ProviderTimeoutError)) {
        telemetryException(ctx, e.error, 'getSnippets');
      }
    }
    snippets.push(...orchestratorSnippets);
  } catch (e) {
    telemetryException(ctx, e, 'prompt.orchestrator.getSnippets.exception');
    throw e;
  }

  let promptInfo: PromptInfo;
  try {
    promptInfo = await promptLibProxy.getPrompt(docInfo, promptOptions, snippets);

    if (useContextProviderAPI(ctx, telemetryData)) {
      ctx.get(ContextProviderStatistics).computeMatchWithPrompt(promptInfo.prefix + '\n' + promptInfo.suffix);

      telemetrizeContextItems(ctx, allContextItems, telemetryData);
    }
  } catch (e) {
    telemetryException(ctx, e, 'prompt.getPromptForSource.exception');
    throw e;
  }
  return { neighborSource, ...promptInfo };
}

function trimLastLine(source: string): [string, string] {
  const lines = source.split('\n');
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
  position: Position,
  relativePath: string | undefined,
  uri: DocumentUri,
  detectedLanguageId: LanguageId,
  clientLanguageId: LanguageId,
  version: number,
  telemetryData: TelemetryWithExp,
  cancellationToken: CancellationToken | undefined,
  ifInserted: { tooltipSignature?: SnippetContext['tooltipSignature'] } | undefined,
  data: unknown
): Promise<ExtractedPrompt> {
  if ((await ctx.get(CopilotContentExclusionManager).evaluate(uri, source, 'UPDATE')).isBlocked)
    return _copilotContentExclusion;

  const suffixPercent = ctx.get(Features).suffixPercent(telemetryData);
  if ((suffixPercent > 0 ? source.length : offset) < MIN_PROMPT_CHARS) return _contextTooShort;

  const startTime = performance.now();
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
    position,
    relativePath,
    uri,
    detectedLanguageId,
    clientLanguageId,
    version,
    telemetryData,
    cancellationToken,
    ifInserted,
    data
  );
  const [resPrompt, trailingWs] = trimLastLine(prefix);
  const endTime = performance.now();
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
  doc: CopilotTextDocument,
  position: Position,
  telemetryData: TelemetryWithExp,
  strategy: PromptStrategy = 'wishlist',
  cancellationToken: CancellationToken | undefined,
  ifInserted: { tooltipSignature?: SnippetContext['tooltipSignature'] } | undefined,
  data: unknown
): Promise<ExtractedPrompt> {
  const relativePath = ctx.get(TextDocumentManager).getRelativePath(doc);
  return strategy === 'components'
    ? ctx.get(CompletionsPromptFactory).prompt(doc, position, telemetryData, cancellationToken, data)
    : extractPromptForSource(
        ctx,
        doc.getText(),
        doc.offsetAt(position),
        position,
        relativePath,
        doc.uri,
        doc.detectedLanguageId,
        doc.clientLanguageId,
        doc.version,
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
  doc: CopilotTextDocument,
  notebook: INotebook,
  position: Position,
  telemetryData: TelemetryWithExp,
  strategy: PromptStrategy = 'wishlist',
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
          considerNeighborFile(activeCell.document.detectedLanguageId, cell.document.detectedLanguageId)
      );
    const beforeSource =
      beforeCells.length > 0
        ? beforeCells
            .map((cell) => addNeighboringCellsToPrompt(cell, activeCell.document.detectedLanguageId))
            .join(`\n\n`) + `\n\n`
        : '';
    const source = beforeSource + doc.getText();
    const offset = beforeSource.length + doc.offsetAt(position);

    if (strategy === 'components') {
      let promptFactory = ctx.get(CompletionsPromptFactory);
      let cellDoc = CopilotTextDocument.create(
        doc.uri,
        activeCell.document.clientLanguageId,
        activeCell.document.version,
        source,
        activeCell.document.detectedLanguageId
      );
      let pos = cellDoc.positionAt(offset);
      return promptFactory.prompt(cellDoc, pos, telemetryData, cancellationToken, data);
    }

    return extractPromptForSource(
      ctx,
      source,
      offset,
      position,
      undefined,
      doc.uri,
      activeCell.document.detectedLanguageId,
      activeCell.document.clientLanguageId,
      activeCell.document.version,
      telemetryData,
      cancellationToken,
      ifInserted,
      data
    );
  } else {
    return extractPromptForDocument(ctx, doc, position, telemetryData, strategy, cancellationToken, ifInserted, data);
  }
}

function extractPrompt(
  ctx: Context,
  doc: CopilotTextDocument,
  position: Position,
  telemetryData: TelemetryWithExp,
  cancellationToken?: CancellationToken,
  ifInserted?: { tooltipSignature?: SnippetContext['tooltipSignature'] },
  data?: unknown
): Promise<ExtractedPrompt> {
  const notebook = ctx.get(TextDocumentManager).findNotebook(doc);
  const strategy = getPromptStrategy(ctx, telemetryData);
  return notebook === undefined
    ? extractPromptForDocument(ctx, doc, position, telemetryData, strategy, cancellationToken, ifInserted, data)
    : extractPromptForNotebook(
        ctx,
        doc,
        notebook,
        position,
        telemetryData,
        strategy,
        cancellationToken,
        ifInserted,
        data
      );
}

function getPromptOptions(
  ctx: Context,
  telemetryData: TelemetryWithExp,
  languageId: LanguageId
): Pick<
  IPromptOptions,
  'maxPromptLength' | 'similarFilesOptions' | 'numberOfSnippets' | 'promptOrderListPreset' | 'promptPriorityPreset'
> &
  Partial<Pick<IPromptOptions, 'suffixPercent' | 'suffixMatchThreshold'>> {
  const features = ctx.get(Features);
  const maxPromptLength = features.maxPromptCompletionTokens(telemetryData) - getMaxSolutionTokens(ctx);
  const numberOfSnippets = getNumberOfSnippets(telemetryData, languageId);
  const similarFilesOptions = getSimilarFilesOptions(ctx, telemetryData, languageId);
  const promptOrderListPreset = features.promptOrderListPreset(telemetryData);
  const promptPriorityPreset = features.promptPriorityPreset(telemetryData);
  const suffixPercent = features.suffixPercent(telemetryData);
  const suffixMatchThreshold = features.suffixMatchThreshold(telemetryData);

  let promptOptions: Pick<
    IPromptOptions,
    'maxPromptLength' | 'similarFilesOptions' | 'numberOfSnippets' | 'promptOrderListPreset' | 'promptPriorityPreset'
  > &
    Partial<Pick<IPromptOptions, 'suffixPercent' | 'suffixMatchThreshold'>> = {
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

export {
  MIN_PROMPT_CHARS,
  _contextTooShort,
  _copilotContentExclusion,
  _promptCancelled,
  _promptError,
  extractPrompt,
  getPromptOptions,
  trimLastLine,
};

export type { ExtractedPrompt };
