import { afterEach, describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join, parse } from 'node:path';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { validateIndexPath } from '../../src/lib/pathValidator.js';

describe('validateIndexPath', () => {
  describe.runIf(process.platform !== 'win32')('rejects POSIX sensitive system directories', () => {
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

  });

  describe('rejects sensitive user directories', () => {
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

    it.runIf(process.platform === 'darwin')('still allows /var/folders (macOS exception)', () => {
      expect(() => validateIndexPath('/var/folders/xx/tmp')).not.toThrow();
    });

    it('filesystem root / error message contains "filesystem root"', () => {
      expect(() => validateIndexPath('/')).toThrow(/filesystem root/);
    });

    it('homedir error message contains "home directory root"', () => {
      expect(() => validateIndexPath(homedir())).toThrow(/home directory root/);
    });
  });

  describe.runIf(process.platform === 'win32')('handles Windows roots and system directories', () => {
    it('rejects the current drive root', () => {
      const driveRoot = parse(process.cwd()).root;
      expect(() => validateIndexPath(driveRoot)).toThrow('filesystem root');
    });

    it('rejects a UNC share root', () => {
      expect(() => validateIndexPath('\\\\server\\share\\')).toThrow('filesystem root');
    });

    it('rejects the Windows system directory', () => {
      expect(() => validateIndexPath(process.env.SystemRoot!)).toThrow('sensitive system directory');
    });

    it('rejects the home directory in a different letter case', () => {
      expect(() => validateIndexPath(homedir().toLowerCase())).toThrow('home directory root');
      expect(() => validateIndexPath(homedir().toUpperCase())).toThrow('home directory root');
    });

    it.each([
      ['\\\\?\\', `${process.env.SystemRoot}\\System32`],
      ['\\\\.\\', process.env.SystemRoot!],
      ['\\\\?\\', homedir()],
      ['\\\\?\\', join(homedir(), '.ssh')],
      ['//?/', process.env.SystemRoot!],
    ])('rejects namespace prefix %s on %s', (prefix, target) => {
      expect(() => validateIndexPath(prefix + target)).toThrow('namespace prefix');
    });

    it.each(['\\\\localhost\\C$\\Windows', '\\\\127.0.0.1\\c$', '\\\\server\\ADMIN$\\System32'])(
      'rejects administrative share %s',
      path => {
        expect(() => validateIndexPath(path)).toThrow('administrative share');
      },
    );

    it.each(['\\\\server\\projects\\app', '\\\\fileserver\\users$\\jdoe\\app', '\\\\wsl$\\Ubuntu\\home\\me\\app'])(
      'allows a project on the share %s',
      path => {
        expect(() => validateIndexPath(path)).not.toThrow();
      },
    );

    it.each([
      [homedir(), 'home directory root'],
      [process.env.SystemRoot!, 'sensitive system directory'],
    ])('rejects a junction that points at %s', (target, message) => {
      const dir = mkdtempSync(join(tmpdir(), 'junction-'));
      try {
        symlinkSync(target, join(dir, 'link'), 'junction');
        expect(() => validateIndexPath(join(dir, 'link'))).toThrow(message);
      } finally {
        rmSync(join(dir, 'link'), { force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe.runIf(process.platform === 'win32')('handles Windows aliases of protected directories', () => {
    it.each([
      [join(homedir(), '.SSH', 'keys'), 'sensitive system directory'],
      [join((process.env.ProgramData ?? 'C:\\ProgramData').toLowerCase(), 'app'), 'sensitive system directory'],
      ['C:\\Users\\All Users', 'sensitive system directory'],
    ])('rejects %s', (path, message) => {
      expect(() => validateIndexPath(path)).toThrow(message);
    });
  });

  describe.runIf(process.platform === 'linux')('handles homes under /var (ostree systems)', () => {
    const originalHome = process.env.HOME;
    afterEach(() => {
      process.env.HOME = originalHome;
    });

    it('allows projects in a home directory under /var/home', () => {
      process.env.HOME = '/var/home/dev';
      expect(() => validateIndexPath('/var/home/dev/projects/app')).not.toThrow();
    });

    it('still rejects protected folders and the home root under /var/home', () => {
      process.env.HOME = '/var/home/dev';
      expect(() => validateIndexPath('/var/home/dev/.ssh')).toThrow('sensitive system directory');
      expect(() => validateIndexPath('/var/home/dev')).toThrow('home directory root');
      expect(() => validateIndexPath('/var/log')).toThrow('sensitive system directory');
    });
  });

  describe.runIf(process.platform !== 'win32')('handles POSIX symlinks', () => {
    it('rejects a symlink that points at /etc', () => {
      const dir = mkdtempSync(join(tmpdir(), 'symlink-'));
      try {
        symlinkSync('/etc', join(dir, 'link'));
        expect(() => validateIndexPath(join(dir, 'link'))).toThrow('sensitive system directory');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('allows a project in the temp directory', () => {
      const dir = mkdtempSync(join(tmpdir(), 'project-'));
      try {
        expect(() => validateIndexPath(dir)).not.toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe.runIf(process.platform === 'darwin')('handles case-insensitive macOS paths', () => {
    it('rejects the home directory in a different letter case', () => {
      expect(() => validateIndexPath(homedir().toUpperCase())).toThrow('home directory root');
    });

    it('rejects a sensitive home directory in a different letter case', () => {
      expect(() => validateIndexPath(join(homedir(), '.SSH', 'keys'))).toThrow('sensitive system directory');
    });

    it.each(['/private/etc', '/private/etc/ssh', '/private/var', '/private/var/log'])(
      'rejects the canonical system path %s',
      path => {
        expect(() => validateIndexPath(path)).toThrow('sensitive system directory');
      },
    );

    it('allows a project in the canonical temp directory', () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'project-')));
      try {
        expect(dir.startsWith('/private/var/folders/')).toBe(true);
        expect(() => validateIndexPath(dir)).not.toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe.runIf(process.platform !== 'win32')('handles POSIX path traversal attacks', () => {
    it('rejects ../../etc/passwd after resolve (traversal attack)', () => {
      // Anchor so resolve() yields /etc/passwd regardless of process cwd
      expect(() => validateIndexPath('/tmp/foo/../../../etc/passwd')).toThrow('sensitive system directory');
    });

    it('rejects relative paths that resolve to /etc', () => {
      expect(() => validateIndexPath('/tmp/foo/../../../etc')).toThrow('sensitive system directory');
    });
  });
});
