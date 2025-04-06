import { Type, type Static } from '@sinclair/typebox';
import { Context } from '../../../../lib/src/context.ts';
import { getUserFacingPromptTemplates, IPromptTemplate } from '../../../../lib/src/conversation/promptTemplates.ts';
import { TestingOptions } from '../testingOptions.ts';
import { ensureAuthenticated } from '../../auth/authDecorator.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';

const Params = Type.Object({ options: Type.Optional(TestingOptions) });

async function handleConversationTemplatesChecked(
  ctx: Context,
  token: unknown,
  params: Static<typeof Params>
): Promise<[Pick<IPromptTemplate, 'id' | 'description' | 'shortDescription' | 'scopes'>[], null]> {
  return [
    getUserFacingPromptTemplates(ctx).map((t) => ({
      id: t.id,
      description: t.description,
      shortDescription: t.shortDescription,
      scopes: t.scopes,
    })),
    null,
  ];
}

const handleConversationTemplates = ensureAuthenticated(
  addMethodHandlerValidation(Params, handleConversationTemplatesChecked)
);

export { handleConversationTemplates };
