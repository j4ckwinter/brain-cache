import { readFile, writeFile, appendFile, chmod, mkdir, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const BRAIN_CACHE_HOOK_PREFIX = 'brain-cache:';

interface HookCommand {
  type: 'command';
  command: string;
}

interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}

function isBrainCacheHook(hook: HookCommand): boolean {
  return typeof hook.command === 'string' && hook.command.includes(BRAIN_CACHE_HOOK_PREFIX);
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
async function installMcpServer(packageRoot: string): Promise<void> {
  const brainCacheMcpEntry = {
    command: process.execPath,
    args: [join(packageRoot, 'dist', 'mcp.js')],
  };
  const mcpJsonPath = '.mcp.json';

  let mcpContent: string | null = null;
  try {
    mcpContent = await readFile(mcpJsonPath, 'utf-8');
  } catch {
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

}

async function installInstructions(): Promise<void> {
  const claudeMdPath = 'CLAUDE.md';
  const { CLAUDE_MD_SECTION: brainCacheSection } = await import('../lib/claude-md-section.js');

  let claudeMdContent: string | null = null;
  try {
    claudeMdContent = await readFile(claudeMdPath, 'utf-8');
  } catch {
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

}

async function installSkill(packageRoot: string): Promise<void> {
  const skillSource = join(packageRoot, '.claude', 'skills', 'brain-cache', 'SKILL.md');
  const skillTargetDir = join(process.cwd(), '.claude', 'skills', 'brain-cache');
  const skillTarget = join(skillTargetDir, 'SKILL.md');

  let skillTargetExists = false;
  try { await access(skillTarget); skillTargetExists = true; } catch {  }
  let skillSourceExists = false;
  try { await access(skillSource); skillSourceExists = true; } catch {  }

  if (skillTargetExists) {
    process.stderr.write('brain-cache: skill already installed at .claude/skills/brain-cache/SKILL.md, skipping.\n');
  } else if (!skillSourceExists) {
    process.stderr.write('brain-cache: Warning: skill source not found in package. Copy .claude/skills/brain-cache/ manually from the repo.\n');
  } else {
    await mkdir(skillTargetDir, { recursive: true });
    await copyFile(skillSource, skillTarget);
    process.stderr.write('brain-cache: installed skill to .claude/skills/brain-cache/SKILL.md\n');
  }

}

async function installStatusLineScript(): Promise<void> {
  const { STATUSLINE_SCRIPT_CONTENT } = await import('../lib/statusline-script.js');
  const statuslinePath = join(homedir(), '.brain-cache', 'statusline.mjs');

  let existingScript: string | null = null;
  try {
    existingScript = await readFile(statuslinePath, 'utf-8');
  } catch {
  }
  if (existingScript !== null) {
    if (existingScript === STATUSLINE_SCRIPT_CONTENT) {
      process.stderr.write('brain-cache: statusline.mjs already installed, skipping.\n');
    } else if (createHash('sha256').update(existingScript).digest('hex') ===
      '24536abf269b1c05f3c5d28415eaace01a6feb6a0719efede24fd2f754c2511c') {
      // Exact unmodified v3.6.2 script; preserve any user-customized version.
      await writeFile(statuslinePath, STATUSLINE_SCRIPT_CONTENT, 'utf-8');
      process.stderr.write('brain-cache: updated bundled statusline.mjs\n');
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

}

async function configureStatusLine(): Promise<void> {
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

}

async function configureHooks(): Promise<void> {
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  try {
    let rawSettingsForHooks: string | null = null;
    try {
      rawSettingsForHooks = await readFile(settingsPath, 'utf-8');
    } catch {
      }
    const rawSettings = rawSettingsForHooks ?? '{}';
    const parsed = JSON.parse(rawSettings) as Record<string, unknown>;
    const hooks = (parsed['hooks'] ?? {}) as Record<string, unknown>;
    const preToolUse: HookEntry[] = Array.isArray(hooks['PreToolUse'])
      ? (hooks['PreToolUse'] as HookEntry[])
      : [];

    const preserved = preToolUse.flatMap(entry => {
      if (!entry.hooks?.some(isBrainCacheHook)) return [entry];
      const userHooks = entry.hooks.filter(hook => !isBrainCacheHook(hook));
      return userHooks.length > 0 ? [{ ...entry, hooks: userHooks }] : [];
    });
    const currentBC = preToolUse.filter(entry => entry.hooks?.some(isBrainCacheHook));
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

export async function configureClaudeIntegration(packageRoot: string): Promise<void> {
  await installMcpServer(packageRoot);
  await installInstructions();
  await installSkill(packageRoot);
  await installStatusLineScript();
  await configureStatusLine();
  await configureHooks();
}
