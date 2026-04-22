/**
 * Shared types between main and renderer.
 * Kept framework-free so both processes can import safely.
 */

export type AuthKind = 'password' | 'privateKey' | 'agent'

/** Stored form — secrets already encrypted (base64). */
export type StoredAuth =
  | { kind: 'password'; passwordCipher: string }
  | { kind: 'privateKey'; keyPath: string; passphraseCipher?: string }
  | { kind: 'agent' }

/** Renderer -> main form when saving. Plaintext secrets; main encrypts. */
export type AuthInput =
  | { kind: 'password'; password: string }
  | { kind: 'privateKey'; keyPath: string; passphrase?: string }
  | { kind: 'agent' }
  | { kind: 'keepExisting' }

export interface ConnectionConfig {
  id: string
  label: string
  host: string
  port: number
  username: string
  auth: StoredAuth
  keepaliveSec?: number
  proxyJump?: string
  /**
   * When true, append a set of deprecated algorithms to the ssh2 defaults so
   * we can talk to ancient OpenSSH servers that only offer e.g.
   * `ssh-rsa` / `ssh-dss` host keys, `diffie-hellman-group1-sha1` KEX,
   * `3des-cbc` ciphers, or `hmac-sha1`/`hmac-md5` MACs. Opt-in because
   * these algorithms are weak and disabled by default for a reason.
   */
  allowLegacyAlgorithms?: boolean
  createdAt: number
  updatedAt: number
}

/** Safe view — never contains secrets. */
export interface ConnectionMeta {
  id: string
  label: string
  host: string
  port: number
  username: string
  authKind: AuthKind
  keepaliveSec?: number
  proxyJump?: string
  allowLegacyAlgorithms?: boolean
  createdAt: number
  updatedAt: number
}

export interface SaveConnectionInput {
  id?: string
  label: string
  host: string
  port: number
  username: string
  auth: AuthInput
  keepaliveSec?: number
  proxyJump?: string
  allowLegacyAlgorithms?: boolean
}

export interface SftpEntry {
  name: string
  path: string
  size: number
  mtime: number
  type: 'file' | 'dir' | 'symlink' | 'other'
  mode: number
}

export type TransferDirection = 'upload' | 'download'

export interface TransferTask {
  id: string
  sessionId: string
  direction: TransferDirection
  localPath: string
  remotePath: string
  total: number
  transferred: number
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled'
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface SessionExitInfo {
  code: number | null
  signal: string | null
  reason?: string
}

export interface TerminalSize {
  cols: number
  rows: number
}

/** Result of connections:save */
export interface SaveConnectionResult {
  id: string
}

export type EditSessionStatus =
  | 'downloading'
  | 'open'
  | 'uploading'
  | 'error'
  | 'closed'

export interface EditSession {
  id: string
  sessionId: string
  remotePath: string
  localPath: string
  status: EditSessionStatus
  error?: string
  uploads: number
  lastSavedAt?: number
  startedAt: number
}

export interface OpenEditorInput {
  sessionId: string
  remotePath: string
  /** Optional command. Use `{file}` token or omit to append path. Empty → system default. */
  editorCommand?: string
}

export type ForwardKind = 'local' | 'remote' | 'dynamic'
export type ForwardStatus = 'starting' | 'active' | 'error' | 'stopped'

export interface ForwardRule {
  id: string
  sessionId: string
  kind: ForwardKind
  label?: string

  /** Host the listener binds to locally (for local/dynamic) or remotely (for remote). */
  bindHost: string
  /** Port the listener binds to. */
  bindPort: number

  /** Destination host (only for local/remote; unused for dynamic SOCKS). */
  destHost?: string
  /** Destination port (only for local/remote; unused for dynamic SOCKS). */
  destPort?: number

  status: ForwardStatus
  error?: string
  connections: number
  bytesIn: number
  bytesOut: number
  startedAt: number
}

export interface CreateForwardInput {
  sessionId: string
  kind: ForwardKind
  label?: string
  bindHost: string
  bindPort: number
  destHost?: string
  destPort?: number
}

/** Channel name helpers so main and renderer agree. */
export const IpcChannels = {
  sessionData: (id: string) => `session:${id}:data`,
  sessionExit: (id: string) => `session:${id}:exit`,
  transferUpdate: 'sftp:transfer',

  connectionsList: 'connections:list',
  connectionsSave: 'connections:save',
  connectionsRemove: 'connections:remove',

  sessionOpen: 'session:open',
  sessionClose: 'session:close',
  sessionResize: 'session:resize',
  sessionWrite: 'session:write',

  sftpList: 'sftp:list',
  sftpMkdir: 'sftp:mkdir',
  sftpRm: 'sftp:rm',
  sftpRename: 'sftp:rename',
  sftpUpload: 'sftp:upload',
  sftpDownload: 'sftp:download',
  sftpCancel: 'sftp:cancel',

  localList: 'local:list',
  localHome: 'local:home',
  localShow: 'local:show',

  editorOpen: 'editor:open',
  editorClose: 'editor:close',
  editorList: 'editor:list',
  editorUpdate: 'editor:update',

  forwardStart: 'forward:start',
  forwardStop: 'forward:stop',
  forwardList: 'forward:list',
  forwardUpdate: 'forward:update',

  sessionExportLog: 'session:exportLog'
} as const

export interface ExportLogOptions {
  /** Remove ANSI escapes and most control chars. Default: false (raw). */
  stripAnsi?: boolean
  /** Suggested file name shown in the save dialog. */
  defaultFileName?: string
}

export interface ExportLogResult {
  /** Absolute path of the written file, or null if the user cancelled. */
  savedTo: string | null
  bytes: number
}
