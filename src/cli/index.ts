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

program.parse();
