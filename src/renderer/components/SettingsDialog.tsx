import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useEditorsStore } from '../state/editorsStore'

interface Props {
  onClose: () => void
}

const PRESETS: { label: string; value: string }[] = [
  { label: 'System default (no command)', value: '' },
  { label: 'VS Code', value: 'code {file}' },
  { label: 'VS Code (wait for close)', value: 'code --wait {file}' },
  { label: 'Notepad', value: 'notepad {file}' },
  { label: 'Notepad++ (default install)', value: '"C:\\Program Files\\Notepad++\\notepad++.exe" {file}' },
  { label: 'Sublime Text', value: '"C:\\Program Files\\Sublime Text\\sublime_text.exe" {file}' }
]

export function SettingsDialog({ onClose }: Props): JSX.Element {
  const editorCommand = useEditorsStore((s) => s.editorCommand)
  const setEditorCommand = useEditorsStore((s) => s.setEditorCommand)
  const [value, setValue] = useState(editorCommand)

  useEffect(() => {
    setValue(editorCommand)
  }, [editorCommand])

  function save(): void {
    setEditorCommand(value.trim())
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[520px] max-w-[92vw] rounded-lg bg-panel border border-border shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 text-sm space-y-3">
          <div>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">External editor command</span>
              <input
                className="input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="empty = system default (Windows Explorer will choose the app)"
                spellCheck={false}
              />
            </label>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Use <code className="bg-bg px-1 rounded">{'{file}'}</code> as the placeholder for
              the downloaded temp path. If you omit it, the path is appended as the last argument.
              Wrap paths with spaces in <code className="bg-bg px-1 rounded">"double quotes"</code>.
            </p>
          </div>

          <div>
            <span className="text-xs text-muted">Quick presets</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className="btn-secondary text-[11px]"
                  onClick={() => setValue(p.value)}
                  title={p.value || '(empty)'}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-muted border-t border-border pt-3">
            Edits work like this: click the <b>pencil</b> icon on a remote file → the file is
            downloaded to a temp folder, opened in your editor, and every save is auto-uploaded
            back. Click the <b>×</b> in the Active edits panel to stop watching.
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={save} className="btn-primary">
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
