import { CancellationToken } from 'vscode-languageserver';
import { CopilotJSXNode, CopilotJSXElement } from '../../../lib/src/prompt/jsxTypes.ts';
import { VirtualPromptReconciler } from './reconciler.ts';

interface CopilotJSXNodeStatistics {
  updateDataTimeMs?: number;
}

interface CopilotJSXNodeSnapshot {
  value?: string;
  name: string;
  path: string;
  props?: any;
  statistics: CopilotJSXNodeStatistics;
  children: CopilotJSXNodeSnapshot[];
}

class VirtualPrompt {
  readonly reconciler = new VirtualPromptReconciler();

  static async create(prompt: CopilotJSXElement): Promise<VirtualPrompt> {
    let virtualPrompt = new VirtualPrompt();
    await virtualPrompt.initialize(prompt);
    return virtualPrompt;
  }

  constructor() {}

  async initialize(prompt: CopilotJSXElement) {
    await this.reconciler.initialize(prompt);
  }

  snapshotNode(
    node: CopilotJSXNode<any>,
    cancellationToken: CancellationToken | undefined
  ): CopilotJSXNodeSnapshot | 'cancelled';
  snapshotNode(node: undefined, cancellationToken: CancellationToken | undefined): undefined;
  snapshotNode(
    node: CopilotJSXNode<any> | undefined,
    cancellationToken: CancellationToken | undefined
  ): CopilotJSXNodeSnapshot | 'cancelled' | undefined {
    if (!node) {
      return;
    }
    if (cancellationToken?.isCancellationRequested) {
      return 'cancelled';
    }
    const children: CopilotJSXNodeSnapshot[] = [];
    for (const child of node.children ?? []) {
      const result = this.snapshotNode(child, cancellationToken);
      if (result === 'cancelled') {
        return 'cancelled';
      }

      if (result !== undefined) {
        children.push(result);
      }
    }
    return {
      value: node.props?.value?.toString(),
      name: node.name,
      path: node.path,
      props: node.props,
      children,
      statistics: { updateDataTimeMs: node.lifecycle?.lifecycleData.getUpdateTimeMsAndReset() },
    };
  }

  async snapshot(cancellationToken: CancellationToken | undefined): Promise<VirtualPrompt.SnapshotResult> {
    try {
      const vTree = await this.reconciler.reconcile(cancellationToken);
      if (cancellationToken?.isCancellationRequested) {
        return { snapshot: undefined, status: 'cancelled' };
      }
      if (!vTree) {
        throw new Error('Invalid virtual prompt tree');
      }
      const snapshotNode = this.snapshotNode(vTree, cancellationToken);
      return snapshotNode === 'cancelled' || cancellationToken?.isCancellationRequested
        ? { snapshot: undefined, status: 'cancelled' }
        : { snapshot: snapshotNode, status: 'ok' };
    } catch (e) {
      return { snapshot: undefined, status: 'error', error: e };
    }
  }

  createPipe() {
    return this.reconciler.createPipe();
  }
}

namespace VirtualPrompt {
  export type SnapshotResult =
    | { snapshot: CopilotJSXNodeSnapshot; status: 'ok' }
    | { snapshot: undefined; status: 'error'; error: unknown }
    | { snapshot: undefined; status: 'cancelled' };
}

export { VirtualPrompt };

export type { CopilotJSXNodeStatistics, CopilotJSXNodeSnapshot };
