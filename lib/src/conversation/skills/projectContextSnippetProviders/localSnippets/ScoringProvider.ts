import { LRUCacheMap } from '../../../../common/cache';
import { Context } from '../../../../context';
import { IScoring } from './IndexingTypes';
import { getScoringAlgorithm } from './ScoringAlgorithms';

class ScoringProvider {
  private workspaceScoringProviders: LRUCacheMap<string, IScoring>;

  constructor() {
    this.workspaceScoringProviders = new LRUCacheMap(25);
  }

  createImplementation(ctx: Context, type: string): IScoring {
    const algorithmCtor = getScoringAlgorithm(type);
    return new algorithmCtor();
  }

  getImplementation(ctx: Context, workspaceFolder: string, type: string = 'default'): IScoring {
    let provider = this.workspaceScoringProviders.get(workspaceFolder);
    if (!provider) {
      provider = this.createImplementation(ctx, type);
      this.workspaceScoringProviders.set(workspaceFolder, provider);
    }
    return provider;
  }

  score(ctx: Context, workspaceFolder: string, vector1: number[], vector2: number[], type: string): number {
    const implementation = this.getImplementation(ctx, workspaceFolder, type);
    return implementation.score(vector1, vector2);
  }

  terminateScoring(
    ctx: Context,
    workspaceFolder: string,
    // optional ../../ProjectContextSkill.ts
    type?: string
  ): void {
    const implementation = this.getImplementation(ctx, workspaceFolder, type);
    implementation.terminateScoring();
  }
}

export { ScoringProvider };
