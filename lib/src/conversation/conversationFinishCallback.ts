import { StreamCopilotAnnotations } from '../openai/stream.ts';
import { Unknown } from '../types.ts';

class ConversationFinishCallback {
  readonly deltaApplier: (text: string, annotations: Unknown.Annotation[]) => void;
  appliedLength: number = 0;
  appliedText: string = '';
  appliedAnnotations: number[] = [];

  constructor(deltaApplier: (text: string, annotations: Unknown.Annotation[]) => void) {
    this.deltaApplier = deltaApplier;
  }

  isFinishedAfter(text: string, annotations?: StreamCopilotAnnotations): void {
    const toApply = text.substring(this.appliedLength, text.length);
    const deltaAnnotations = this.mapAnnotations(annotations).filter((a) => !this.appliedAnnotations.includes(a.id));
    this.append(toApply, deltaAnnotations);
  }

  private append(text: string, annotations: Unknown.Annotation[]): void {
    this.deltaApplier(text, annotations);
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

  private mapAnnotations(annotations?: StreamCopilotAnnotations): Unknown.Annotation[] {
    if (!annotations) return [];
    const vulnerabilities = annotations
      .for('CodeVulnerability')
      .map((a): Unknown.Annotation => ({ ...a, type: 'code_vulnerability' }));
    return [...vulnerabilities];
  }
}

export { ConversationFinishCallback };
