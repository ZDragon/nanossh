import { safeStorage } from 'electron'

/**
 * Thin wrapper around Electron's safeStorage, which uses Windows DPAPI
 * (user-scoped) on Windows. Returns base64 cipher strings so JSON storage
 * stays plain ASCII.
 */

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encryptString(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS-level encryption is not available. Refusing to store secrets in plaintext.'
    )
  }
  return safeStorage.encryptString(plaintext).toString('base64')
}

export function decryptString(cipherBase64: string): string {
  const buf = Buffer.from(cipherBase64, 'base64')
  return safeStorage.decryptString(buf)
}
