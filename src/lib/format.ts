export interface TokenSavingsInput {
  tokensSent: number;
  estimatedWithout: number;
  reductionPct: number;
}

export function formatTokenSavings(input: TokenSavingsInput): string {
  const PAD = 27;
  const lines: [string, string][] = [
    ["Tokens sent to Claude:", input.tokensSent.toLocaleString()],
    ["Estimated without:", `~${input.estimatedWithout.toLocaleString()}`],
    ["Reduction:", `${input.reductionPct}%`],
  ];
  return lines
    .map(([label, value]) => `${label.padEnd(PAD)}${value}`)
    .join("\n");
}
