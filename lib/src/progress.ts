abstract class StatusReporter {
  // ./openai/fetch.ts setWarning()
  abstract setWarning(message?: string): void;
  abstract setError(message: string): void;
  // optional ../../agent/src/editorFeatures/statusReporter.ts
  abstract setInactive(message?: string): void;
  // ./contentExclusion/contentExclusionManager.ts
  abstract forceNormal(): void;
  // ./ghostText/ghostText.ts
  abstract setProgress(): void;
  // ./ghostText/ghostText.ts
  abstract removeProgress(): void;
}

export { StatusReporter };
