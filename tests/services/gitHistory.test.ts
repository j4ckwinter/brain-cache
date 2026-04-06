import { describe, expect, it } from 'vitest';
import {
  parseGitLog,
  buildCommitContent,
  isGitCommandError,
} from '../../src/services/gitHistory.js';

const RECORD_SEPARATOR = '\x1e';

describe('parseGitLog', () => {
  it('parses one commit per record with metadata and numstat', () => {
    const gitLog = [
      `${RECORD_SEPARATOR}COMMIT${RECORD_SEPARATOR}abc1234${RECORD_SEPARATOR}Jane Dev${RECORD_SEPARATOR}2026-04-06T10:11:12+00:00`,
      'feat(index): add history ingestion',
      '',
      'Includes parser and storage plumbing.',
      '12\t3\tsrc/workflows/index.ts',
      '2\t0\tsrc/services/gitHistory.ts',
      `${RECORD_SEPARATOR}COMMIT${RECORD_SEPARATOR}def5678${RECORD_SEPARATOR}Jack Winter${RECORD_SEPARATOR}2026-04-05T09:00:00+00:00`,
      'fix(retriever): include provenance labels',
      '3\t1\tsrc/services/retriever.ts',
      '',
    ].join('\n');

    const commits = parseGitLog(gitLog);
    expect(commits).toHaveLength(2);

    expect(commits[0].shortHash).toBe('abc1234');
    expect(commits[0].author).toBe('Jane Dev');
    expect(commits[0].date).toBe('2026-04-06T10:11:12.000Z');
    expect(commits[0].message).toContain('feat(index): add history ingestion');
    expect(commits[0].files).toEqual([
      { path: 'src/workflows/index.ts', insertions: 12, deletions: 3 },
      { path: 'src/services/gitHistory.ts', insertions: 2, deletions: 0 },
    ]);
  });

  it('handles binary or malformed numstat lines without throwing', () => {
    const gitLog = [
      `${RECORD_SEPARATOR}COMMIT${RECORD_SEPARATOR}abc1234${RECORD_SEPARATOR}Jane Dev${RECORD_SEPARATOR}not-a-date`,
      'chore: include binary image',
      '-\t-\tassets/logo.png',
      'malformed line',
      '',
    ].join('\n');

    const commits = parseGitLog(gitLog);
    expect(commits).toHaveLength(1);
    expect(commits[0].files).toEqual([
      { path: 'assets/logo.png', insertions: 0, deletions: 0 },
    ]);
    expect(commits[0].message).toBe('chore: include binary image');
  });
});

describe('buildCommitContent', () => {
  it('includes hash, author/date, message, touched paths and diff stats', () => {
    const content = buildCommitContent({
      shortHash: 'abc1234',
      author: 'Jane Dev',
      date: '2026-04-06T10:11:12.000Z',
      message: 'feat: add git history support\n\nMore details.',
      files: [
        { path: 'src/services/gitHistory.ts', insertions: 20, deletions: 1 },
        { path: 'src/workflows/index.ts', insertions: 12, deletions: 3 },
      ],
    });

    expect(content).toContain('Commit: abc1234');
    expect(content).toContain('Author: Jane Dev');
    expect(content).toContain('Date: 2026-04-06T10:11:12.000Z');
    expect(content).toContain('feat: add git history support');
    expect(content).toContain('- src/services/gitHistory.ts (+20/-1)');
    expect(content).toContain('- src/workflows/index.ts (+12/-3)');
  });

  it('does not truncate long commit message content', () => {
    const longMessage = `feat: ${'x'.repeat(12000)}`;
    const content = buildCommitContent({
      shortHash: 'abc1234',
      author: 'Jane Dev',
      date: '2026-04-06T10:11:12.000Z',
      message: longMessage,
      files: [],
    });

    expect(content).toContain(longMessage);
    expect(content.length).toBeGreaterThan(12000);
  });
});

describe('git command error shape', () => {
  it('supports inspectable git command failures for graceful skip handling', () => {
    const error = new Error('spawn git ENOENT') as Error & { command: string };
    error.command = 'git log --numstat';

    expect(isGitCommandError(error)).toBe(true);
  });
});
