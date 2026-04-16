import { useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  CircleAlert,
  Globe,
  Loader2,
  Plus,
  Power,
  X
} from 'lucide-react'
import type { CreateForwardInput, ForwardKind, ForwardRule } from '@shared/types'
import { useForwardsStore } from '../state/forwardsStore'

interface Props {
  sessionId: string
  onClose: () => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function describe(rule: ForwardRule): string {
  if (rule.kind === 'local') {
    return `${rule.bindHost}:${rule.bindPort} → ${rule.destHost}:${rule.destPort}`
  }
  if (rule.kind === 'remote') {
    return `(server) ${rule.bindHost}:${rule.bindPort} → ${rule.destHost}:${rule.destPort} (you)`
  }
  return `SOCKS5 on ${rule.bindHost}:${rule.bindPort}`
}

function StatusBadge({ rule }: { rule: ForwardRule }): JSX.Element {
  switch (rule.status) {
    case 'starting':
      return (
        <span className="inline-flex items-center gap-1 text-muted">
          <Loader2 size={11} className="animate-spin" /> starting
        </span>
      )
    case 'active':
      return (
        <span className="inline-flex items-center gap-1 text-green-500">
          <Power size={11} /> active
        </span>
      )
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-red-400" title={rule.error}>
          <CircleAlert size={11} /> error
        </span>
      )
    case 'stopped':
      return <span className="text-muted">stopped</span>
  }
}

const EMPTY_FORM = {
  kind: 'local' as ForwardKind,
  label: '',
  bindHost: '127.0.0.1',
  bindPort: '',
  destHost: '',
  destPort: ''
}

export function ForwardsDialog({ sessionId, onClose }: Props): JSX.Element {
  const allRules = useForwardsStore((s) => s.rules)
  const start = useForwardsStore((s) => s.start)
  const stop = useForwardsStore((s) => s.stop)

  const rules = useMemo(
    () =>
      Object.values(allRules)
        .filter((r) => r.sessionId === sessionId)
        .sort((a, b) => a.startedAt - b.startedAt),
    [allRules, sessionId]
  )

  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]): void {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const bindPort = Number(form.bindPort)
    if (!Number.isInteger(bindPort) || bindPort < 0 || bindPort > 65535) {
      setError('Bind port must be 0–65535 (0 = auto-assign)')
      return
    }
    if (form.kind !== 'dynamic') {
      if (!form.destHost.trim()) return setError('Destination host is required')
      const dp = Number(form.destPort)
      if (!Number.isInteger(dp) || dp < 1 || dp > 65535)
        return setError('Destination port must be 1–65535')
    }

    const input: CreateForwardInput = {
      sessionId,
      kind: form.kind,
      label: form.label.trim() || undefined,
      bindHost: form.bindHost.trim() || '127.0.0.1',
      bindPort,
      destHost: form.kind === 'dynamic' ? undefined : form.destHost.trim(),
      destPort: form.kind === 'dynamic' ? undefined : Number(form.destPort)
    }

    setSubmitting(true)
    try {
      await start(input)
      setForm({ ...EMPTY_FORM, kind: form.kind, bindHost: form.bindHost })
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[700px] max-w-[95vw] max-h-[90vh] rounded-lg bg-panel border border-border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <ArrowRightLeft size={14} className="text-accent" />
            Port forwards
          </h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {rules.length === 0 ? (
            <div className="p-4 text-xs text-muted">No forwards for this session yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 w-[68px]">Kind</th>
                  <th className="text-left px-3 py-2">Tunnel</th>
                  <th className="text-left px-3 py-2 w-[100px]">Status</th>
                  <th className="text-right px-3 py-2 w-[80px]">Conns</th>
                  <th className="text-right px-3 py-2 w-[110px]">In / Out</th>
                  <th className="w-[36px]"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-[rgb(var(--bg))]">
                    <td className="px-3 py-1.5 uppercase tracking-wide text-muted">
                      {r.kind === 'local' ? '-L' : r.kind === 'remote' ? '-R' : '-D'}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {r.label && <div className="text-accent">{r.label}</div>}
                      <div className="truncate">{describe(r)}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge rule={r} />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.connections}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted">
                      {formatBytes(r.bytesIn)} / {formatBytes(r.bytesOut)}
                    </td>
                    <td className="pr-2 text-right">
                      <button
                        className="btn-ghost"
                        title="Stop forward"
                        onClick={() => stop(r.id)}
                      >
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form
          onSubmit={onAdd}
          className="border-t border-border p-3 grid grid-cols-[80px_1fr_110px_1fr_110px_auto] gap-2 items-end text-xs"
        >
          <label className="flex flex-col gap-1 col-span-1">
            <span className="text-muted">Kind</span>
            <select
              className="input"
              value={form.kind}
              onChange={(e) => update('kind', e.target.value as ForwardKind)}
            >
              <option value="local">Local (-L)</option>
              <option value="remote">Remote (-R)</option>
              <option value="dynamic">Dynamic (-D)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted">Label (optional)</span>
            <input
              className="input"
              value={form.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder="e.g. DB tunnel"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted">Bind host</span>
            <input
              className="input font-mono"
              value={form.bindHost}
              onChange={(e) => update('bindHost', e.target.value)}
              placeholder="127.0.0.1"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted">Bind port</span>
              <input
                className="input font-mono"
                value={form.bindPort}
                onChange={(e) => update('bindPort', e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 5432"
              />
            </label>

            {form.kind !== 'dynamic' && (
              <label className="flex flex-col gap-1">
                <span className="text-muted">Dest host</span>
                <input
                  className="input font-mono"
                  value={form.destHost}
                  onChange={(e) => update('destHost', e.target.value)}
                  placeholder={form.kind === 'remote' ? '127.0.0.1' : 'db.internal'}
                />
              </label>
            )}
          </div>

          {form.kind !== 'dynamic' ? (
            <label className="flex flex-col gap-1">
              <span className="text-muted">Dest port</span>
              <input
                className="input font-mono"
                value={form.destPort}
                onChange={(e) => update('destPort', e.target.value)}
                inputMode="numeric"
                placeholder="5432"
              />
            </label>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-muted">&nbsp;</span>
              <span className="text-muted flex items-center gap-1 text-[11px]">
                <Globe size={11} /> SOCKS5 proxy
              </span>
            </div>
          )}

          <button type="submit" disabled={submitting} className="btn-primary h-[30px]">
            <Plus size={12} className="inline mr-1 -mt-0.5" />
            {submitting ? 'Adding…' : 'Add'}
          </button>

          {error && (
            <div className="col-span-6 rounded border border-red-700/50 bg-red-950/40 text-red-300 text-[11px] p-2">
              {error}
            </div>
          )}

          <div className="col-span-6 text-[11px] text-muted leading-relaxed">
            <b>Local (-L):</b> listen on <i>your</i> machine, forward to the target reachable
            from the server.{' '}
            <b>Remote (-R):</b> ask the server to listen, forward to the target reachable from
            you. For <i>Remote</i> the server's <code>GatewayPorts</code> controls whether
            external bind hosts are allowed.{' '}
            <b>Dynamic (-D):</b> local SOCKS5 proxy — point your browser/app at it and every
            connection is tunneled (CONNECT-only, IPv4/domain).
          </div>
        </form>
      </div>
    </div>
  )
}
