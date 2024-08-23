import { URI } from 'vscode-uri';

import type { LanguageId } from '../types';
import type { Snippet, SnippetContext, Document, PromptInfo, Prompt, PromptBackground } from '../../../prompt/src/lib';
import { ProviderTimeoutError, PromptChoices, PromptOptions } from '../../../prompt/src/lib';

import { Context } from '../context';
import { Features } from '../experiments/features';
import { NeighborSource, considerNeighborFile } from './similarFiles/neighborFiles';
import { TelemetryData, telemetryException, telemetryRaw, TelemetryWithExp } from '../telemetry';
import {
  SnippetOrchestrator,
  providersSnippets,
  providersErrors,
  providersPerformance,
} from '../../../prompt/src/orchestrator';
import { mkBasicResultTelemetry } from '../ghostText/telemetry';
import { promptLibProxy } from './promptLibProxy';
import { CopilotContentExclusionManager } from '../contentExclusion/contentExclusionManager';
import { TextDocumentManager, INotebook, NotebookCell } from '../textDocumentManager';
import { commentBlockAsSingles } from '../../../prompt/src/languageMarker';
import { getMaxSolutionTokens } from '../openai/openai';
import { Position } from 'vscode-languageserver-types';
import { TextDocument } from '../textDocument';

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
  uri: URI,
  languageId: LanguageId,
  telemetryData: TelemetryWithExp,
  ifInserted?: { tooltipSignature?: SnippetContext['tooltipSignature'] }
): Promise<{ neighborSource: Map<string, string[]> } & PromptInfo> {
  const docInfo: Document = {
    uri: uri.toString(),
    source,
    offset,
    relativePath,
    languageId,
  };
  let promptOptions = getPromptOptions(ctx, telemetryData);
  const suffixPercent = ctx.get(Features).suffixPercent(telemetryData);
  const suffixMatchThreshold = ctx.get(Features).suffixMatchThreshold(telemetryData);
  if (suffixPercent > 0) {
    promptOptions = {
      ...promptOptions,
      suffixPercent,
      suffixMatchThreshold,
    };
  }

  const snippets: Snippet[] = [];
  let docs = new Map<string, Document>();
  let neighborSource = new Map<string, string[]>();
  try {
    ({ docs, neighborSource } = await NeighborSource.getNeighborFiles(ctx, uri, languageId, telemetryData));
  } catch (e) {
    telemetryException(ctx, e, 'prompt.getPromptForSource.exception');
  }

  try {
    const spContext: SnippetContext = {
      currentFile: docInfo,
      similarFiles: Array.from(docs.values()),
      tooltipSignature: ifInserted?.tooltipSignature,
      options: new PromptOptions(promptOptions),
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
  uri: URI,
  languageId: LanguageId,
  telemetryData: TelemetryWithExp,
  ifInserted?: { tooltipSignature?: SnippetContext['tooltipSignature'] }
): Promise<ExtractedPrompt> {
  if ((await ctx.get(CopilotContentExclusionManager).evaluate(uri, source, 'UPDATE')).isBlocked)
    return _copilotNotAvailable;

  const suffixPercent = ctx.get(Features).suffixPercent(telemetryData);
  if (suffixPercent > 0 ? source.length : offset < MIN_PROMPT_CHARS) return _contextTooShort;

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
  } = await getPromptForSource(ctx, source, offset, relativePath, uri, languageId, telemetryData, ifInserted);
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
  ifInserted?: { tooltipSignature?: SnippetContext['tooltipSignature'] }
): Promise<ExtractedPrompt> {
  const relativePath = await ctx.get(TextDocumentManager).getRelativePath(doc);
  return extractPromptForSource(
    ctx,
    doc.getText(),
    doc.offsetAt(position),
    relativePath,
    doc.vscodeUri,
    doc.languageId,
    telemetryData,
    ifInserted
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
  ifInserted?: { tooltipSignature?: SnippetContext['tooltipSignature'] }
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
      doc.vscodeUri,
      activeCell.document.languageId,
      telemetryData,
      ifInserted
    );
  } else {
    return extractPromptForDocument(ctx, doc, position, telemetryData, ifInserted);
  }
}

function extractPrompt(
  ctx: Context,
  doc: TextDocument,
  position: Position,
  telemetryData: TelemetryWithExp,
  ifInserted?: { tooltipSignature?: SnippetContext['tooltipSignature'] }
): Promise<ExtractedPrompt> {
  const notebook = ctx.get(TextDocumentManager).findNotebook(doc);
  return notebook === undefined
    ? extractPromptForDocument(ctx, doc, position, telemetryData, ifInserted)
    : extractPromptForNotebook(ctx, doc, notebook, position, telemetryData, ifInserted);
}

function getPromptOptions(ctx: Context, telemetryData: TelemetryWithExp): Partial<PromptOptions> {
  const features = ctx.get(Features);
  const maxPromptLength = features.maxPromptCompletionTokens(telemetryData) - getMaxSolutionTokens(ctx);
  const similarFiles = features.similarFilesOption(telemetryData);
  const numberOfSnippets = features.numberOfSnippets(telemetryData);
  const promptOrderListPreset = features.promptOrderListPreset(telemetryData);
  const promptPriorityPreset = features.promptPriorityPreset(telemetryData);
  const cacheReferenceTokens = features.cacheReferenceTokens(telemetryData);
  const suffixPercent = features.suffixPercent(telemetryData);
  const suffixMatchThreshold = features.suffixMatchThreshold(telemetryData);

  let promptOptions: Partial<PromptOptions> = {
    maxPromptLength,
    similarFiles,
    numberOfSnippets,
    promptOrderListPreset,
    promptPriorityPreset,
    cacheReferenceTokens,
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
