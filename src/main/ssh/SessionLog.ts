import { app } from 'electron'
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs'
import { join } from 'node:path'

const LOG_DIR = () => join(app.getPath('temp'), 'ssh-client-logs')

/**
 * Append-only raw terminal log for a single SSH session.
 *
 * The full stream of bytes received from the server (including ANSI escapes
 * and control characters) is written to a file under the OS temp dir. The
 * file is created when the session opens and removed when it closes. Use
 * `readAll()` + optional ANSI stripping for export.
 */
export class SessionLog {
  readonly path: string
  private stream: WriteStream | null = null
  private bytes = 0

  constructor(sessionId: string) {
    this.path = join(LOG_DIR(), `${sessionId}.log`)
  }

  async open(): Promise<void> {
    await fs.mkdir(LOG_DIR(), { recursive: true })
    this.stream = createWriteStream(this.path, { flags: 'a' })
  }

  append(chunk: string): void {
    if (!this.stream || this.stream.destroyed) return
    try {
      this.stream.write(chunk)
      this.bytes += Buffer.byteLength(chunk, 'utf8')
    } catch {
      /* ignore write failure — log is best-effort */
    }
  }

  size(): number {
    return this.bytes
  }

  async readAll(): Promise<string> {
    // Flush pending writes before reading. We don't close the stream here —
    // the session may still be running. An empty write with a callback
    // guarantees that everything previously queued has reached the FS layer.
    if (this.stream && !this.stream.destroyed) {
      await new Promise<void>((resolve) => {
        this.stream!.write('', () => resolve())
      })
    }
    try {
      return await fs.readFile(this.path, 'utf8')
    } catch {
      return ''
    }
  }

  async close(): Promise<void> {
    const s = this.stream
    this.stream = null
    if (s) {
      await new Promise<void>((resolve) => s.end(resolve))
    }
    try {
      await fs.rm(this.path, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * Strip common ANSI escape sequences (CSI, OSC, single-char ESC-prefixed)
 * and the most obnoxious control chars so the result is readable as plain
 * text. Leaves \n, \t, \r alone.
 */
export function stripAnsi(input: string): string {
  return (
    input
      // CSI: ESC [ ... final-byte
      .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
      // OSC: ESC ] ... BEL or ESC \
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // SS2/SS3/single-char ESC sequences
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[@-Z\\-_]/g, '')
      // C0 control chars except \t \n \r
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  )
}
