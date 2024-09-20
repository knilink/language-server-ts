import { default as open } from 'open';

export abstract class UrlOpener {
  abstract open(target: string): Promise<void>;
}

export class SpawnUrlOpener extends UrlOpener {
  async open(target: string): Promise<void> {
    await open(target);
  }
}
