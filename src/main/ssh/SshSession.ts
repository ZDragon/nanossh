import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { promises as fs } from 'node:fs'
import { basename, posix } from 'node:path'
import { decryptString } from '../storage/secrets'
import type {
  ConnectionConfig,
  SessionExitInfo,
  SftpEntry,
  TerminalSize
} from '../../shared/types'

function classify(attrs: {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}): SftpEntry['type'] {
  if (attrs.isDirectory()) return 'dir'
  if (attrs.isSymbolicLink()) return 'symlink'
  if (attrs.isFile()) return 'file'
  return 'other'
}

export interface SshSessionCallbacks {
  onData: (chunk: string) => void
  onExit: (info: SessionExitInfo) => void
}

export class SshSession {
  readonly id: string
  private readonly cbs: SshSessionCallbacks
  private client: Client | null = null
  private channel: ClientChannel | null = null
  private sftpClient: SFTPWrapper | null = null
  private closed = false

  constructor(id: string, cbs: SshSessionCallbacks) {
    this.id = id
    this.cbs = cbs
  }

  async connect(config: ConnectionConfig, size: TerminalSize): Promise<void> {
    const base: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      keepaliveInterval: (config.keepaliveSec ?? 30) * 1000,
      readyTimeout: 20_000
    }

    switch (config.auth.kind) {
      case 'password':
        base.password = decryptString(config.auth.passwordCipher)
        break
      case 'privateKey': {
        const key = await fs.readFile(config.auth.keyPath)
        base.privateKey = key
        if (config.auth.passphraseCipher) {
          base.passphrase = decryptString(config.auth.passphraseCipher)
        }
        break
      }
      case 'agent':
        base.agent = process.env.SSH_AUTH_SOCK || 'pageant'
        break
    }

    const client = new Client()
    this.client = client

    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        client.removeListener('error', onError)
        resolve()
      }
      const onError = (err: Error): void => {
        client.removeListener('ready', onReady)
        reject(err)
      }
      client.once('ready', onReady)
      client.once('error', onError)
      client.on('close', () => this.handleClose())
      client.connect(base)
    })

    await this.openShell(size)
  }

  private async openShell(size: TerminalSize): Promise<void> {
    if (!this.client) throw new Error('Client not connected')
    this.channel = await new Promise<ClientChannel>((resolve, reject) => {
      this.client!.shell(
        { term: 'xterm-256color', cols: size.cols, rows: size.rows },
        (err, ch) => (err ? reject(err) : resolve(ch))
      )
    })

    this.channel.on('data', (buf: Buffer) => {
      this.cbs.onData(buf.toString('utf8'))
    })
    this.channel.stderr.on('data', (buf: Buffer) => {
      this.cbs.onData(buf.toString('utf8'))
    })
    this.channel.on('close', () => this.handleClose())
    this.channel.on('exit', (code: number | null, signal: string | null) => {
      this.cbs.onExit({ code, signal })
    })
  }

  async sftp(): Promise<SFTPWrapper> {
    if (!this.client) throw new Error('Not connected')
    if (this.sftpClient) return this.sftpClient
    try {
      this.sftpClient = await new Promise<SFTPWrapper>((resolve, reject) => {
        this.client!.sftp((err, s) => (err ? reject(err) : resolve(s)))
      })
    } catch (e) {
      const err = e as Error & { reason?: number }
      // reason 2 = SSH_OPEN_ADMINISTRATIVELY_PROHIBITED — SFTP subsystem
      // is disabled on the server. Give the user an actionable message.
      if (err.reason === 2) {
        throw new Error(
          'SFTP subsystem is not available on the server (administratively prohibited). ' +
            "Ask the admin to enable it in /etc/ssh/sshd_config: 'Subsystem sftp /usr/lib/openssh/sftp-server' (or internal-sftp), then 'systemctl reload sshd'."
        )
      }
      throw e
    }
    return this.sftpClient
  }

  async sftpList(remotePath: string): Promise<SftpEntry[]> {
    const sftp = await this.sftp()
    const resolved = remotePath || '.'
    return new Promise<SftpEntry[]>((resolve, reject) => {
      sftp.readdir(resolved, (err, list) => {
        if (err) return reject(err)
        const entries = list.map<SftpEntry>((e) => ({
          name: e.filename,
          path: posix.join(resolved, e.filename),
          size: Number(e.attrs.size ?? 0),
          mtime: Number(e.attrs.mtime ?? 0) * 1000,
          type: classify(e.attrs),
          mode: e.attrs.mode ?? 0
        }))
        resolve(entries)
      })
    })
  }

  async sftpRealpath(remotePath: string): Promise<string> {
    const sftp = await this.sftp()
    return new Promise<string>((resolve, reject) => {
      sftp.realpath(remotePath, (err, p) => (err ? reject(err) : resolve(p)))
    })
  }

  async sftpMkdir(remotePath: string): Promise<void> {
    const sftp = await this.sftp()
    return new Promise<void>((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => (err ? reject(err) : resolve()))
    })
  }

  async sftpRename(oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.sftp()
    return new Promise<void>((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve()))
    })
  }

  async sftpRemove(remotePath: string, recursive: boolean): Promise<void> {
    const sftp = await this.sftp()
    const stat = await new Promise<{ isDirectory(): boolean }>((resolve, reject) => {
      sftp.lstat(remotePath, (err, s) => (err ? reject(err) : resolve(s)))
    })
    if (stat.isDirectory()) {
      if (!recursive) {
        return new Promise<void>((resolve, reject) =>
          sftp.rmdir(remotePath, (err) => (err ? reject(err) : resolve()))
        )
      }
      const entries = await this.sftpList(remotePath)
      for (const e of entries) {
        await this.sftpRemove(e.path, recursive)
      }
      return new Promise<void>((resolve, reject) =>
        sftp.rmdir(remotePath, (err) => (err ? reject(err) : resolve()))
      )
    }
    return new Promise<void>((resolve, reject) =>
      sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve()))
    )
  }

  async sftpUpload(
    localPath: string,
    remotePath: string,
    onProgress: (transferred: number, total: number) => void
  ): Promise<void> {
    const sftp = await this.sftp()
    const st = await fs.stat(localPath)
    const total = st.size
    const target = remotePath.endsWith('/') ? posix.join(remotePath, basename(localPath)) : remotePath
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(
        localPath,
        target,
        {
          step: (transferred: number) => onProgress(transferred, total)
        },
        (err) => (err ? reject(err) : resolve())
      )
    })
  }

  async sftpDownload(
    remotePath: string,
    localPath: string,
    onProgress: (transferred: number, total: number) => void
  ): Promise<void> {
    const sftp = await this.sftp()
    const st = await new Promise<{ size?: number }>((resolve, reject) => {
      sftp.stat(remotePath, (err, s) => (err ? reject(err) : resolve(s)))
    })
    const total = Number(st.size ?? 0)
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(
        remotePath,
        localPath,
        {
          step: (transferred: number) => onProgress(transferred, total)
        },
        (err) => (err ? reject(err) : resolve())
      )
    })
  }

  write(data: string): void {
    this.channel?.write(data)
  }

  resize(size: TerminalSize): void {
    // ssh2 signature: setWindow(rows, cols, height, width)
    this.channel?.setWindow(size.rows, size.cols, 0, 0)
  }

  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    this.cbs.onExit({ code: null, signal: null, reason: 'closed' })
    try {
      this.sftpClient?.end()
    } catch {
      /* ignore */
    }
    this.sftpClient = null
    try {
      this.channel?.end()
    } catch {
      /* ignore */
    }
    this.channel = null
    try {
      this.client?.end()
    } catch {
      /* ignore */
    }
    this.client = null
  }

  async close(): Promise<void> {
    this.handleClose()
  }

  // ────────────────────────────────────────────────────────────────
  // Port forwarding — thin wrappers so managers don't touch the raw Client.
  // ────────────────────────────────────────────────────────────────

  forwardOut(
    srcIp: string,
    srcPort: number,
    dstIp: string,
    dstPort: number
  ): Promise<ClientChannel> {
    if (!this.client) return Promise.reject(new Error('Not connected'))
    const client = this.client
    return new Promise<ClientChannel>((resolve, reject) => {
      client.forwardOut(srcIp, srcPort, dstIp, dstPort, (err, stream) =>
        err ? reject(err) : resolve(stream)
      )
    })
  }

  forwardIn(remoteBind: string, remotePort: number): Promise<number> {
    if (!this.client) return Promise.reject(new Error('Not connected'))
    const client = this.client
    return new Promise<number>((resolve, reject) => {
      client.forwardIn(remoteBind, remotePort, (err, actualPort) =>
        err ? reject(err) : resolve(actualPort)
      )
    })
  }

  unforwardIn(remoteBind: string, remotePort: number): Promise<void> {
    if (!this.client) return Promise.resolve()
    const client = this.client
    return new Promise<void>((resolve, reject) => {
      client.unforwardIn(remoteBind, remotePort, (err) => (err ? reject(err) : resolve()))
    })
  }

  /** Subscribe to server-initiated forwarded-tcpip connections (used for -R). */
  onTcpConnection(
    handler: (
      info: { srcIP: string; srcPort: number; destIP: string; destPort: number },
      accept: () => ClientChannel,
      reject: () => void
    ) => void
  ): () => void {
    if (!this.client) return () => undefined
    const client = this.client
    client.on('tcp connection', handler)
    return () => {
      try {
        client.removeListener('tcp connection', handler)
      } catch {
        /* ignore */
      }
    }
  }
}
