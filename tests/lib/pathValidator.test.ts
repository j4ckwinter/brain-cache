import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validateIndexPath } from '../../src/lib/pathValidator.js';

describe('validateIndexPath', () => {
  describe('rejects sensitive system directories', () => {
    it('rejects /etc', () => {
      expect(() => validateIndexPath('/etc')).toThrow('sensitive system directory');
    });

    it('rejects /etc/passwd (subdirectory of /etc)', () => {
      expect(() => validateIndexPath('/etc/passwd')).toThrow('sensitive system directory');
    });

    it('rejects /var', () => {
      expect(() => validateIndexPath('/var')).toThrow('sensitive system directory');
    });

    it('rejects /var/log (subdirectory of /var)', () => {
      expect(() => validateIndexPath('/var/log')).toThrow('sensitive system directory');
    });

    it('rejects ~/.ssh', () => {
      expect(() => validateIndexPath(join(homedir(), '.ssh'))).toThrow('sensitive system directory');
    });

    it('rejects ~/.ssh/id_rsa (subdirectory of ~/.ssh)', () => {
      expect(() => validateIndexPath(join(homedir(), '.ssh', 'id_rsa'))).toThrow('sensitive system directory');
    });

    it('rejects ~/.aws', () => {
      expect(() => validateIndexPath(join(homedir(), '.aws'))).toThrow('sensitive system directory');
    });

    it('rejects ~/.aws/credentials (subdirectory of ~/.aws)', () => {
      expect(() => validateIndexPath(join(homedir(), '.aws', 'credentials'))).toThrow('sensitive system directory');
    });

    it('rejects ~/.gnupg', () => {
      expect(() => validateIndexPath(join(homedir(), '.gnupg'))).toThrow('sensitive system directory');
    });

    it('rejects ~/.config', () => {
      expect(() => validateIndexPath(join(homedir(), '.config'))).toThrow('sensitive system directory');
    });

    it('rejects ~/.config/something (subdirectory of ~/.config)', () => {
      expect(() => validateIndexPath(join(homedir(), '.config', 'something'))).toThrow('sensitive system directory');
    });
  });

  describe('accepts normal project paths', () => {
    it('accepts "." (current directory)', () => {
      expect(() => validateIndexPath('.')).not.toThrow();
    });

    it('accepts /tmp/test', () => {
      expect(() => validateIndexPath('/tmp/test')).not.toThrow();
    });

    it('accepts a real user project path', () => {
      // Create a temp dir that resolves to a non-sensitive path
      const tmpDir = mkdtempSync(join(tmpdir(), 'test-project-'));
      expect(() => validateIndexPath(tmpDir)).not.toThrow();
    });

    it('accepts /home/user/projects/myapp (normal project path)', () => {
      // This may not exist but validation is based on path prefix, not existence
      expect(() => validateIndexPath('/home/user/projects/myapp')).not.toThrow();
    });
  });

  describe('rejects filesystem root and home directory root (SEC-02)', () => {
    it('rejects filesystem root /', () => {
      expect(() => validateIndexPath('/')).toThrow('filesystem root');
    });

    it('rejects home directory root', () => {
      expect(() => validateIndexPath(homedir())).toThrow('home directory root');
    });

    it('allows subdirectories of home', () => {
      expect(() => validateIndexPath(join(homedir(), 'projects', 'myapp'))).not.toThrow();
    });

    it('still allows /var/folders (macOS exception)', () => {
      expect(() => validateIndexPath('/var/folders/xx/tmp')).not.toThrow();
    });

    it('filesystem root / error message contains "filesystem root"', () => {
      expect(() => validateIndexPath('/')).toThrow(/filesystem root/);
    });

    it('homedir error message contains "home directory root"', () => {
      expect(() => validateIndexPath(homedir())).toThrow(/home directory root/);
    });
  });

  describe('handles path traversal attacks', () => {
    it('rejects ../../etc/passwd after resolve (traversal attack)', () => {
      // Anchor so resolve() yields /etc/passwd regardless of process cwd
      expect(() => validateIndexPath('/tmp/foo/../../../etc/passwd')).toThrow('sensitive system directory');
    });

    it('rejects relative paths that resolve to /etc', () => {
      expect(() => validateIndexPath('/tmp/foo/../../../etc')).toThrow('sensitive system directory');
    });
  });
});
