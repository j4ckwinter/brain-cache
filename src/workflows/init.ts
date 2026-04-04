import { existsSync, readFileSync, writeFileSync, appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  detectCapabilities,
  writeProfile,
} from '../services/capability.js';
import {
  isOllamaInstalled,
  isOllamaRunning,
  startOllama,
  pullModelIfMissing,
  getOllamaVersion,
} from '../services/ollama.js';

/**
 * Orchestrates Phase 1 setup:
 * 1. Detect hardware capabilities
 * 2. Check and start Ollama if needed
 * 3. Pull embedding model if missing
 * 4. Write profile to ~/.brain-cache/profile.json
 *
 * All output goes to stderr — zero stdout output (per D-16).
 */
export async function runInit(): Promise<void> {
  // Step 1: Detect hardware capabilities
  process.stderr.write('brain-cache: detecting hardware capabilities...\n');
  const profile = await detectCapabilities();

  const vramDisplay = profile.vramGiB !== null ? `${profile.vramGiB} GiB` : 'N/A';
  process.stderr.write(
    `GPU: ${profile.gpuVendor} (${vramDisplay}) | Tier: ${profile.vramTier} | Model: ${profile.embeddingModel}\n`
  );

  // Step 2: Warn if CPU-only (per D-08)
  if (profile.vramTier === 'none') {
    process.stderr.write(
      'Warning: No GPU detected. Embeddings will run on CPU (slower). ' +
      'Consider using a machine with a GPU for faster indexing.\n'
    );
  }

  // Step 3: Check Ollama is installed (per D-05)
  const installed = await isOllamaInstalled();
  if (!installed) {
    process.stderr.write(
      'Error: Ollama is not installed.\n\n' +
      'Install Ollama:\n' +
      '  macOS: brew install ollama\n' +
      '  Linux: curl -fsSL https://ollama.com/install.sh | sh\n\n' +
      'Then run: brain-cache init\n'
    );
    throw new Error('Ollama is not installed. Install from https://ollama.com then retry brain-cache init.');
  }

  // Step 4: Check Ollama is running, auto-start if needed (per D-06, D-07)
  const running = await isOllamaRunning();
  if (!running) {
    process.stderr.write('Ollama is not running. Starting...\n');
    const started = await startOllama();
    if (!started) {
      process.stderr.write(
        "Error: Could not start Ollama. Run 'ollama serve' manually, then retry 'brain-cache init'.\n"
      );
      throw new Error("Could not start Ollama. Run 'ollama serve' manually, then retry 'brain-cache init'.");
    }
  }

  // Step 5: Get Ollama version and update profile
  const ollamaVersion = await getOllamaVersion();
  const profileWithVersion = { ...profile, ollamaVersion };

  // Step 6: Pull embedding model if missing
  await pullModelIfMissing(profileWithVersion.embeddingModel);

  // Step 7: Warm model into VRAM
  process.stderr.write(
    `brain-cache: warming model ${profileWithVersion.embeddingModel} into VRAM...\n`
  );
  const { embedBatchWithRetry } = await import('../services/embedder.js');
  await embedBatchWithRetry(profileWithVersion.embeddingModel, ['warmup']);
  process.stderr.write('brain-cache: model warm.\n');

  // Step 8: Write profile to disk
  await writeProfile(profileWithVersion);

  // Step 9: Print success summary
  process.stderr.write(
    'brain-cache initialized successfully.\n' +
    '  Profile: ~/.brain-cache/profile.json\n' +
    `  Embedding model: ${profileWithVersion.embeddingModel}\n` +
    `  VRAM tier: ${profileWithVersion.vramTier}\n`
  );

  // Step 11: Create or update .mcp.json with brain-cache MCP server entry (idempotent)
  const brainCacheMcpEntry = {
    command: 'node',
    args: ['node_modules/brain-cache/dist/mcp.js'],
  };
  const mcpJsonPath = '.mcp.json';

  if (existsSync(mcpJsonPath)) {
    const mcpContent = readFileSync(mcpJsonPath, 'utf-8');
    const parsed = JSON.parse(mcpContent) as { mcpServers?: Record<string, { command: string; args: string[] }> };
    const existing = parsed.mcpServers?.['brain-cache'];
    if (existing && JSON.stringify(existing) === JSON.stringify(brainCacheMcpEntry)) {
      process.stderr.write('brain-cache: .mcp.json already contains brain-cache MCP server, skipping.\n');
    } else {
      parsed.mcpServers = parsed.mcpServers ?? {};
      parsed.mcpServers['brain-cache'] = brainCacheMcpEntry;
      writeFileSync(mcpJsonPath, JSON.stringify(parsed, null, 2) + '\n');
      process.stderr.write('brain-cache: added brain-cache MCP server to .mcp.json.\n');
    }
  } else {
    const mcpConfig = { mcpServers: { 'brain-cache': brainCacheMcpEntry } };
    writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    process.stderr.write('brain-cache: created .mcp.json with brain-cache MCP server.\n');
  }

  // Step 10: Append brain-cache instructions to CLAUDE.md (idempotent)
  const claudeMdPath = 'CLAUDE.md';
  const { CLAUDE_MD_SECTION: brainCacheSection } = await import('../lib/claude-md-section.js');

  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, 'utf-8');
    if (content.includes('## Brain-Cache MCP Tools')) {
      process.stderr.write('brain-cache: CLAUDE.md already contains Brain-Cache MCP Tools section, skipping.\n');
    } else {
      appendFileSync(claudeMdPath, brainCacheSection);
      process.stderr.write('brain-cache: appended Brain-Cache MCP Tools section to CLAUDE.md.\n');
    }
  } else {
    writeFileSync(claudeMdPath, brainCacheSection.trimStart());
    process.stderr.write('brain-cache: created CLAUDE.md with Brain-Cache MCP Tools section.\n');
  }

  // Step 12: Install statusline.mjs to ~/.brain-cache/ (idempotent)
  const { STATUSLINE_SCRIPT_CONTENT } = await import('../lib/statusline-script.js');
  const statuslinePath = join(homedir(), '.brain-cache', 'statusline.mjs');

  if (existsSync(statuslinePath)) {
    const existingScript = readFileSync(statuslinePath, 'utf-8');
    if (existingScript === STATUSLINE_SCRIPT_CONTENT) {
      process.stderr.write('brain-cache: statusline.mjs already installed, skipping.\n');
    } else {
      process.stderr.write(
        'brain-cache: Warning: ~/.brain-cache/statusline.mjs already exists with custom content. Skipping to preserve user changes.\n'
      );
    }
  } else {
    writeFileSync(statuslinePath, STATUSLINE_SCRIPT_CONTENT, 'utf-8');
    chmodSync(statuslinePath, 0o755);
    process.stderr.write('brain-cache: installed statusline.mjs to ~/.brain-cache/statusline.mjs\n');
  }

  // Step 13: Add statusLine entry to ~/.claude/settings.json (idempotent, safe merge per STAT-06)
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  const statusLineEntry = {
    type: 'command' as const,
    command: `node "${join(homedir(), '.brain-cache', 'statusline.mjs')}"`,
  };

  try {
    if (existsSync(settingsPath)) {
      const rawSettings = readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(rawSettings) as Record<string, unknown>;
      if (parsed['statusLine']) {
        process.stderr.write(
          'brain-cache: Warning: ~/.claude/settings.json already has a statusLine entry. ' +
          'Skipping to preserve existing configuration.\n'
        );
      } else {
        parsed['statusLine'] = statusLineEntry;
        writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + '\n');
        process.stderr.write('brain-cache: added statusLine to ~/.claude/settings.json\n');
      }
    } else {
      mkdirSync(claudeDir, { recursive: true });
      const newSettings = { statusLine: statusLineEntry };
      writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2) + '\n');
      process.stderr.write('brain-cache: created ~/.claude/settings.json with statusLine entry.\n');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `brain-cache: Warning: Could not configure ~/.claude/settings.json: ${msg}. ` +
      'Status line will not appear in Claude Code until settings.json is configured manually.\n'
    );
  }
}
