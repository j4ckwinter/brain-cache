import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GLOBAL_CONFIG_DIR } from '../lib/config.js';

const execFileAsync = promisify(execFile);
const RECORD_SEPARATOR = '\x1e';

export interface GitTouchedFile {
  path: string;
  insertions: number;
  deletions: number;
}

export interface GitCommit {
  shortHash: string;
  author: string;
  date: string;
  message: string;
  files: GitTouchedFile[];
}

export interface GitCommandError extends Error {
  code?: string | number;
  stdout?: string;
  stderr?: string;
  command: string;
}

export interface GitConfig {
  enabled?: boolean;
  maxCommits?: number;
}

export function isGitCommandError(error: unknown): error is GitCommandError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'command' in error &&
    typeof (error as { command?: unknown }).command === 'string'
  );
}

function normalizeDate(rawDate: string): string {
  const iso = new Date(rawDate);
  if (Number.isNaN(iso.getTime())) return rawDate;
  return iso.toISOString();
}

function parseNumstatLine(line: string): GitTouchedFile | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const [insRaw, delRaw, ...pathParts] = parts;
  const path = pathParts.join('\t').trim();
  if (!path) return null;
  return {
    path,
    insertions: Number.parseInt(insRaw, 10) || 0,
    deletions: Number.parseInt(delRaw, 10) || 0,
  };
}

export function parseGitLog(stdout: string): GitCommit[] {
  const records = stdout
    .split(`${RECORD_SEPARATOR}COMMIT${RECORD_SEPARATOR}`)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  return records.map((record) => {
    const firstNewline = record.indexOf('\n');
    const header = firstNewline === -1 ? record : record.slice(0, firstNewline);
    const bodyWithNumstat = firstNewline === -1 ? '' : record.slice(firstNewline + 1);
    const [shortHash = '', author = '', rawDate = ''] = header.split(RECORD_SEPARATOR);

    const lines = bodyWithNumstat.split('\n');
    const firstNumstatIndex = lines.findIndex((line) => line.includes('\t'));
    const messageLines = firstNumstatIndex >= 0 ? lines.slice(0, firstNumstatIndex) : lines;
    const numstatLines = firstNumstatIndex >= 0 ? lines.slice(firstNumstatIndex) : [];

    const files = numstatLines
      .map(parseNumstatLine)
      .filter((entry): entry is GitTouchedFile => entry !== null);

    return {
      shortHash: shortHash.trim(),
      author: author.trim(),
      date: normalizeDate(rawDate.trim()),
      message: messageLines.join('\n').trim(),
      files,
    };
  });
}

export async function fetchGitCommits(repoRoot: string, maxCommits: number): Promise<GitCommit[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        'log',
        `--format=${RECORD_SEPARATOR}COMMIT${RECORD_SEPARATOR}%h${RECORD_SEPARATOR}%an${RECORD_SEPARATOR}%aI%n%B`,
        '--numstat',
        '-n',
        String(maxCommits),
        '--',
      ],
      { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 },
    );
    return parseGitLog(stdout);
  } catch (error) {
    const typed = error as {
      message?: string;
      code?: string | number;
      stdout?: string;
      stderr?: string;
    };
    const wrapped = new Error(
      `Failed to read git history via git log: ${typed.message ?? 'unknown error'}`,
    ) as GitCommandError;
    wrapped.name = 'GitCommandError';
    wrapped.code = typed.code;
    wrapped.stdout = typed.stdout;
    wrapped.stderr = typed.stderr;
    wrapped.command = 'git log --numstat';
    throw wrapped;
  }
}

export function buildCommitContent(commit: GitCommit): string {
  const touchedPaths = commit.files
    .map((file) => `- ${file.path} (+${file.insertions}/-${file.deletions})`)
    .join('\n');

  return [
    `Commit: ${commit.shortHash}`,
    `Author: ${commit.author}`,
    `Date: ${commit.date}`,
    '',
    commit.message || '(no commit message)',
    '',
    'Touched files:',
    touchedPaths || '- (no touched files)',
  ].join('\n');
}

export async function readGitConfig(): Promise<GitConfig> {
  try {
    const raw = await readFile(join(GLOBAL_CONFIG_DIR, 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { git?: GitConfig };
    return parsed.git ?? {};
  } catch {
    return {};
  }
}
