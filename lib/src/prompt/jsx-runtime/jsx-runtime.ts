import type { CopilotElementType, CopilotJSXNode, CopilotJSXElement, CopilotFragmentFunction } from '../jsxTypes.ts';

function functionComponentFunction<P = {}>(
  type: CopilotElementType,
  props: { children?: Element } & P,
  key?: string
): CopilotJSXElement {
  let children: Element[] = [];

  if (Array.isArray(props.children)) {
    children = props.children;
  } else if (props.children) {
    children = [props.children];
  }

  const componentProps: CopilotJSXElement<P>['props'] = { ...props, children };

  if (key) {
    componentProps.key = key;
  }

  return { type, props: componentProps };
}

const fragmentFunction: CopilotFragmentFunction = Object.assign(
  (children: CopilotJSXElement[]) => ({
    type: 'f' as 'f',
    children,
    props: {},
  }),
  { isFragmentFunction: true as true }
);

namespace JSX {
  export interface IntrinsicAttributes {
    key?: any;
    // MARK maybe
    weight?: number;
  }
}

export {
  // fragmentFunction,
  // functionComponentFunction,
  // compilerOptions.jsxFactory and .jsxFragmentFactory doesn't seem to be working as expected
  JSX,
  fragmentFunction,
  functionComponentFunction,
  // functionComponentFunction as jsx,
  // functionComponentFunction as jsxs,
  CopilotFragmentFunction,
};
