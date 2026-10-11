// Electron main process. Serves ./renderer through a custom secure scheme (app://) so that
// ES modules, fetch() of lesson JSON, Web MIDI and microphone access all work like on a real https origin.
const { app, BrowserWindow, protocol, net, session, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const pendingVstRequests = new Map();
let vstProcess = null;
let vstReady = false;
let vstRequestCounter = 0;
let vstStartPromise = null;

function findVstHostExecutable() {
  // In an installed build the native process is shipped as an extra resource,
  // outside app.asar. In development, use the CMake build-tree locations.
  const devBase = path.join(__dirname, '..', 'native', 'vst-host', 'build');
  const candidates = process.platform === 'win32'
    ? [
        ...(app.isPackaged ? [path.join(process.resourcesPath, 'native', 'vst-host', 'PianoVstHost.exe')] : []),
        path.join(devBase, 'Release', 'PianoVstHost.exe'),
        path.join(devBase, 'Debug', 'PianoVstHost.exe'),
        path.join(devBase, 'PianoVstHost.exe'),
      ]
    : [path.join(devBase, 'PianoVstHost'), path.join(devBase, 'PianoVstHost.app', 'Contents', 'MacOS', 'PianoVstHost')];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function rejectVstPending(reason) {
  for (const item of pendingVstRequests.values()) { clearTimeout(item.timer); item.reject(new Error(reason)); }
  pendingVstRequests.clear();
}

function stopVstProcess() {
  const child = vstProcess;
  vstProcess = null; vstReady = false; vstStartPromise = null;
  rejectVstPending('میزبان VST3 متوقف شد.');
  if (child && !child.killed) { try { child.kill(); } catch {} }
}

function startVstProcess() {
  if (vstProcess && vstReady) return Promise.resolve({ ok: true, running: true });
  if (vstStartPromise) return vstStartPromise;
  const executable = findVstHostExecutable();
  if (!executable) return Promise.reject(new Error('فایل اجرایی میزبان VST3 پیدا نشد. ابتدا native/vst-host را با CMake و Visual Studio Build Tools بساز. راهنما: native/vst-host/README.md'));
  vstStartPromise = new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(executable, [], { cwd: path.dirname(executable), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    vstProcess = child;
    const finishError = (message) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(message)); } };
    const timer = setTimeout(() => finishError('میزبان VST3 در زمان مناسب آماده نشد.'), 15000);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.event === 'ready') {
        vstReady = true;
        if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: true, ...message }); }
      }
      if (message.requestId && pendingVstRequests.has(String(message.requestId))) {
        const item = pendingVstRequests.get(String(message.requestId));
        pendingVstRequests.delete(String(message.requestId)); clearTimeout(item.timer);
        if (message.event === 'error') item.reject(new Error(message.message || 'خطای میزبان VST3'));
        else item.resolve(message);
      }
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('vst-host:event', message);
    });
    child.stderr.on('data', (chunk) => {
      const message = String(chunk).trim();
      if (message) for (const win of BrowserWindow.getAllWindows()) win.webContents.send('vst-host:event', { event: 'log', message });
    });
    child.once('error', (error) => { finishError(`اجرای میزبان VST3 ناموفق بود: ${error.message}`); stopVstProcess(); });
    child.once('exit', (code) => {
      const wasReady = vstReady; vstProcess = null; vstReady = false; vstStartPromise = null;
      rejectVstPending(`میزبان VST3 بسته شد (کد ${code ?? 'نامشخص'}).`);
      if (!settled) finishError(`میزبان VST3 قبل از آماده‌شدن بسته شد (کد ${code ?? 'نامشخص'}).`);
      if (wasReady) for (const win of BrowserWindow.getAllWindows()) win.webContents.send('vst-host:event', { event: 'hostExit', code });
    });
  });
  return vstStartPromise;
}

async function sendVstCommand(payload) {
  await startVstProcess();
  if (!vstProcess || !vstReady) throw new Error('میزبان VST3 آماده نیست.');
  const requestId = String(++vstRequestCounter);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingVstRequests.delete(requestId); reject(new Error('پاسخی از میزبان VST3 دریافت نشد.')); }, 30000);
    pendingVstRequests.set(requestId, { resolve, reject, timer });
    try { vstProcess.stdin.write(`${JSON.stringify({ ...payload, requestId })}\n`); }
    catch (error) { clearTimeout(timer); pendingVstRequests.delete(requestId); reject(error); }
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f4f5f9',
    autoHideMenuBar: true,
    title: 'آموزش پیانو',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', // audio starts from a click anyway; this avoids edge cases
    },
  });
  win.loadURL('app://local/index.html');
  if (process.env.PIANO_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

ipcMain.handle('vst-host:start', async () => startVstProcess());
ipcMain.handle('vst-host:request', async (_event, payload) => {
  if (!payload || typeof payload.cmd !== 'string') throw new Error('درخواست نامعتبر است.');
  const allowed = new Set(['status', 'scan', 'load', 'unload', 'noteOn', 'noteOff', 'sustain', 'allNotesOff', 'volume']);
  if (!allowed.has(payload.cmd)) throw new Error('این فرمان اجازه داده نشده است.');
  return sendVstCommand(payload);
});
ipcMain.handle('vst-host:stop', async () => { stopVstProcess(); return { ok: true }; });

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const full = path.normalize(path.join(RENDERER_DIR, rel));
    if (!full.startsWith(RENDERER_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });

  // Phase 2/3 will need MIDI and microphone permissions; allow them for our own origin only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details?.requestingUrl || wc.getURL();
    const ours = origin.startsWith('app://local/');
    callback(ours && ['midi', 'midiSysex', 'media'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => {
    return String(origin).startsWith('app://local') && ['midi', 'midiSysex', 'media'].includes(permission);
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => stopVstProcess());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
