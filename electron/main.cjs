const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const HID = require('node-hid');
const { Keyboard, findDevice } = require('./keyboard.cjs');
const remap = require('./remap.cjs');
const { MacroEngine } = require('./macro.cjs');

const kb = new Keyboard();
let win = null;
let tray = null;
let status = { present: false, connected: false, error: null };
let autoSync = true;
let lastVolume = -1;
let lastSync = 0;
let macro = null;

function send(ch, data) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, data);
}

// Tanı kaydı: ~/Library/Logs/KB923L Pro/main.log
function log(...a) {
  try {
    const dir = app.getPath('logs');
    require('fs').mkdirSync(dir, { recursive: true });
    require('fs').appendFileSync(path.join(dir, 'main.log'), new Date().toISOString() + ' ' + a.join(' ') + '\n');
  } catch {}
}

function setStatus(s) {
  const next = { ...status, ...s };
  if (JSON.stringify(next) !== JSON.stringify(status)) {
    log('durum', JSON.stringify(next));
    status = next;
    send('kb:status', status);
  }
}

function errText(e) {
  const m = String((e && e.message) || e);
  if (/not permitted|0xE00002E2/i.test(m)) return 'PERMISSION';
  return m;
}

// Klavye takılı mı? Bağlıysa aç.
async function applyRemap(pairs) {
  try {
    const n = await remap.apply(pairs);
    log('tuş atama uygulandı', n);
    return n;
  } catch (e) {
    log('tuş atama hatası', e.message);
    throw e;
  }
}

function poll() {
  const present = !!findDevice();
  // Klavye yeni takıldıysa (ya da uygulama yeni açıldıysa) Mac tarafı tuş atamalarını yeniden uygula.
  if (present && !status.present) {
    const pairs = remap.load(app);
    if (pairs.length) setTimeout(() => applyRemap(pairs).catch(() => {}), 800);
  }
  if (present && macro) macro.sync();
  if (!present) {
    if (kb.connected) kb.close();
    setStatus({ present: false, connected: false, error: null });
    return;
  }
  if (!kb.connected) {
    try {
      kb.open();
      setStatus({ present: true, connected: true, error: null });
      lastSync = 0;
    } catch (e) {
      if (status.error !== errText(e)) log('açma hatası', String(e && e.message));
      // Giriş İzleme izni yoksa macOS'un izin penceresini bir kez aç (uygulamayı listeye de ekler)
      if (errText(e) === 'PERMISSION' && macro && !poll.asked) {
        poll.asked = true;
        macro.cmd({ op: 'listen' });
      }
      setStatus({ present: true, connected: false, error: errText(e) });
    }
  } else {
    setStatus({ present: true, connected: true });
  }
}

function getVolume() {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', 'output volume of (get volume settings)'], { timeout: 2000 }, (err, out) => {
      const v = parseInt(String(out).trim(), 10);
      resolve(err || isNaN(v) ? 0 : Math.max(0, Math.min(100, v)));
    });
  });
}

// Ekrandaki saat ve ses çubuğu: ses değişince ya da 30 sn'de bir gönderilir.
async function syncScreen(force = false) {
  if (!kb.connected || (!autoSync && !force)) return;
  const volume = await getVolume();
  const now = Date.now();
  if (!force && volume === lastVolume && now - lastSync < 30000) return;
  try {
    await kb.writeSysParam({ volume, date: new Date() });
    lastVolume = volume;
    lastSync = now;
  } catch (e) {
    setStatus({ connected: false, error: errText(e) });
  }
}

function wrap(fn) {
  return async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      const err = errText(e);
      if (!kb.connected) setStatus({ connected: false, error: err });
      return { ok: false, error: err };
    }
  };
}

ipcMain.handle('kb:getStatus', () => status);
ipcMain.handle('kb:readLed', wrap(async () => [...(await kb.readLed())]));
ipcMain.handle('kb:writeLed', wrap((bytes) => kb.writeLed(Buffer.from(bytes))));
ipcMain.handle('kb:writeCustom', wrap((colors) => kb.writeCustomRgb(colors)));
ipcMain.handle('kb:getRemap', () => remap.load(app));
// arg: { pairs, binds } (binds: makro tetikleri [{src, macro}])
ipcMain.handle(
  'kb:applyRemap',
  wrap(async (arg) => {
    const pairs = Array.isArray(arg) ? arg : arg.pairs || [];
    remap.save(app, pairs);
    macro.setRemap(pairs);
    macro.setBinds(Array.isArray(arg) ? [] : arg.binds || []);
    return applyRemap(pairs);
  }),
);
ipcMain.handle('kb:getMacros', () => macro.macros);
ipcMain.handle('kb:setMacros', (_e, list) => (macro.setMacros(list), true));
ipcMain.handle('kb:macroState', () => macro.state());
ipcMain.handle('kb:macroRecord', (_e, on) => (macro.record(on), macro.state()));
ipcMain.handle('kb:macroPlay', (_e, id) => macro.play(id));
ipcMain.handle('kb:macroStop', () => macro.stop());
ipcMain.handle('kb:macroTrust', (_e, prompt) => macro.checkTrust(!!prompt));
ipcMain.handle('kb:openAccessibility', () =>
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'),
);
ipcMain.handle('kb:getLogin', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('kb:setLogin', (_e, v) => {
  app.setLoginItemSettings({ openAtLogin: !!v, openAsHidden: true });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('kb:factoryReset', wrap(() => kb.factoryReset()));
ipcMain.handle('kb:syncNow', wrap(() => syncScreen(true)));
ipcMain.handle('kb:setAutoSync', (_e, v) => {
  autoSync = !!v;
  return autoSync;
});
ipcMain.handle('kb:relaunch', () => {
  app.isQuitting = true;
  app.relaunch();
  app.exit(0);
});
ipcMain.handle('kb:openPrivacy', () =>
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'),
);

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    title: 'KB923L Pro',
    backgroundColor: '#141416',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    send('kb:status', status);
    // Geliştirme: KB_SHOT=dosya.png verilirse pencere görüntüsü kaydedilir (KB_TAB ile sekme seçilir).
    if (process.env.KB_SHOT) {
      setTimeout(async () => {
        if (process.env.KB_TAB) {
          await win.webContents.executeJavaScript(
            `[...document.querySelectorAll('.side button')].find(b=>b.textContent===${JSON.stringify(process.env.KB_TAB)})?.click()`,
          );
          await new Promise((r) => setTimeout(r, 800));
        }
        if (process.env.KB_JS) {
          await win.webContents.executeJavaScript(process.env.KB_JS);
          await new Promise((r) => setTimeout(r, 800));
        }
        const img = await win.webContents.capturePage();
        require('fs').writeFileSync(process.env.KB_SHOT, img.toPNG());
        app.isQuitting = true;
        app.quit();
      }, 3500);
    }
  });
  // Pencere kapanınca uygulama menü çubuğunda çalışmaya devam eder (saat senkronu için).
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('KB923L Pro');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Göster', click: () => (win.show(), win.focus()) },
      { label: 'Saati şimdi eşitle', click: () => syncScreen(true) },
      { type: 'separator' },
      { label: 'Çık', click: () => ((app.isQuitting = true), app.quit()) },
    ]),
  );
}

app.whenReady().then(() => {
  macro = new MacroEngine(app, log, send);
  macro.setRemap(remap.load(app));
  macro.checkTrust(false);
  createWindow();
  createTray();
  poll();
  setInterval(poll, 2000);
  setInterval(() => syncScreen(false), 2000);
  try {
    HID.devices();
  } catch {}
});

app.on('activate', () => win && (win.show(), win.focus()));
app.on('before-quit', () => {
  app.isQuitting = true;
  kb.close();
  if (macro) {
    macro.closeAll();
    if (macro.helper) macro.helper.kill();
  }
});
