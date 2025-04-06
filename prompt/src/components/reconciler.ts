import type { CancellationToken } from 'vscode-languageserver';
import { UseData, UseEffect, UseState } from './hooks.ts';
import type {
  CopilotElementType,
  CopilotJSXElement,
  CopilotFragmentFunction,
  CopilotJSXNode,
  IPromptElementLifecycle,
  IPromptElementLifecycleData,
  CopilotFunctionComponent,
} from '../../../lib/src/prompt/jsxTypes.ts';

function isFragmentFunction(element: CopilotElementType): element is CopilotFragmentFunction {
  return typeof element == 'function' && 'isFragmentFunction' in element;
}

class VirtualPromptReconciler {
  lifecycleData = new Map<string, PromptElementLifecycleData>();
  vTree?: CopilotJSXNode;

  async initialize(prompt: CopilotJSXElement<any>) {
    this.vTree = await this.virtualizeElement(prompt, '$', 0);
  }

  async reconcile(cancellationToken: CancellationToken | undefined) {
    if (!this.vTree) {
      throw new Error('No tree to reconcile, make sure to pass a valid prompt');
    }
    if (cancellationToken?.isCancellationRequested) {
      return this.vTree;
    }
    this.vTree = await this.reconcileNode(this.vTree, '$', 0, cancellationToken);
    return this.vTree;
  }

  async reconcileNode(
    node: CopilotJSXNode,
    parentNodePath: string,
    nodeIndex: number,
    cancellationToken: CancellationToken | undefined
  ) {
    if (!node.children && !node.lifecycle) {
      return node;
    }
    let newNode: CopilotJSXNode | undefined = node;
    if (node.lifecycle?.isRemountRequired()) {
      const oldChildrenPaths = this.collectChildPaths(node);
      await node.lifecycle?.componentWillUnmount();
      newNode = await this.virtualizeElement(node.component, parentNodePath, nodeIndex);
      const newChildrenPaths = this.collectChildPaths(newNode);
      this.cleanupState(oldChildrenPaths, newChildrenPaths);
    } else if (node.children) {
      const children = [];
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child) {
          const reconciledChild = await this.reconcileNode(child, node.path, i, cancellationToken);

          if (reconciledChild !== undefined) {
            children.push(reconciledChild);
          }
        }
      }
      newNode.children = children;
    }
    return newNode;
  }

  async virtualizeElement(
    component: CopilotJSXElement<any>,
    parentNodePath: string,
    nodeIndex: number
  ): Promise<CopilotJSXNode | undefined> {
    if (!(typeof component > 'u')) {
      if (typeof component == 'string' || typeof component == 'number') {
        return {
          name: typeof component,
          path: `${parentNodePath}[${nodeIndex}]`,
          props: { value: component },
          component,
        };
      }
      if (isFragmentFunction(component.type)) {
        const fragment = component.type(component.props.children);
        const indexIndicator = parentNodePath !== '$' ? `[${nodeIndex}]` : '';
        const componentPath = `${parentNodePath}${indexIndicator}.${fragment.type}`;
        const children = await Promise.all(
          fragment.children.map((c, i) => this.virtualizeElement(c, componentPath, i))
        );
        this.ensureUniqueKeys(children);
        return {
          name: fragment.type,
          path: componentPath,
          children: children.flat().filter((c) => c !== undefined),
          component,
        };
      }
      return await this.virtualizeFunctionComponent(parentNodePath, nodeIndex, component, component.type);
    }
  }

  async virtualizeFunctionComponent(
    parentNodePath: string,
    nodeIndex: number,
    component: CopilotJSXElement,
    functionComponent: CopilotFunctionComponent
  ) {
    const indexIndicator = component.props.key ? `["${component.props.key}"]` : `[${nodeIndex}]`;
    const componentPath = `${parentNodePath}${indexIndicator}.${functionComponent.name}`;
    const lifecycle = new PromptElementLifecycle(this.getOrCreateLifecycleData(componentPath));
    await lifecycle.componentWillMount();
    const element = await functionComponent(component.props, lifecycle);
    await lifecycle.componentDidMount();
    const elementToVirtualize = Array.isArray(element) ? element : [element];
    const children = (await Promise.all(elementToVirtualize.map((e, i) => this.virtualizeElement(e, componentPath, i))))
      .flat()
      .filter((e) => e !== undefined);
    this.ensureUniqueKeys(children);
    return {
      name: functionComponent.name,
      path: componentPath,
      props: component.props,
      children,
      component,
      lifecycle,
    };
  }
  ensureUniqueKeys(nodes: (CopilotJSXNode<any> | undefined)[]) {
    let keyCount = new Map();
    for (const node of nodes) {
      if (!node) {
        continue;
      }
      const key = node.props?.key;

      if (key) {
        keyCount.set(key, (keyCount.get(key) || 0) + 1);
      }
    }
    let duplicates = Array.from(keyCount.entries())
      .filter(([_, count]) => count > 1)
      .map(([key]) => key);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate keys found: ${duplicates.join(', ')}`);
    }
  }
  collectChildPaths(node?: CopilotJSXNode): string[] {
    const paths = [];
    if (node?.children) {
      for (let child of node.children) child && (paths.push(child.path), paths.push(...this.collectChildPaths(child)));
    }
    return paths;
  }
  cleanupState(oldChildrenPaths: string[], newChildrenPaths: string[]) {
    for (const path of oldChildrenPaths) newChildrenPaths.includes(path) || this.lifecycleData.delete(path);
  }
  getOrCreateLifecycleData(path: string): PromptElementLifecycleData {
    let data = this.lifecycleData.get(path);
    if (!data) {
      data = new PromptElementLifecycleData([]);
      this.lifecycleData.set(path, data);
    }

    return data;
  }
  createPipe(): VirtualPromptReconciler.Pipe {
    return {
      pump: async (data: unknown) => {
        await this.pumpData(data);
      },
    };
  }
  async pumpData(data: unknown) {
    if (!this.vTree) {
      throw new Error('No tree to pump data into. Pumping data before initializing?');
    }
    await this.recursivelyPumpData(data, this.vTree);
  }
  async recursivelyPumpData(data: unknown, node: CopilotJSXNode) {
    if (!node) {
      throw new Error("Can't pump data into undefined node.");
    }
    await node.lifecycle?.dataHook.updateData(data);
    for (let child of node.children || []) await this.recursivelyPumpData(data, child);
  }
}

namespace VirtualPromptReconciler {
  export interface Pipe {
    pump: (data: unknown) => Promise<void>;
  }
}

class PromptElementLifecycleData implements IPromptElementLifecycleData {
  _updateTimeMs = 0;
  constructor(readonly state: unknown[]) {}
  getUpdateTimeMsAndReset() {
    let value = this._updateTimeMs;
    this._updateTimeMs = 0;
    return value;
  }
}

class PromptElementLifecycle implements IPromptElementLifecycle {
  readonly effectHook = new UseEffect();
  readonly stateHook: UseState;
  readonly dataHook: UseData;

  constructor(readonly lifecycleData: PromptElementLifecycleData) {
    this.stateHook = new UseState(lifecycleData.state);
    this.dataHook = new UseData((updateTimeMs) => {
      lifecycleData._updateTimeMs = updateTimeMs;
    });
  }

  useState<S>(initialState?: (() => S) | S): [S, UseState.Dispatch<UseState.BasicStateAction<S>>] {
    return this.stateHook.useState(initialState);
  }

  useEffect(effect: () => Promise<() => Promise<void>>) {
    this.effectHook.useEffect(effect);
  }

  useData<T>(typePredicate: UseData.Consumer<T>['predicate'], consumer: UseData.Consumer<T>['consumer']) {
    this.dataHook.useData(typePredicate, consumer);
  }

  isRemountRequired(): boolean {
    return this.stateHook.hasChanged();
  }

  async componentWillMount(): Promise<void> {
    await this.effectHook.runEffects();
  }

  async componentDidMount(): Promise<void> {
    await this.effectHook.runEffects();
  }

  async componentWillUnmount(): Promise<void> {
    await this.effectHook.cleanup();
  }
}

export { VirtualPromptReconciler };
