import { APIChoice } from '../openai/openai.ts';
import {} from // TODO: import Choice
'./ghostText.ts';

function adjustChoicesStart(choices: APIChoice[], remainingPrefix: string): APIChoice[] {
  return choices
    .filter((choice) => startsWithAndExceeds(choice.completionText, remainingPrefix))
    .map((choice) => ({
      ...choice,
      completionText: choice.completionText.substring(remainingPrefix.length),
    }));
}

function startsWithAndExceeds(text: string, prefix: string): boolean {
  return text.startsWith(prefix) && text.length > prefix.length;
}

class CurrentGhostText {
  prefix?: string;
  suffix?: string;
  choices: APIChoice[] = [];

  get clientCompletionId(): string | undefined {
    return this.choices[0]?.clientCompletionId;
  }

  setGhostText(prefix: string, suffix: string, choices: APIChoice[], resultType: number): void {
    if (resultType !== 2) {
      this.prefix = prefix;
      this.suffix = suffix;
      this.choices = choices;
    }
  }

  getCompletionsForUserTyping(prefix: string, suffix: string): APIChoice[] | undefined {
    const remainingPrefix = this.getRemainingPrefix(prefix, suffix);
    if (remainingPrefix !== undefined && startsWithAndExceeds(this.choices[0].completionText, remainingPrefix)) {
      return adjustChoicesStart(this.choices, remainingPrefix);
    }
  }

  hasAcceptedCurrentCompletion(prefix: string, suffix: string): boolean {
    const remainingPrefix = this.getRemainingPrefix(prefix, suffix);
    return remainingPrefix !== undefined && remainingPrefix === this.choices[0]?.completionText;
  }

  getRemainingPrefix(prefix: string, suffix: string): string | undefined {
    if (
      this.prefix !== undefined &&
      this.suffix !== undefined &&
      this.choices.length > 0 &&
      this.suffix === suffix &&
      prefix.startsWith(this.prefix)
    ) {
      return prefix.substring(this.prefix.length);
    }
  }
}

export { CurrentGhostText };
