import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { classifyRetrievalMode } from '../src/services/retriever.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deterministic = process.argv.includes('--deterministic');
const outputArg = process.argv.indexOf('--output');
const outputDir = outputArg >= 0 ? resolve(process.argv[outputArg + 1]) : resolve(root, 'benchmarks/results');
const CaseSchema = z.object({
  query: z.string().min(1),
  category: z.enum(['lookup', 'trace', 'explore', 'test-focused', 'ambiguous', 'multi-file']),
  intent: z.enum(['lookup', 'trace', 'explore']),
  expectedFiles: z.array(z.string()).min(1),
  rankedFiles: z.array(z.string()).optional(),
  contextTokens: z.number().int().nonnegative().optional(),
});
const cases = z.array(CaseSchema).min(1).parse(JSON.parse(await readFile(resolve(root, 'benchmarks/retrieval/cases.json'), 'utf8')));

let ollamaVersion: string | null = null;
let model = 'deterministic-fixture';
let modelDigest: string | null = null;
if (!deterministic) {
  const { isOllamaRunning, getOllamaVersion } = await import('../src/services/ollama.js');
  if (!(await isOllamaRunning())) throw new Error('Ollama is required for the live retrieval evaluation. Start it and run brain-cache init first.');
  const { readProfile } = await import('../src/services/capability.js');
  const profile = await readProfile();
  if (!profile) throw new Error("No capability profile found. Run 'brain-cache init' first.");
  model = profile.embeddingModel;
  ollamaVersion = await getOllamaVersion();
  const ollama = (await import('ollama')).default;
  modelDigest = (await ollama.list()).models.find((entry) => entry.name.split(':')[0] === model.split(':')[0])?.digest ?? null;
  const { runIndex } = await import('../src/workflows/index.js');
  await runIndex(resolve(root, 'benchmarks/retrieval/fixture'), { force: true });
}

const rows = [];
for (const item of cases) {
  const started = performance.now();
  let rankedFiles = item.rankedFiles ?? [];
  let contextTokens = item.contextTokens ?? 0;
  if (!deterministic) {
    const fixture = resolve(root, 'benchmarks/retrieval/fixture');
    const { runSearch } = await import('../src/workflows/search.js');
    const { runBuildContext } = await import('../src/workflows/buildContext.js');
    rankedFiles = (await runSearch(item.query, { path: fixture, limit: 5 })).chunks.map((chunk) => chunk.filePath.replaceAll('\\', '/').split('/fixture/').at(-1)!);
    contextTokens = (await runBuildContext(item.query, { path: fixture })).metadata.tokensSent;
  }
  const latencyMs = performance.now() - started;
  const firstRank = rankedFiles.findIndex((file) => item.expectedFiles.includes(file)) + 1;
  rows.push({ ...item, predictedIntent: classifyRetrievalMode(item.query), rankedFiles, contextTokens, latencyMs, firstRank });
}

const sortedLatency = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
const percentile = (p: number) => sortedLatency[Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * p))];
const metrics = {
  intentAccuracy: rows.filter((row) => row.predictedIntent === row.intent).length / rows.length,
  recallAt5: rows.filter((row) => row.firstRank > 0 && row.firstRank <= 5).length / rows.length,
  meanReciprocalRank: rows.reduce((sum, row) => sum + (row.firstRank > 0 ? 1 / row.firstRank : 0), 0) / rows.length,
  expectedFileHitRate: rows.reduce((sum, row) => sum + row.expectedFiles.filter((file) => row.rankedFiles.includes(file)).length / row.expectedFiles.length, 0) / rows.length,
  meanContextTokens: rows.reduce((sum, row) => sum + row.contextTokens, 0) / rows.length,
  latencyP50Ms: percentile(0.5),
  latencyP95Ms: percentile(0.95),
};
const report = {
  schemaVersion: 1,
  mode: deterministic ? 'deterministic' : 'live',
  generatedAt: new Date().toISOString(),
  environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model ?? null, node: process.version, ollamaVersion, model, modelDigest, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() },
  caseCount: rows.length,
  metrics,
  cases: rows,
};
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'retrieval.json'), JSON.stringify(report, null, 2));
const markdown = `# Retrieval evaluation\n\nMode: **${report.mode}** · Cases: **${report.caseCount}**\n\n| Metric | Value |\n|---|---:|\n${Object.entries(metrics).map(([key, value]) => `| ${key} | ${typeof value === 'number' ? value.toFixed(3) : value} |`).join('\n')}\n`;
await writeFile(resolve(outputDir, 'retrieval.md'), markdown);
process.stdout.write(`${markdown}\nResults written to ${outputDir}\n`);
