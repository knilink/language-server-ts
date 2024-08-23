function isRepetitive(tokens: string[]): boolean {
  const tokensBackwards = [...tokens].reverse();
  return (
    isRepeatedPattern(tokensBackwards) || isRepeatedPattern(tokensBackwards.filter((token) => token.trim().length > 0))
  );
}

function isRepeatedPattern(tokens: string[]): boolean {
  const prefix = kmp_prefix_function(tokens);
  for (const config of configs) {
    if (tokens.length < config.last_tokens_to_consider) continue;
    if (
      config.last_tokens_to_consider - 1 - prefix[config.last_tokens_to_consider - 1] <=
      config.max_token_sequence_length
    )
      return true;
  }
  return false;
}

function kmp_prefix_function(tokens: string[]): number[] {
  const pi = Array(tokens.length).fill(0);
  pi[0] = -1;
  let k = -1;
  for (let q = 1; q < tokens.length; q++) {
    while (k >= 0 && tokens[k + 1] !== tokens[q]) {
      k = pi[k];
    }
    if (tokens[k + 1] === tokens[q]) k++;
    pi[q] = k;
  }
  return pi;
}

const configs: { max_token_sequence_length: number; last_tokens_to_consider: number }[] = [
  { max_token_sequence_length: 1, last_tokens_to_consider: 10 },
  { max_token_sequence_length: 10, last_tokens_to_consider: 30 },
  { max_token_sequence_length: 20, last_tokens_to_consider: 45 },
  { max_token_sequence_length: 30, last_tokens_to_consider: 60 },
];

export { isRepetitive, isRepeatedPattern, kmp_prefix_function };
