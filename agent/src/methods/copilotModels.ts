import { Model } from '../../../lib/src/types.ts';
import type { Context } from '../../../lib/src/context.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { CopilotToken } from '../../../lib/src/auth/copilotToken.ts';

import { TestingOptions } from './testingOptions.ts';
import { ensureAuthenticated } from '../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { CopilotTokenManager } from '../../../lib/src/auth/copilotTokenManager.ts';
import {
  ModelMetadataProvider,
  getSupportedModelFamiliesForPrompt,
  isKnownModelFamily,
  type ModelMetadataType,
} from '../../../lib/src/conversation/modelMetadata.ts';
import { AvailableModels } from '../../../lib/src/openai/model.ts';
import { Type, type Static } from '@sinclair/typebox';

interface ModelConfig {
  modelFamily: string;
  modelName: string;
  modelPolicy?: { state: string; terms: string };
  scopes: ('chat-panel' | 'edit-panel' | 'inline' | 'completion')[];
  id: string;
  preview: boolean;
}

async function handleCopilotModelsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[ModelConfig[], null]> {
  const copilotToken = await ctx.get(CopilotTokenManager).getToken();
  return [filterModels(await ctx.get(ModelMetadataProvider).getMetadata(), copilotToken), null];
}

function filterModels(models: ModelMetadataType[], token: CopilotToken) {
  const uniqueModels = new Map<string, ModelConfig>();
  const otherModels: ModelConfig[] = [];
  const userModels = getSupportedModelFamiliesForPrompt('user');
  const inlineModels = getSupportedModelFamiliesForPrompt('inline');
  models.forEach((model) => {
    if (model.model_picker_enabled === true && isKnownModelFamily(model.capabilities.family)) {
      const family = model.capabilities.family;
      const scopes: ModelConfig['scopes'] = [];

      if (model.capabilities.type === 'chat') {
        if (userModels.includes(family)) {
          scopes.push('chat-panel');
          scopes.push('edit-panel');
        }

        if (inlineModels.includes(family)) {
          scopes.push('inline');
        }

        uniqueModels.set(model.capabilities.family, {
          modelFamily: model.capabilities.family,
          modelName: model.name,
          modelPolicy: model.policy,
          scopes,
          id: model.id,
          preview: model.preview ?? false,
        });
      } else {
        if (model.capabilities.type !== 'completion') {
          otherModels.push({
            modelFamily: model.capabilities.family,
            modelName: model.name,
            modelPolicy: model.policy,
            scopes,
            id: model.id,
            preview: model.preview ?? false,
          });
        }
      }
    }
  });
  const editorPreviewFeaturesDisabled = token.getTokenValue('editor_preview_features') == '0';
  AvailableModels.filterCompletionModels(models, editorPreviewFeaturesDisabled).forEach((model) => {
    otherModels.push({
      modelFamily: model.capabilities.family,
      modelName: model.name,
      modelPolicy: model.policy,
      scopes: ['completion'],
      id: model.id,
      preview: model.preview ?? false,
    });
  });
  return [...uniqueModels.values(), ...otherModels];
}

const Params = Type.Object({ options: Type.Optional(TestingOptions) });

const handleCopilotModels = ensureAuthenticated(addMethodHandlerValidation(Params, handleCopilotModelsChecked));

export { handleCopilotModels };
