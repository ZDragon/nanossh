import { app, BrowserWindow, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { getSessionManager } from './ssh/SessionManager'
import { getEditorManager } from './editor'
import { getPortForwardManager } from './ssh/PortForwardManager'

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    title: 'SSH Client',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

async function purgeOrphanLogs(): Promise<void> {
  // Best-effort cleanup of session logs left over from a previous crash.
  // Runs only on startup, before any session opens, so it cannot race live
  // writers.
  const dir = join(app.getPath('temp'), 'ssh-client-logs')
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

app.whenReady().then(async () => {
  await purgeOrphanLogs()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (e) => {
  e.preventDefault()
  await getPortForwardManager().stopAll()
  await getEditorManager().closeAll()
  await getSessionManager().closeAll()
  app.exit(0)
})
