import type { Context } from '../../lib/src/context.ts';
import type {
  LspContextItemType,
  RegistrationContextProviderType,
  SupportedContextItemTypeUnion,
} from '../../lib/src/prompt/contextProviders/contextItemSchemas.ts';
import type { DocumentContext } from '../../lib/src/prompt/contextProviderRegistry.ts';

import { randomUUID } from 'crypto';
import { Service } from './service.ts';
import { logger } from '../../lib/src/logger.ts';
import { ContextProviderRegistry } from '../../lib/src/prompt/contextProviderRegistry.ts';
import { minimatch } from 'minimatch';
import { ContextUpdateRequest } from '../../types/src/contextProvider.ts';
import type {} from '../../types/src/index.ts';
import { CancellationToken } from 'vscode-languageserver';

function setContextItems(
  ctx: Context,
  lspContextItem: LspContextItemType,
  // def CopilotInlineCompletionSchema['data'] ../../types/src/inlineCompletion.ts
  data?: unknown
) {
  try {
    const contextProviderRegistry = ctx.get(ContextProviderRegistry);
    const providerMap = new Map<string, RegistrationContextProviderType>();

    contextProviderRegistry.providers.forEach((provider) => {
      providerMap.set(provider.id, provider);
    });

    lspContextItem.providers.forEach((item) => {
      const provider = providerMap.get(item.id);

      if (provider && provider instanceof LspClientContextProvider) {
        provider.resolver.setContextItems(item.contextItems);
      }
    });

    if (lspContextItem.updating && lspContextItem.updating.length > 0) {
      lspContextItem.updating.forEach((providerId) => {
        const provider = providerMap.get(providerId);

        if (provider && provider instanceof LspClientContextProvider) {
          provider.resolver.setUpdate(true);
          provider.resolver.data = data;
        }
      });
    }
  } catch (e) {
    logger.error(ctx, 'Failed to set context items on context providers', e);
  }
}

async function match(
  ctx: Context,
  documentSelector: RegistrationContextProviderType['selector'],
  documentContext: DocumentContext
) {
  return documentSelector
    .map((selector) => {
      try {
        if (typeof selector == 'string') {
          return minimatch(documentContext.uri, selector, minimatchOptions);
        }
        if (typeof selector == 'object') {
          let match = true;

          if ('language' in selector && match) {
            match = documentContext.languageId == (selector.language || '');
          }

          if ('scheme' in selector && match) {
            match = minimatch(documentContext.uri, selector.scheme || '', minimatchOptions);
          }

          if ('pattern' in selector && match) {
            match = minimatch(documentContext.uri, selector.pattern || '', minimatchOptions);
          }

          return match;
        }
      } catch {
        return false;
      }
      return false;
    })
    .some(Boolean)
    ? 10
    : 0;
}

class LspClientContextProvider {
  readonly resolver: LspClientContextResolver;
  constructor(
    readonly ctx: Context,
    readonly id: string,
    readonly selector: RegistrationContextProviderType['selector']
  ) {
    this.resolver = new LspClientContextResolver(ctx, this.id);
  }
}

class LspClientContextResolver {
  contextItems: SupportedContextItemTypeUnion[] = [];
  update = false;
  data?: unknown;

  constructor(
    readonly ctx: Context,
    readonly id: string
  ) {}

  async resolve(
    request: { documentContext: DocumentContext },
    cancellationToken: CancellationToken
  ): Promise<SupportedContextItemTypeUnion[]> {
    let resolvedContextItems: SupportedContextItemTypeUnion[] = [];
    if (this.contextItems.length > 0) {
      resolvedContextItems = this.contextItems;
    } else if (this.update) {
      const service = this.ctx.get(Service);
      const partialProgressToken = randomUUID();

      const progressListener = service.connection.onProgress(
        ContextUpdateRequest.type,
        partialProgressToken,
        (progress) => {
          resolvedContextItems.push(...progress);
        }
      );

      cancellationToken.onCancellationRequested(() => {
        if (!(progressListener == null)) {
          progressListener.dispose();
        }
      });
      try {
        const results = await service.connection.sendRequest(
          ContextUpdateRequest.type,
          {
            providerId: this.id,
            data: this.data,
            textDocument: {
              uri: request.documentContext.uri,
              languageId: request.documentContext.languageId,
              version: request.documentContext.version,
            },
            position: request.documentContext.position,
            partialResultToken: partialProgressToken,
          },
          cancellationToken
        );
        resolvedContextItems.push(...results);
      } finally {
        if (!(progressListener == null)) {
          progressListener.dispose();
        }
      }
    }
    this.reset();
    return Promise.resolve(resolvedContextItems);
  }

  setContextItems(contextItems: SupportedContextItemTypeUnion[]) {
    this.contextItems = contextItems;
  }

  clearContextItems() {
    this.contextItems = [];
  }

  setUpdate(value: boolean) {
    this.update = value;
  }

  clearData() {
    this.data = undefined;
  }

  reset() {
    this.clearContextItems();
    this.clearData();
    this.setUpdate(false);
  }
}

const minimatchOptions = { nocase: true, matchBase: true, nonegate: true, dot: true };

export { LspClientContextProvider, match, setContextItems };
