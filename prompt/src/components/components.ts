function Text(props: { children?: string[] | string }): string | undefined {
  if (props.children) {
    return Array.isArray(props.children) ? props.children.join('') : props.children;
  }
}

function Chunk(props: { children?: string[] | string }): string[] | string | undefined {
  return props.children;
}

export { Chunk, Text };
