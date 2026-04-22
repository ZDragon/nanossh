import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { encryptString } from './secrets'
import type {
  ConnectionConfig,
  ConnectionMeta,
  SaveConnectionInput,
  StoredAuth
} from '../../shared/types'

interface StoreShape {
  version: 1
  connections: ConnectionConfig[]
}

const EMPTY: StoreShape = { version: 1, connections: [] }

function storePath(): string {
  return join(app.getPath('userData'), 'connections.json')
}

let cache: StoreShape | null = null

async function load(): Promise<StoreShape> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as StoreShape
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.connections)) {
      cache = { ...EMPTY }
    } else {
      cache = parsed
    }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') {
      console.error('[connections] failed to read store, starting empty:', err)
    }
    cache = { ...EMPTY }
  }
  return cache
}

async function persist(): Promise<void> {
  if (!cache) return
  const p = storePath()
  const tmp = `${p}.tmp`
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8')
  await fs.rename(tmp, p)
}

function toMeta(c: ConnectionConfig): ConnectionMeta {
  return {
    id: c.id,
    label: c.label,
    host: c.host,
    port: c.port,
    username: c.username,
    authKind: c.auth.kind,
    keepaliveSec: c.keepaliveSec,
    proxyJump: c.proxyJump,
    allowLegacyAlgorithms: c.allowLegacyAlgorithms,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  }
}

function buildStoredAuth(input: SaveConnectionInput['auth'], previous?: StoredAuth): StoredAuth {
  switch (input.kind) {
    case 'password':
      return { kind: 'password', passwordCipher: encryptString(input.password) }
    case 'privateKey': {
      const base: StoredAuth = { kind: 'privateKey', keyPath: input.keyPath }
      if (input.passphrase && input.passphrase.length > 0) {
        base.passphraseCipher = encryptString(input.passphrase)
      }
      return base
    }
    case 'agent':
      return { kind: 'agent' }
    case 'keepExisting':
      if (!previous) {
        throw new Error('keepExisting auth requested but no previous auth present')
      }
      return previous
  }
}

export async function listConnections(): Promise<ConnectionMeta[]> {
  const s = await load()
  return [...s.connections]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(toMeta)
}

export async function getFullConnection(id: string): Promise<ConnectionConfig | null> {
  const s = await load()
  return s.connections.find((c) => c.id === id) ?? null
}

export async function saveConnection(input: SaveConnectionInput): Promise<ConnectionConfig> {
  const s = await load()
  const now = Date.now()

  if (input.id) {
    const idx = s.connections.findIndex((c) => c.id === input.id)
    if (idx === -1) throw new Error(`Connection ${input.id} not found`)
    const previous = s.connections[idx]
    const updated: ConnectionConfig = {
      ...previous,
      label: input.label,
      host: input.host,
      port: input.port,
      username: input.username,
      auth: buildStoredAuth(input.auth, previous.auth),
      keepaliveSec: input.keepaliveSec,
      proxyJump: input.proxyJump,
      allowLegacyAlgorithms: input.allowLegacyAlgorithms,
      updatedAt: now
    }
    s.connections[idx] = updated
    await persist()
    return updated
  }

  if (input.auth.kind === 'keepExisting') {
    throw new Error('Cannot create a new connection with keepExisting auth')
  }

  const created: ConnectionConfig = {
    id: randomUUID(),
    label: input.label,
    host: input.host,
    port: input.port,
    username: input.username,
    auth: buildStoredAuth(input.auth),
    keepaliveSec: input.keepaliveSec,
    proxyJump: input.proxyJump,
    allowLegacyAlgorithms: input.allowLegacyAlgorithms,
    createdAt: now,
    updatedAt: now
  }
  s.connections.push(created)
  await persist()
  return created
}

export async function removeConnection(id: string): Promise<void> {
  const s = await load()
  const before = s.connections.length
  s.connections = s.connections.filter((c) => c.id !== id)
  if (s.connections.length !== before) await persist()
}
