import type { CancellationToken } from 'vscode-languageserver';
import type { Position } from 'vscode-languageserver-textdocument';
import type { Context } from '../../context.ts';
import type { CopilotTextDocument } from '../../textDocument.ts';
import type { ExtractedPrompt } from '../prompt.ts';
import type { CodeSnippetType, ContextItem, TraitType } from '../contextProviders/contextItemSchemas.ts';
import type { VirtualPromptReconciler } from '../../../../prompt/src/components/reconciler.ts';
import type { SuccessRenderedPrompt } from './completionsPromptRenderer.tsx';
import type { SuccessPrompt } from '../../types.ts';

import { CodeSnippets } from './codeSnippets.tsx';
import { CompletionsPromptRenderer } from './completionsPromptRenderer.tsx';
import { CurrentFile } from './currentFile.tsx';
import { DocumentMarker } from './marker.tsx';
import { SimilarFiles } from './similarFiles.tsx';
import { Traits } from './traits.tsx';
import { ContextProviderRegistry, telemetrizeContextItems, useContextProviderAPI } from '../contextProviderRegistry.ts';
import { ContextProviderStatistics } from '../contextProviderStatistics.ts';
import { getCodeSnippetsFromContextItems } from '../contextProviders/codeSnippets.ts';
import { getTraitsFromContextItems } from '../contextProviders/traits.ts';
import {
  MIN_PROMPT_CHARS,
  _contextTooShort,
  _copilotContentExclusion,
  _promptCancelled,
  _promptError,
  getPromptOptions,
  trimLastLine,
} from '../prompt.ts';
import { ConfigKey, getConfig } from '../../config.ts';
import { CopilotContentExclusionManager } from '../../contentExclusion/contentExclusionManager.ts';
import { handleException } from '../../defaultHandlers.ts';
import { Features } from '../../experiments/features.ts';
import { telemetryException, TelemetryWithExp } from '../../telemetry.ts';
import { VirtualPrompt } from '../../../../prompt/src/components/virtualPrompt.ts';
import { getTokenizer } from '../../../../prompt/src/tokenization/tokenizer.ts';
import { PromptBackground, PromptChoices } from '../../../../prompt/src/wishlist.ts';
import type {} from '../../../../prompt/src/tokenization/index.ts';

interface CompletionRequestData {
  document: CopilotTextDocument;
  position: Position;
  telemetryData: TelemetryWithExp;
  // ./similarFiles.tsx
  turnOffSimilarFiles?: boolean;
  // ./similarFiles.tsx
  cancellationToken?: CancellationToken;
  // ./similarFiles.tsx
  data?: unknown;
  // ./codeSnippets.tsx
  codeSnippets?: CodeSnippetType[];
  // ./traits.tsx
  traits?: TraitType[];
}

type PromptStrategy = 'components' | 'wishlist';

// MARK l
function isCompletionRequestData(data: any): data is CompletionRequestData {
  if (!data || typeof data != 'object') {
    return false;
  }
  const req = data;
  return !(
    !req.document ||
    !req.position ||
    req.position.line === undefined ||
    req.position.character === undefined ||
    !req.telemetryData
  );
}

function getPromptStrategy(ctx: Context, telemetryData: TelemetryWithExp): PromptStrategy {
  return ctx.get(Features).promptComponentsEnabled(telemetryData) || getConfig(ctx, ConfigKey.EnablePromptComponents)
    ? 'components'
    : 'wishlist';
}

function tryHeatingUpTokenizer(ctx: Context) {
  try {
    getTokenizer();
  } catch (e) {
    handleException(ctx, e, 'heatUpTokenizer');
  }
}

class CompletionsPromptFactory {
  renderer = new CompletionsPromptRenderer();
  pipe?: VirtualPromptReconciler.Pipe;

  constructor(
    readonly ctx: Context,
    public virtualPrompt?: VirtualPrompt
  ) {}
  async prompt(
    textDocument: CopilotTextDocument,
    position: Position,
    telemetryData: TelemetryWithExp,
    cancellationToken: CancellationToken | undefined,
    data: unknown
  ): Promise<ExtractedPrompt> {
    try {
      return await this.createPromptUnsafe(textDocument, position, telemetryData, cancellationToken, data);
    } catch (e) {
      return this.errorPrompt(e);
    }
  }

  async createPromptUnsafe(
    textDocument: CopilotTextDocument,
    position: Position,
    telemetryData: TelemetryWithExp,
    cancellationToken?: CancellationToken,
    data?: unknown
  ): Promise<ExtractedPrompt> {
    const { maxPromptLength, suffixPercent } = getPromptOptions(
      this.ctx,
      telemetryData,
      textDocument.detectedLanguageId
    );

    const failFastPrompt = await this.failFastPrompt(textDocument, position, suffixPercent ?? 0, cancellationToken);
    if (failFastPrompt) {
      return failFastPrompt;
    }
    const { virtualPrompt, pipe } = await this.getOrCreateVirtualPrompt(this.ctx);
    const start = performance.now();
    const { traits, codeSnippets, turnOffSimilarFiles, allContextItems } = await this.resolveContext(
      textDocument,
      position,
      telemetryData,
      cancellationToken,
      data
    );
    await this.updateComponentData(
      pipe,
      textDocument,
      position,
      traits,
      codeSnippets,
      telemetryData,
      turnOffSimilarFiles,
      cancellationToken,
      data
    );
    const snapshot = await virtualPrompt.snapshot(cancellationToken);
    const snapshotStatus = snapshot.status;
    if (snapshotStatus === 'cancelled') {
      return _promptCancelled;
    }
    if (snapshotStatus === 'error') {
      return this.errorPrompt(snapshot.error);
    }
    const rendered = await this.renderer.render(
      snapshot.snapshot,
      {
        delimiter: '\n',
        tokenizer: getTokenizer(),
        promptTokenLimit: maxPromptLength,
        suffixPercent,
      },
      cancellationToken
    );
    if (rendered.status === 'cancelled') {
      return _promptCancelled;
    }
    if (rendered.status === 'error') {
      return this.errorPrompt(rendered.error);
    }
    const [trimmedPrefix, trailingWs] = trimLastLine(rendered.prefix);

    if (useContextProviderAPI(this.ctx, telemetryData)) {
      this.ctx.get(ContextProviderStatistics).computeMatchWithPrompt(rendered.prefix + '\n' + rendered.suffix);

      telemetrizeContextItems(this.ctx, allContextItems, telemetryData);
    }

    const end = performance.now();
    this.resetIfEmpty(rendered);
    return this.successPrompt(trimmedPrefix, rendered, end, start, trailingWs);
  }

  async updateComponentData(
    pipe: VirtualPromptReconciler.Pipe,
    textDocument: CopilotTextDocument,
    position: Position,
    traits?: TraitType[],
    codeSnippets?: CodeSnippetType[],
    telemetryData?: TelemetryWithExp,
    turnOffSimilarFiles?: boolean,
    cancellationToken?: CancellationToken,
    data?: unknown
  ) {
    const completionRequestData = this.createRequestData(
      textDocument,
      position,
      telemetryData,
      cancellationToken,
      data,
      traits,
      codeSnippets,
      turnOffSimilarFiles
    );
    await pipe.pump(completionRequestData);
  }

  async resolveContext(
    textDocument: CopilotTextDocument,
    position: Position,
    telemetryData: TelemetryWithExp,
    cancellationToken: CancellationToken | undefined,
    data: unknown
  ) {
    let allContextItems: ContextItem[] = [];
    let traits: TraitType[] | undefined;
    let codeSnippets: CodeSnippetType[] | undefined;
    let turnOffSimilarFiles = false;

    if (useContextProviderAPI(this.ctx, telemetryData)) {
      allContextItems = await this.ctx.get(ContextProviderRegistry).resolveAllProviders(
        {
          uri: textDocument.uri,
          languageId: textDocument.clientLanguageId,
          version: textDocument.version,
          offset: textDocument.offsetAt(position),
          position,
        },
        telemetryData,
        cancellationToken,
        data
      );

      if (
        !this.ctx.get(Features).includeNeighboringFiles(telemetryData) &&
        allContextItems.some((item) => item.resolution != 'error' && item.matchScore > 0)
      ) {
        turnOffSimilarFiles = true;
      }

      traits = await getTraitsFromContextItems(this.ctx, allContextItems);
      codeSnippets = await getCodeSnippetsFromContextItems(this.ctx, allContextItems, textDocument.detectedLanguageId);
    }

    return { traits, codeSnippets, turnOffSimilarFiles, allContextItems };
  }

  async failFastPrompt(
    textDocument: CopilotTextDocument,
    position: Position,
    suffixPercent: number,
    cancellationToken: CancellationToken | undefined
  ) {
    if (cancellationToken?.isCancellationRequested) {
      return _promptCancelled;
    }
    if (
      (await this.ctx.get(CopilotContentExclusionManager).evaluate(textDocument.uri, textDocument.getText(), 'UPDATE'))
        .isBlocked
    ) {
      return _copilotContentExclusion;
    }
    if ((suffixPercent > 0 ? textDocument.getText().length : textDocument.offsetAt(position)) < MIN_PROMPT_CHARS) {
      return _contextTooShort;
    }
  }

  async getOrCreateVirtualPrompt(ctx: Context) {
    if (!this.virtualPrompt) {
      this.virtualPrompt = await VirtualPrompt.create(this.completionsPrompt());
    }

    if (!this.pipe) {
      this.pipe = this.virtualPrompt.createPipe();
    }

    return { virtualPrompt: this.virtualPrompt, pipe: this.pipe };
  }

  completionsPrompt() {
    return (
      <>
        <DocumentMarker ctx={this.ctx} weight={0.7} />
        <Traits weight={0.6} />
        <CodeSnippets ctx={this.ctx} weight={0.9} />
        <SimilarFiles ctx={this.ctx} weight={0.8} />
        <CurrentFile weight={1} />
      </>
    );
  }

  createRequestData(
    textDocument: CopilotTextDocument,
    position: Position,
    telemetryData?: TelemetryWithExp,
    cancellationToken?: CancellationToken,
    data?: unknown,
    traits?: TraitType[],
    codeSnippets?: CodeSnippetType[],
    turnOffSimilarFiles?: boolean
  ) {
    return {
      document: textDocument,
      position,
      telemetryData,
      cancellationToken,
      data,
      traits,
      codeSnippets,
      turnOffSimilarFiles,
    };
  }

  resetIfEmpty(rendered: SuccessRenderedPrompt) {
    if (rendered.prefix.length === 0 && rendered.suffix.length === 0) {
      this.reset();
    }
  }

  successPrompt(
    trimmedPrefix: string,
    rendered: SuccessRenderedPrompt,
    end: number,
    start: number,
    trailingWs: string
  ): SuccessPrompt {
    return {
      type: 'prompt',
      prompt: {
        prefix: trimmedPrefix,
        suffix: rendered.suffix,
        isFimEnabled: rendered.suffix.length > 0,
        promptElementRanges: [],
      },
      computeTimeMs: end - start,
      trailingWs,
      promptChoices: new PromptChoices(),
      promptBackground: new PromptBackground(),
      neighborSource: new Map(),
      metadata: rendered.metadata,
    };
  }

  errorPrompt(error: unknown) {
    telemetryException(this.ctx, error, 'PromptComponents.CompletionsPromptFactory');
    this.reset();
    return _promptError;
  }

  reset() {
    this.virtualPrompt = undefined;
    this.pipe = undefined;
  }
}

export { CompletionsPromptFactory, getPromptStrategy, isCompletionRequestData, tryHeatingUpTokenizer };

export type { PromptStrategy, CompletionRequestData };
