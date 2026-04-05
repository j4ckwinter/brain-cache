import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import the pure functions from the .mjs script.
// The script is standalone ESM and has no project imports.
import {
  formatTokenCount,
  readStats,
  renderOutput,
  IDLE_OUTPUT,
  _readStatsFromPath,
} from '../../src/scripts/statusline.mjs';

let tempDir: string;

describe('statusline', () => {
  // ── formatTokenCount ───────────────────────────────────────────────────────

  describe('formatTokenCount', () => {
    it('returns plain number string below 1000', () => {
      expect(formatTokenCount(500)).toBe('500');
    });

    it('returns plain number string at 999', () => {
      expect(formatTokenCount(999)).toBe('999');
    });

    it('returns k suffix at exactly 1000', () => {
      expect(formatTokenCount(1000)).toBe('1k');
    });

    it('rounds to nearest k for 2356', () => {
      expect(formatTokenCount(2356)).toBe('2k');
    });

    it('returns M suffix with one decimal for 1500000', () => {
      expect(formatTokenCount(1500000)).toBe('1.5M');
    });

    it('returns M suffix with one decimal for exactly 2000000', () => {
      expect(formatTokenCount(2000000)).toBe('2.0M');
    });
  });

  // ── _readStatsFromPath ─────────────────────────────────────────────────────

  describe('_readStatsFromPath', () => {
    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'statusline-test-'));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('returns null when stats file does not exist', () => {
      const result = _readStatsFromPath(join(tempDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('returns null when stats file contains malformed JSON', async () => {
      const filePath = join(tempDir, 'session-stats.json');
      await writeFile(filePath, '{bad', 'utf-8');
      const result = _readStatsFromPath(filePath);
      expect(result).toBeNull();
    });

    it('returns null when lastUpdatedAt is older than 2 hours', async () => {
      const filePath = join(tempDir, 'session-stats.json');
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const stats = {
        tokensSent: 100,
        estimatedWithoutBraincache: 400,
        callCount: 1,
        lastUpdatedAt: threeHoursAgo,
      };
      await writeFile(filePath, JSON.stringify(stats), 'utf-8');
      const result = _readStatsFromPath(filePath);
      expect(result).toBeNull();
    });

    it('returns stats when file is valid and lastUpdatedAt is 30 minutes old', async () => {
      const filePath = join(tempDir, 'session-stats.json');
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const stats = {
        tokensSent: 100,
        estimatedWithoutBraincache: 400,
        callCount: 1,
        lastUpdatedAt: thirtyMinutesAgo,
      };
      await writeFile(filePath, JSON.stringify(stats), 'utf-8');
      const result = _readStatsFromPath(filePath);
      expect(result).not.toBeNull();
      expect(result?.tokensSent).toBe(100);
      expect(result?.estimatedWithoutBraincache).toBe(400);
    });

    it('returns null when estimatedWithoutBraincache is 0', async () => {
      const filePath = join(tempDir, 'session-stats.json');
      const now = new Date().toISOString();
      const stats = {
        tokensSent: 0,
        estimatedWithoutBraincache: 0,
        callCount: 0,
        lastUpdatedAt: now,
      };
      await writeFile(filePath, JSON.stringify(stats), 'utf-8');
      const result = _readStatsFromPath(filePath);
      expect(result).toBeNull();
    });

    it('returns null when estimatedWithoutBraincache is negative', async () => {
      const filePath = join(tempDir, 'session-stats.json');
      const now = new Date().toISOString();
      const stats = {
        tokensSent: 100,
        estimatedWithoutBraincache: -50,
        callCount: 1,
        lastUpdatedAt: now,
      };
      await writeFile(filePath, JSON.stringify(stats), 'utf-8');
      const result = _readStatsFromPath(filePath);
      expect(result).toBeNull();
    });

    it('returns null when lastUpdatedAt is missing from JSON', async () => {
      const filePath = join(tempDir, 'session-stats.json');
      const stats = {
        tokensSent: 100,
        estimatedWithoutBraincache: 400,
        callCount: 1,
      };
      await writeFile(filePath, JSON.stringify(stats), 'utf-8');
      const result = _readStatsFromPath(filePath);
      expect(result).toBeNull();
    });
  });

  // ── renderOutput ──────────────────────────────────────────────────────────

  describe('renderOutput', () => {
    it('returns idle string when stats is null', () => {
      expect(renderOutput(null)).toBe(IDLE_OUTPUT);
    });

    it('returns idle string when tokensSent equals estimatedWithoutBraincache (pct=0, saved=0)', () => {
      const stats = {
        tokensSent: 1000,
        estimatedWithoutBraincache: 1000,
        callCount: 1,
        lastUpdatedAt: new Date().toISOString(),
      };
      expect(renderOutput(stats)).toBe(IDLE_OUTPUT);
    });

    it('returns idle string when tokensSent > estimatedWithoutBraincache (negative savings)', () => {
      const stats = {
        tokensSent: 1500,
        estimatedWithoutBraincache: 1000,
        callCount: 1,
        lastUpdatedAt: new Date().toISOString(),
      };
      expect(renderOutput(stats)).toBe(IDLE_OUTPUT);
    });

    it('returns formatted savings string for tokensSent=371, estimatedWithoutBraincache=2727 (86%)', () => {
      const stats = {
        tokensSent: 371,
        estimatedWithoutBraincache: 2727,
        callCount: 1,
        lastUpdatedAt: new Date().toISOString(),
      };
      expect(renderOutput(stats)).toBe('\ud83e\udde0 brain-cache \u2192 saved 2k tokens (86% less)\n');
    });

    it('returns formatted savings string for tokensSent=500, estimatedWithoutBraincache=1000 (50%)', () => {
      const stats = {
        tokensSent: 500,
        estimatedWithoutBraincache: 1000,
        callCount: 1,
        lastUpdatedAt: new Date().toISOString(),
      };
      expect(renderOutput(stats)).toBe('\ud83e\udde0 brain-cache \u2192 saved 500 tokens (50% less)\n');
    });

    it('returns formatted savings string for tokensSent=200000, estimatedWithoutBraincache=2000000 (90%)', () => {
      const stats = {
        tokensSent: 200000,
        estimatedWithoutBraincache: 2000000,
        callCount: 1,
        lastUpdatedAt: new Date().toISOString(),
      };
      expect(renderOutput(stats)).toBe('\ud83e\udde0 brain-cache \u2192 saved 1.8M tokens (90% less)\n');
    });
  });
});
