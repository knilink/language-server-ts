function findEditDistanceScore(a: number[], b: number[]): { score: number } {
  if (a.length === 0 || b.length === 0) return { score: a.length + b.length };
  let matrix = Array.from({ length: a.length }).map(() => Array.from({ length: b.length }).map(() => 0));
  for (let i = 0; i < a.length; i++) matrix[i][0] = i;
  for (let i = 0; i < b.length; i++) matrix[0][i] = i;
  for (let j = 0; j < b.length; j++)
    for (let i = 0; i < a.length; i++)
      matrix[i][j] = Math.min(
        (i === 0 ? j : matrix[i - 1][j]) + 1,
        (j === 0 ? i : matrix[i][j - 1]) + 1,
        (i === 0 || j === 0 ? Math.max(i, j) : matrix[i - 1][j - 1]) + (a[i] == b[j] ? 0 : 1)
      );
  return { score: matrix[a.length - 1][b.length - 1] };
}

export { findEditDistanceScore };
