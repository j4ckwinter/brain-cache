import { Command } from 'commander';

const program = new Command();

program
  .name('brain-cache')
  .description('Local AI runtime \u2014 GPU cache layer for Claude')
  .version('0.1.0');

program
  .command('init')
  .description('Detect hardware, pull embedding model, create config directory')
  .action(async () => {
    const { runInit } = await import('../workflows/init.js');
    await runInit();
  });

program
  .command('doctor')
  .description('Report system health: GPU, VRAM tier, Ollama status')
  .action(async () => {
    const { runDoctor } = await import('../workflows/doctor.js');
    await runDoctor();
  });

program
  .command('index')
  .description('Index a codebase: parse, chunk, embed, and store in LanceDB')
  .argument('[path]', 'Directory to index (defaults to current directory)')
  .action(async (path?: string) => {
    const { runIndex } = await import('../workflows/index.js');
    await runIndex(path);
  });

program
  .command('search')
  .description('Search indexed codebase with a natural language query')
  .argument('<query>', 'Natural language query string')
  .option('-n, --limit <n>', 'Maximum number of results', '10')
  .option('-p, --path <path>', 'Project root directory')
  .action(async (query: string, opts: { limit: string; path?: string }) => {
    const { runSearch } = await import('../workflows/search.js');
    await runSearch(query, {
      limit: parseInt(opts.limit, 10),
      path: opts.path,
    });
  });

program
  .command('context')
  .description('Build token-budgeted context from codebase for a query')
  .argument('<query>', 'Natural language query string')
  .option('-n, --limit <n>', 'Maximum number of search results', '10')
  .option('-b, --budget <tokens>', 'Token budget for assembled context', '4096')
  .option('-p, --path <path>', 'Project root directory')
  .action(async (query: string, opts: { limit: string; budget: string; path?: string }) => {
    const { runBuildContext } = await import('../workflows/buildContext.js');
    const result = await runBuildContext(query, {
      limit: parseInt(opts.limit, 10),
      maxTokens: parseInt(opts.budget, 10),
      path: opts.path,
    });
    // Output result JSON to stdout (MCP transport compatible)
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  });

program.parse();
