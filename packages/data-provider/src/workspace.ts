import { z } from 'zod';

export const workspaceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ownerId: z.string().min(1).optional(),
  baseUrl: z.string().url().default('http://open-terminal:8000'),
  rootPath: z.string().startsWith('/').default('/home/user'),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  connectTimeoutMs: z.number().int().min(1000).max(60000).default(10000),
  reauthIntervalMs: z.number().int().min(10000).max(300000).default(60000),
  maxSessions: z.number().int().min(1).max(8).default(2),
  maxEntries: z.number().int().min(10).max(5000).default(500),
  maxPathLength: z.number().int().min(256).max(8192).default(4096),
  maxTextBytes: z.number().int().min(1024).max(1048576).default(262144),
  maxUploadBytes: z.number().int().min(1024).max(52428800).default(5242880),
  maxDownloadBytes: z.number().int().min(1024).max(52428800).default(10485760),
  maxResponseBytes: z.number().int().min(1024).max(10485760).default(2097152),
  maxFrameBytes: z.number().int().min(1024).max(65536).default(16384),
  maxBufferedBytes: z.number().int().min(65536).max(4194304).default(1048576),
  maxColumns: z.number().int().min(2).max(1000).default(500),
  maxRows: z.number().int().min(2).max(1000).default(300),
  scrollback: z.number().int().min(0).max(10000).default(1000),
});
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type WorkspaceEnabledConfig = { enabled: true } & Pick<
  WorkspaceConfig,
  | 'rootPath'
  | 'maxTextBytes'
  | 'maxUploadBytes'
  | 'maxFrameBytes'
  | 'maxBufferedBytes'
  | 'maxColumns'
  | 'maxRows'
  | 'scrollback'
>;
export type WorkspacePublicConfig = { enabled: false } | WorkspaceEnabledConfig;
export interface WorkspaceEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  writable: boolean;
}
export interface WorkspaceListing {
  directory: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
}
export interface WorkspaceFile {
  path: string;
  content: string;
  version: string;
}
export interface WorkspaceSession {
  id: string;
}
export interface WorkspaceWrite {
  path: string;
  content: string;
  version: string | null;
}
