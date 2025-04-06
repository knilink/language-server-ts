function hasKey(value: unknown, key: string): boolean {
  return value !== null && typeof value == 'object' && key in value;
}
function getKey(value: any, key: string): unknown {
  return hasKey(value, key) ? value[key] : undefined;
}

export { getKey, hasKey };
