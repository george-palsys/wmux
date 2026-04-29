export interface PtyCreateOptions {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  workspaceId?: string;
  surfaceId?: string;
}

const LEGACY_DEFAULT_SHELL_VALUES = new Set(['powershell', 'cmd', 'gitbash', 'wsl']);

function isExecutableShellValue(shell: string | undefined): shell is string {
  if (!shell) return false;
  if (LEGACY_DEFAULT_SHELL_VALUES.has(shell)) return false;
  return shell.includes('\\') || shell.includes('/') || shell.toLowerCase().endsWith('.exe');
}

export function withDefaultShell<T extends PtyCreateOptions>(
  options: T,
  defaultShell: string | undefined,
): T & { shell?: string } {
  if (options.shell || !isExecutableShellValue(defaultShell)) return options;
  return { ...options, shell: defaultShell };
}
