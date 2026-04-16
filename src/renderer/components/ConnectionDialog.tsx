import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { AuthInput, AuthKind, ConnectionMeta, SaveConnectionInput } from '@shared/types'

interface Props {
  initial?: ConnectionMeta
  onClose: () => void
  onSubmit: (cfg: SaveConnectionInput) => Promise<void>
}

type FormState = {
  label: string
  host: string
  port: string
  username: string
  authKind: AuthKind
  password: string
  keyPath: string
  passphrase: string
  keepaliveSec: string
  proxyJump: string
  keepExistingAuth: boolean
}

function emptyForm(initial?: ConnectionMeta): FormState {
  return {
    label: initial?.label ?? '',
    host: initial?.host ?? '',
    port: String(initial?.port ?? 22),
    username: initial?.username ?? '',
    authKind: initial?.authKind ?? 'password',
    password: '',
    keyPath: '',
    passphrase: '',
    keepaliveSec: '',
    proxyJump: '',
    keepExistingAuth: Boolean(initial)
  }
}

export function ConnectionDialog({ initial, onClose, onSubmit }: Props): JSX.Element {
  const [form, setForm] = useState<FormState>(() => emptyForm(initial))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setForm(emptyForm(initial))
  }, [initial])

  const isEdit = Boolean(initial)

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function buildAuth(): AuthInput {
    if (isEdit && form.keepExistingAuth) return { kind: 'keepExisting' }
    switch (form.authKind) {
      case 'password':
        return { kind: 'password', password: form.password }
      case 'privateKey':
        return {
          kind: 'privateKey',
          keyPath: form.keyPath,
          passphrase: form.passphrase || undefined
        }
      case 'agent':
        return { kind: 'agent' }
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    const port = Number(form.port)
    if (!form.label.trim()) return setError('Label is required')
    if (!form.host.trim()) return setError('Host is required')
    if (!Number.isInteger(port) || port < 1 || port > 65535) return setError('Port 1–65535')
    if (!form.username.trim()) return setError('Username is required')
    if (!isEdit || !form.keepExistingAuth) {
      if (form.authKind === 'password' && !form.password) return setError('Password is required')
      if (form.authKind === 'privateKey' && !form.keyPath.trim())
        return setError('Private key path is required')
    }

    const payload: SaveConnectionInput = {
      id: initial?.id,
      label: form.label.trim(),
      host: form.host.trim(),
      port,
      username: form.username.trim(),
      auth: buildAuth(),
      keepaliveSec: form.keepaliveSec ? Number(form.keepaliveSec) : undefined,
      proxyJump: form.proxyJump.trim() || undefined
    }

    setSubmitting(true)
    try {
      await onSubmit(payload)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="w-[520px] max-w-[92vw] rounded-lg bg-panel border border-border shadow-xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">
            {isEdit ? 'Edit connection' : 'New connection'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-fg"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
          <Field label="Label" full>
            <input
              className="input"
              value={form.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder="my-server"
              autoFocus
            />
          </Field>

          <Field label="Host">
            <input
              className="input"
              value={form.host}
              onChange={(e) => update('host', e.target.value)}
              placeholder="example.com or 10.0.0.5"
            />
          </Field>

          <Field label="Port">
            <input
              className="input"
              value={form.port}
              onChange={(e) => update('port', e.target.value)}
              inputMode="numeric"
            />
          </Field>

          <Field label="Username" full>
            <input
              className="input"
              value={form.username}
              onChange={(e) => update('username', e.target.value)}
              placeholder="root"
            />
          </Field>

          <Field label="Authentication" full>
            <div className="flex items-center gap-3">
              <select
                className="input"
                value={form.authKind}
                onChange={(e) => update('authKind', e.target.value as AuthKind)}
                disabled={isEdit && form.keepExistingAuth}
              >
                <option value="password">Password</option>
                <option value="privateKey">Private key</option>
                <option value="agent">SSH agent</option>
              </select>
              {isEdit && (
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={form.keepExistingAuth}
                    onChange={(e) => update('keepExistingAuth', e.target.checked)}
                  />
                  Keep existing
                </label>
              )}
            </div>
          </Field>

          {!form.keepExistingAuth && form.authKind === 'password' && (
            <Field label="Password" full>
              <input
                type="password"
                className="input"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          )}

          {!form.keepExistingAuth && form.authKind === 'privateKey' && (
            <>
              <Field label="Key path" full>
                <input
                  className="input"
                  value={form.keyPath}
                  onChange={(e) => update('keyPath', e.target.value)}
                  placeholder="C:\Users\me\.ssh\id_ed25519"
                />
              </Field>
              <Field label="Passphrase (optional)" full>
                <input
                  type="password"
                  className="input"
                  value={form.passphrase}
                  onChange={(e) => update('passphrase', e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </>
          )}

          <Field label="Keep-alive (sec)">
            <input
              className="input"
              value={form.keepaliveSec}
              onChange={(e) => update('keepaliveSec', e.target.value)}
              inputMode="numeric"
              placeholder="30"
            />
          </Field>

          <Field label="ProxyJump">
            <input
              className="input"
              value={form.proxyJump}
              onChange={(e) => update('proxyJump', e.target.value)}
              placeholder="user@jump:22"
            />
          </Field>
        </div>

        {error && (
          <div className="mx-4 mb-3 rounded border border-red-700/50 bg-red-950/40 text-red-300 text-xs p-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  full,
  children
}: {
  label: string
  full?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  )
}
