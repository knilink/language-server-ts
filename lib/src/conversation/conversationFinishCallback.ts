import type { CopilotConfirmation } from '../openai/types.ts';

import { SSEProcessor, StreamCopilotAnnotations } from '../openai/stream.ts';
import { Unknown } from '../types.ts';
import { filterUnsupportedReferences } from './extensibility/references.ts';
import { Reference } from './schema.ts';

class ConversationFinishCallback {
  appliedLength: number = 0;
  appliedText: string = '';
  appliedAnnotations: number[] = [];

  constructor(
    readonly deltaApplier: (
      text: string,
      annotations: Unknown.Annotation[],
      references: Reference[],
      errors: unknown[],
      confirmation?: CopilotConfirmation
    ) => void
  ) {}

  isFinishedAfter(text: string, delta: SSEProcessor.FinishedCbDelta): undefined {
    const toApply = text.substring(this.appliedLength, text.length);
    let deltaAnnotations = this.mapAnnotations(delta.annotations).filter(
      (a) => !this.appliedAnnotations.includes(a.id)
    );
    this.append(
      toApply,
      deltaAnnotations,
      filterUnsupportedReferences(delta.copilotReferences),
      delta.copilotErrors ?? [],
      delta.copilotConfirmation
    );
  }

  append(
    text: string,
    annotations: Unknown.Annotation[],
    references: Reference[],
    errors: unknown[],
    confirmation?: CopilotConfirmation
  ): void {
    this.deltaApplier(text, annotations, references, errors, confirmation);
    this.appliedLength += text.length;
    this.appliedText += text;
    this.appliedAnnotations.push(...annotations.map((a) => a.id));
  }

  // private mapAnnotations<T extends { type: string }>(annotations?: T[]): T[] {
  //   if (!annotations || annotations.length === 0) return [];
  //   const mappedAnnotations = [...this.mapCodeVulnerabilities<T>(annotations)];
  //   return mappedAnnotations;
  // }
  //
  // private mapCodeVulnerabilities<T extends { type: string }>(annotations: T[]): T[] {
  //   return annotations
  //     .filter((a) => a.type === 'CodeVulnerability') // MARK fuck this
  //     .map((a) => ({ ...a, type: 'code_vulnerability' }));
  // }

  mapAnnotations(annotations?: StreamCopilotAnnotations): Unknown.Annotation[] {
    if (!annotations) return [];
    const vulnerabilities = annotations
      .for('CodeVulnerability')
      .map((a): Unknown.Annotation => ({ ...a, type: 'code_vulnerability' as 'code_vulnerability' }));
    const IPCodeCitations = annotations
      .for('IPCodeCitations')
      .map((a) => ({ ...a, type: 'ip_code_citations' as 'ip_code_citations' }));

    return [...vulnerabilities, ...IPCodeCitations];
  }
}

export { ConversationFinishCallback };
