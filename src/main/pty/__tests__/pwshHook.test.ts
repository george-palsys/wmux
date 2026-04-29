import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('PowerShell terminal hook', () => {
  it('does not write OSC sequences out-of-band while rendering prompt', () => {
    const hookPath = path.resolve(process.cwd(), 'src/main/pty/shell-hooks/pwsh.ps1');
    const hook = fs.readFileSync(hookPath, 'utf8');

    expect(hook).not.toMatch(/^\s*\[Console\]::Write\(/m);
    expect(hook).toContain('return $oscPrefix + [string]$body');
  });
});
