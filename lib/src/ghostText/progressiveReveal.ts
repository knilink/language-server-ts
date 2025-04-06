import type { APIChoice } from '../openai/openai.ts';
import type { Context } from '../context.ts';
import type { TelemetryWithExp } from '../telemetry.ts';

import { ConfigKey, getConfig } from '../config.ts';
import { Features } from '../experiments/features.ts';
import { Logger } from '../logger.ts';

function isProgressRevealChoice(choice: ProgressAPIChoice): choice is ProgressAPIChoice & { sectionIndex: number } {
  return choice.sectionIndex !== undefined; // MARK f*
}

function isProgressiveRevealEnabled(ctx: Context, telemetryWithExp: TelemetryWithExp) {
  return (
    ctx.get(Features).enableProgressiveReveal(telemetryWithExp) || getConfig(ctx, ConfigKey.EnableProgressiveReveal)
  );
}

const logger = new Logger('progressiveReveal');

interface ProgressAPIChoice extends APIChoice {
  // MARK can be inferred as required, making optional to avoid complicated APIChoiceWithIndex | APIChoice type
  sectionIndex?: number;
  sectionCount?: number;
}

class CompletionTextSplitter {
  firstLine = true;
  sectionCount = 0;
  lines: string[];
  constructor(text: string) {
    this.lines = text.split('\n');
  }
  hasNextSection() {
    return this.lines.some((line) => line.trim() !== '');
  }
  nextSection(): string | undefined {
    const targetSize = this.sectionCount == 0 ? 1 : this.sectionCount == 1 ? 3 : 5;
    const result = [];
    let nextLine: string | undefined;
    while (result.length < targetSize && (nextLine = this.nextLine())) {
      result.push(nextLine);
    }
    if (result.length != 0) {
      this.sectionCount++;
      return result.concat(this.nextSectionTrailers()).join('');
    }
  }
  nextLine() {
    let result = [];
    for (this.firstLine || result.push(''); this.lines.length > 0 && /^\s*$/.test(this.lines[0]); ) {
      result.push(this.lines.shift());
    }
    if (this.lines.length !== 0) {
      this.firstLine = false;
      return result.concat(this.lines.shift()).join('\n');
    }
  }
  nextSectionTrailers() {
    const result: string[] = [];
    while (this.lines.length > 0 && /^\s*(?:end|[)>}\]"'`]*\s*[;,]?)\s*$/.test(this.lines[0])) {
      result.push(this.lines.shift()!);
    }
    while (result.length > 0 && /^\s*$/.test(result[result.length - 1])) {
      this.lines.unshift(result.pop()!);
    }
    return result.map((l) => '\n' + l);
  }
}

class ChoiceSplitter {
  issuedChoices: ProgressAPIChoice[] = [];
  textSplitter: CompletionTextSplitter;

  constructor(
    readonly ctx: Context,
    readonly docPrefix: string,
    readonly promptPrefix: string,
    readonly telemetryWithExp: TelemetryWithExp,
    // APIChoice ./ghostText.ts
    readonly choice: APIChoice
  ) {
    this.textSplitter = new CompletionTextSplitter(this.choice.completionText);
  }

  get isEnabled() {
    return isProgressiveRevealEnabled(this.ctx, this.telemetryWithExp);
  }

  *choices(): Generator<{ docPrefix: string; promptPrefix: string; choice: ProgressAPIChoice }> {
    const firstLine = this.textSplitter.nextSection();
    if (!this.textSplitter.hasNextSection() || !this.isEnabled) {
      {
        yield { docPrefix: this.docPrefix, promptPrefix: this.promptPrefix, choice: this.choice };
        return;
      }
    } else {
      yield {
        docPrefix: this.docPrefix,
        promptPrefix: this.promptPrefix,
        choice: this.makeNewChoice(
          firstLine! // MARK ?? hasNextSection() -> firstLine != nil f*ck
        ),
      };
    }
    logger.debug(this.ctx, 'Breaking into multiple completions for progressive reveal');
    logger.debug(this.ctx, `  first completion '${firstLine}'`);
    let afterText = firstLine;
    let nextCompletionText;
    while ((nextCompletionText = this.textSplitter.nextSection()) !== undefined) {
      logger.debug(this.ctx, `  next completion '${nextCompletionText}'`);
      yield {
        docPrefix: this.docPrefix + afterText,
        promptPrefix: this.promptPrefix + afterText,
        choice: this.makeNewChoice(nextCompletionText, afterText),
      };
      afterText += nextCompletionText;
    }
  }

  makeNewChoice(newText: string, prefixAddition?: string): ProgressAPIChoice {
    const newChoice = {
      ...this.choice,
      completionText: newText,
      copilotAnnotations: this.adjustedAnnotations(newText, prefixAddition ?? ''),
      sectionIndex: this.issuedChoices.length,
    };
    this.issuedChoices.push(newChoice);
    this.issuedChoices.forEach((c) => (c.sectionCount = this.issuedChoices.length));
    return newChoice;
  }

  adjustedAnnotations(newText: string, prefixAddition: string): APIChoice['copilotAnnotations'] | undefined {
    if (this.choice.copilotAnnotations === undefined) {
      return;
    }
    const newStartOffset = prefixAddition.length;
    const atEnd = newStartOffset + newText.length >= this.choice.completionText.length;
    const adjusted: Record<string, unknown> = {};
    for (const [name, annotationGroup] of Object.entries(this.choice.copilotAnnotations)) {
      const adjustedAnnotations = annotationGroup
        .filter((a) => a.start_offset - newStartOffset < newText.length && a.stop_offset - newStartOffset > 0)
        .map((a) => {
          const newA = { ...a };
          newA.start_offset -= newStartOffset;
          newA.stop_offset -= newStartOffset;

          if (!atEnd) {
            newA.stop_offset = Math.min(newA.stop_offset, newText.length);
          }

          return newA;
        });

      if (adjustedAnnotations.length > 0) {
        adjusted[name] = adjustedAnnotations;
      }
    }
    return Object.keys(adjusted).length > 0 ? adjusted : undefined;
  }
}

export { ChoiceSplitter, isProgressRevealChoice, isProgressiveRevealEnabled };
