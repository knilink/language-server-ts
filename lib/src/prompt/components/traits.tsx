import type { CopilotFunctionComponent } from '../jsxTypes.ts';
import { LanguageId } from '../../types.ts';

import { isCompletionRequestData } from './completionsPrompt.tsx';
import { Text } from '../../../../prompt/src/components/components.ts';
import { commentBlockAsSingles } from '../../../../prompt/src/languageMarker.ts';
import { normalizeLanguageId } from '../../../../prompt/src/prompt.ts';
import { TraitType } from '../contextProviders/contextItemSchemas.ts';

const Traits: CopilotFunctionComponent<{ weight: number }> = (_props, context) => {
  const [traits, setTraits] = context.useState<TraitType[] | undefined>();
  const [languageId, setLanguageId] = context.useState<LanguageId>();

  context.useData(isCompletionRequestData, (data) => {
    if (data.traits !== traits) {
      setTraits(data.traits);
    }

    const normalizedLanguageId = normalizeLanguageId(data.document.clientLanguageId);

    if (normalizedLanguageId !== languageId) {
      setLanguageId(normalizedLanguageId);
    }
  });

  if (!(!traits || traits.length === 0 || !languageId)) {
    return (
      <>
        <Text>{commentBlockAsSingles(`Consider this related information:\n`, languageId)}</Text>
        {...traits.map((trait) => (
          <Text key={trait.id}>{commentBlockAsSingles(`${trait.name}: ${trait.value}`, languageId)}</Text>
        ))}
      </>
    );
  }
};

export { Traits };
