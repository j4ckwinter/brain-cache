import { readFile, writeFile, appendFile, chmod, mkdir, copyFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ─── PreToolUse hook constants (Step 14) ───────────────────────────────────

const BRAIN_CACHE_HOOK_PREFIX = 'brain-cache:';

interface HookCommand {
  type: 'command';
  command: string;
}

interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}

function isBrainCacheHookEntry(entry: HookEntry): boolean {
  return entry.hooks?.some(h =>
    typeof h.command === 'string' && h.command.includes(BRAIN_CACHE_HOOK_PREFIX)
  ) ?? false;
}

const makeHookCommand = (reminder: string): string =>
  `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"${reminder}"}}'`;

const BRAIN_CACHE_PRETOOLUSE_HOOKS: HookEntry[] = [
  {
    matcher: 'Grep',
    hooks: [{ type: 'command' as const, command: makeHookCommand('brain-cache: before using Grep, try mcp__brain-cache__search_codebase to find code by meaning instead of regex.') }],
  },
  {
    matcher: 'Glob',
    hooks: [{ type: 'command' as const, command: makeHookCommand('brain-cache: before using Glob, try mcp__brain-cache__search_codebase to locate files by meaning instead of pattern.') }],
  },
  {
    matcher: 'Read',
    hooks: [{ type: 'command' as const, command: makeHookCommand('brain-cache: before using Read, try mcp__brain-cache__build_context to get semantically relevant code instead of reading whole files.') }],
  },
  {
    matcher: 'Agent',
    hooks: [{ type: 'command' as const, command: makeHookCommand('brain-cache: before spawning an Agent, try mcp__brain-cache__build_context or mcp__brain-cache__search_codebase to answer the question directly.') }],
  },
];
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

  let mcpContent: string | null = null;
  try {
    mcpContent = await readFile(mcpJsonPath, 'utf-8');
  } catch {
    // file does not exist
  }
  if (mcpContent !== null) {
    const parsed = JSON.parse(mcpContent) as { mcpServers?: Record<string, { command: string; args: string[] }> };
    const existing = parsed.mcpServers?.['brain-cache'];
    if (existing && JSON.stringify(existing) === JSON.stringify(brainCacheMcpEntry)) {
      process.stderr.write('brain-cache: .mcp.json already contains brain-cache MCP server, skipping.\n');
    } else {
      parsed.mcpServers = parsed.mcpServers ?? {};
      parsed.mcpServers['brain-cache'] = brainCacheMcpEntry;
      await writeFile(mcpJsonPath, JSON.stringify(parsed, null, 2) + '\n');
      process.stderr.write('brain-cache: added brain-cache MCP server to .mcp.json.\n');
    }
  } else {
    const mcpConfig = { mcpServers: { 'brain-cache': brainCacheMcpEntry } };
    await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    process.stderr.write('brain-cache: created .mcp.json with brain-cache MCP server.\n');
  }

  // Step 10: Append brain-cache instructions to CLAUDE.md (idempotent)
  const claudeMdPath = 'CLAUDE.md';
  const { CLAUDE_MD_SECTION: brainCacheSection } = await import('../lib/claude-md-section.js');

  let claudeMdContent: string | null = null;
  try {
    claudeMdContent = await readFile(claudeMdPath, 'utf-8');
  } catch {
    // file does not exist
  }
  if (claudeMdContent !== null) {
    if (claudeMdContent.includes('## Brain-Cache MCP Tools')) {
      process.stderr.write('brain-cache: CLAUDE.md already contains Brain-Cache MCP Tools section, skipping.\n');
    } else {
      await appendFile(claudeMdPath, brainCacheSection);
      process.stderr.write('brain-cache: appended Brain-Cache MCP Tools section to CLAUDE.md.\n');
    }
  } else {
    await writeFile(claudeMdPath, brainCacheSection.trimStart());
    process.stderr.write('brain-cache: created CLAUDE.md with Brain-Cache MCP Tools section.\n');
  }

  // Step 11b: Install skill to user's project (idempotent)
  const currentFile = fileURLToPath(import.meta.url);
  // Walk up from current file to find package root (works regardless of tsup output structure)
  let packageRoot = dirname(currentFile);
  while (packageRoot !== dirname(packageRoot)) {
    let pkgExists = false;
    try { await access(join(packageRoot, 'package.json')); pkgExists = true; } catch { /* not found */ }
    if (pkgExists) break;
    packageRoot = dirname(packageRoot);
  }
  const skillSource = join(packageRoot, '.claude', 'skills', 'brain-cache', 'SKILL.md');
  const skillTargetDir = join(process.cwd(), '.claude', 'skills', 'brain-cache');
  const skillTarget = join(skillTargetDir, 'SKILL.md');

  let skillTargetExists = false;
  try { await access(skillTarget); skillTargetExists = true; } catch { /* not found */ }
  let skillSourceExists = false;
  try { await access(skillSource); skillSourceExists = true; } catch { /* not found */ }

  if (skillTargetExists) {
    process.stderr.write('brain-cache: skill already installed at .claude/skills/brain-cache/SKILL.md, skipping.\n');
  } else if (!skillSourceExists) {
    process.stderr.write('brain-cache: Warning: skill source not found in package. Copy .claude/skills/brain-cache/ manually from the repo.\n');
  } else {
    await mkdir(skillTargetDir, { recursive: true });
    await copyFile(skillSource, skillTarget);
    process.stderr.write('brain-cache: installed skill to .claude/skills/brain-cache/SKILL.md\n');
  }

  // Step 12: Install statusline.mjs to ~/.brain-cache/ (idempotent)
  const { STATUSLINE_SCRIPT_CONTENT } = await import('../lib/statusline-script.js');
  const statuslinePath = join(homedir(), '.brain-cache', 'statusline.mjs');

  let existingScript: string | null = null;
  try {
    existingScript = await readFile(statuslinePath, 'utf-8');
  } catch {
    // file does not exist
  }
  if (existingScript !== null) {
    if (existingScript === STATUSLINE_SCRIPT_CONTENT) {
      process.stderr.write('brain-cache: statusline.mjs already installed, skipping.\n');
    } else {
      process.stderr.write(
        'brain-cache: Warning: ~/.brain-cache/statusline.mjs already exists with custom content. Skipping to preserve user changes.\n'
      );
    }
  } else {
    await writeFile(statuslinePath, STATUSLINE_SCRIPT_CONTENT, 'utf-8');
    await chmod(statuslinePath, 0o755);
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
    let rawSettings: string | null = null;
    try {
      rawSettings = await readFile(settingsPath, 'utf-8');
    } catch {
      // file does not exist
    }
    if (rawSettings !== null) {
      const parsed = JSON.parse(rawSettings) as Record<string, unknown>;
      if (parsed['statusLine']) {
        process.stderr.write(
          'brain-cache: Warning: ~/.claude/settings.json already has a statusLine entry. ' +
          'Skipping to preserve existing configuration.\n'
        );
      } else {
        parsed['statusLine'] = statusLineEntry;
        await writeFile(settingsPath, JSON.stringify(parsed, null, 2) + '\n');
        process.stderr.write('brain-cache: added statusLine to ~/.claude/settings.json\n');
      }
    } else {
      await mkdir(claudeDir, { recursive: true });
      const newSettings = { statusLine: statusLineEntry };
      await writeFile(settingsPath, JSON.stringify(newSettings, null, 2) + '\n');
      process.stderr.write('brain-cache: created ~/.claude/settings.json with statusLine entry.\n');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `brain-cache: Warning: Could not configure ~/.claude/settings.json: ${msg}. ` +
      'Status line will not appear in Claude Code until settings.json is configured manually.\n'
    );
  }

  // Step 14: Add PreToolUse hooks to ~/.claude/settings.json (idempotent, safe merge per HOOK-01/02/03)
  try {
    let rawSettingsForHooks: string | null = null;
    try {
      rawSettingsForHooks = await readFile(settingsPath, 'utf-8');
    } catch {
      // file does not exist
    }
    const rawSettings = rawSettingsForHooks ?? '{}';
    const parsed = JSON.parse(rawSettings) as Record<string, unknown>;
    const hooks = (parsed['hooks'] ?? {}) as Record<string, unknown>;
    const preToolUse: HookEntry[] = Array.isArray(hooks['PreToolUse'])
      ? (hooks['PreToolUse'] as HookEntry[])
      : [];

    const preserved = preToolUse.filter(e => !isBrainCacheHookEntry(e));
    const currentBC = preToolUse.filter(e => isBrainCacheHookEntry(e));
    const noChange = JSON.stringify(currentBC) === JSON.stringify(BRAIN_CACHE_PRETOOLUSE_HOOKS);

    if (noChange && currentBC.length > 0) {
      process.stderr.write('brain-cache: PreToolUse hooks already installed, skipping.\n');
    } else {
      hooks['PreToolUse'] = [...preserved, ...BRAIN_CACHE_PRETOOLUSE_HOOKS];
      parsed['hooks'] = hooks;
      await mkdir(claudeDir, { recursive: true });
      await writeFile(settingsPath, JSON.stringify(parsed, null, 2) + '\n');
      if (currentBC.length > 0) {
        process.stderr.write('brain-cache: updated PreToolUse hooks in ~/.claude/settings.json\n');
      } else {
        process.stderr.write('brain-cache: installed PreToolUse hooks into ~/.claude/settings.json\n');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `brain-cache: Warning: Could not install PreToolUse hooks: ${msg}. ` +
      'Hooks will not fire until settings.json is configured manually.\n'
    );
  }
}
