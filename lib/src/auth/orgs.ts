function findKnownOrg(orgs: string[]): string | undefined {
  return [
    'a5db0bcaae94032fe715fb34a5e4bce2',
    '7184f66dfcee98cb5f08a1cb936d5225',
    '4535c7beffc844b46bb1ed4aa04d759a',
  ].find((o) => orgs.includes(o));
}

export { findKnownOrg };
