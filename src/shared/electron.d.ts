import type { ElectronAPI } from '../preload/index';
import type { TokenEvent } from '../main/pty/TokenTracker';
import type {
  FirstRunCheckResult,
  RegisterMcpResult,
  SampleTaskStartPayload,
} from './firstRun';

declare global {
  interface Window {
    electronAPI: ElectronAPI & {
      onFileDrop: (callback: (paths: string[]) => void) => () => void;
      token?: {
        onUpdate: (callback: (ptyId: string, event: TokenEvent) => void) => () => void;
      };
      fs?: {
        readDir: (dirPath: string) => Promise<{ name: string; path: string; isDirectory: boolean; isSymlink: boolean }[]>;
        readFile: (filePath: string) => Promise<string | null>;
        writeFile: (filePath: string, content: string) => Promise<boolean>;
        watch: (dirPath: string) => Promise<boolean>;
        unwatch: (dirPath: string) => Promise<void>;
        onChanged: (callback: (dirPath: string) => void) => () => void;
      };
      mcp?: {
        check: () => Promise<{
          wmux: { registered: boolean; path: string | null };
          wmuxA2a: { registered: boolean; path: string | null };
          configPath: string;
          configExists: boolean;
          configModified: string | null;
        }>;
        reregister: () => Promise<{
          wmux: { registered: boolean; path: string | null };
          wmuxA2a: { registered: boolean; path: string | null };
          configPath: string;
          configExists: boolean;
          configModified: string | null;
        }>;
        unregister: () => Promise<{
          wmux: { registered: boolean; path: string | null };
          wmuxA2a: { registered: boolean; path: string | null };
          configPath: string;
          configExists: boolean;
          configModified: string | null;
        }>;
      };
      firstRun?: {
        check: () => Promise<FirstRunCheckResult>;
        complete: () => Promise<void>;
        dismiss: () => Promise<void>;
        reopen: () => Promise<FirstRunCheckResult>;
        registerMcp: () => Promise<RegisterMcpResult>;
        startSampleTask: (payload: SampleTaskStartPayload) => Promise<void>;
        onSampleTaskReady: (callback: () => void) => () => void;
        onSampleTaskTimeout: (callback: () => void) => () => void;
      };
    };
    clipboardAPI: {
      writeText: (text: string) => Promise<void>;
      readText: () => Promise<string>;
      readImage: () => Promise<string | null>;
      hasImage: () => Promise<boolean>;
    };
  }
}
