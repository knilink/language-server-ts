import { LRUCacheMap } from '../../../../common/cache.ts';
import { Context } from '../../../../context.ts';
import { IScoring } from './IndexingTypes.ts';
import { getScoringAlgorithm } from './ScoringAlgorithms.ts';

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
    this.getImplementation(ctx, workspaceFolder, type).terminateScoring();
    this.workspaceScoringProviders.delete(workspaceFolder);
  }
}

export { ScoringProvider };
