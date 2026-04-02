export interface TokenSavingsInput {
  tokensSent: number;
  estimatedWithout: number;
  reductionPct: number;
  filesInContext: number;
}

export function formatTokenSavings(input: TokenSavingsInput): string {
  const PAD = 27;
  const fileSuffix = input.filesInContext !== 1 ? 's' : '';
  const lines: [string, string][] = [
    ["Tokens sent to Claude:", input.tokensSent.toLocaleString()],
    ["Estimated without:", `~${input.estimatedWithout.toLocaleString()}  (${input.filesInContext} file${fileSuffix} + overhead)`],
    ["Reduction:", `${input.reductionPct}%`],
  ];
  return lines
    .map(([label, value]) => `${label.padEnd(PAD)}${value}`)
    .join("\n");
}
