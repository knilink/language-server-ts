// export type ElementType<P = any> = ComponentType<P>;
//
// export type ComponentType<P = {}> = FunctionComponent<P>;
//
// export type JSXElementConstructor<P> = (props: P) => JSXNode | Promise<JSXNode>;
//
// // export interface JSXElement<
// //   P = unknown,
// //   T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>,
// // > {
// //   type: T;
// //   props: P;
// //   key: string | null;
// // }
//
// export interface JSXElement<
//   P = unknown,
//   T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>,
// > {
//   type: T;
//   props: P & { key?: string };
// }
//
// // export interface ExoticComponent<P = {}> {
// //   (props: P): JSXNode;
// //   readonly $$typeof: symbol;
// // }
//
// export type JSXNode =
//   | JSXElement
//   | string
//   | number
//   | bigint
//   | Iterable<JSXNode>
//   | boolean
//   | null
//   | undefined
//   | Promise<AwaitedJSXNode>;
//
// export type AwaitedJSXNode = JSXElement | string | number | bigint | Iterable<JSXNode> | boolean | null | undefined;
//
// export interface FunctionComponent<P = {}> {
//   (props: P): JSXNode | Promise<JSXNode>;
//   // propTypes?: any;
//   // displayName?: string | undefined;
// }

////////////////////////////////////////////////////////////////////////////////
// MARK craps starts here

export namespace UseState {
  export type BasicStateAction<S> = ((prevState: S) => S) | S;
  export type Dispatch<A> = (action: A) => void;
  export interface IUseState {
    useState<S>(initialState?: (() => S) | S): [S, UseState.Dispatch<UseState.BasicStateAction<S>>];
    hasChanged(): boolean;
  }
}

export namespace UseData {
  export type Consumer<T> = {
    predicate: (data: any) => data is T;
    consumer: (data: T) => Promise<void> | void;
  };
  export interface IUseData {
    useData<T>(typePredicate: UseData.Consumer<T>['predicate'], consumer: UseData.Consumer<T>['consumer']): void;
    updateData(data: unknown): Promise<void>;
  }
}

export namespace UseEffect {
  export interface IUseEffect {
    useEffect(effect: () => Promise<() => Promise<void>>): void;
    runEffects(): Promise<void>;
    cleanup(): Promise<void>;
  }
}

export interface CopilotFragmentFunction {
  (children: CopilotJSXElement[]): { type: 'f'; children: CopilotJSXElement[]; props: {} };
  isFragmentFunction: true;
}

export type CopilotElementType = CopilotFunctionComponent | CopilotFragmentFunction;

export interface IPromptElementLifecycleData {
  getUpdateTimeMsAndReset(): number;
}

export interface IPromptElementLifecycle
  extends Pick<UseState.IUseState, 'useState'>,
    Pick<UseData.IUseData, 'useData'>,
    Pick<UseEffect.IUseEffect, 'useEffect'> {
  readonly effectHook: UseEffect.IUseEffect;
  readonly stateHook: UseState.IUseState;
  readonly dataHook: UseData.IUseData;
  readonly lifecycleData: IPromptElementLifecycleData;
  isRemountRequired(): boolean;
  componentWillMount(): Promise<void>;
  componentDidMount(): Promise<void>;
  componentWillUnmount(): Promise<void>;
}

export interface CopilotFunctionComponent<P = {}> {
  (props: P, lifecycle: IPromptElementLifecycle): CopilotJSXNode | Promise<CopilotJSXNode> | undefined;
  // propTypes?: any;
  // displayName?: string | undefined;
}

export interface CopilotJSXElement<P = unknown> {
  type: CopilotElementType;
  props: P & { key?: string };
}

export interface CopilotJSXNode<P = unknown> {
  value?: string;
  name: string;
  path: string;
  component: CopilotJSXElement<any>;
  props?: P;
  children?: CopilotJSXNode[];
  lifecycle?: IPromptElementLifecycle;
}
