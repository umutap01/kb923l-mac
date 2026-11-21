// Acil durum: klavyeyi fabrika ayarlarına döndürür (komut 0x11).
const { Keyboard } = require('../electron/keyboard.cjs');
const kb = new Keyboard();
kb.factoryReset().then(() => { console.log('fabrika ayarı komutu gönderildi'); kb.close(); }, (e) => { console.log('HATA', e.message); kb.close(); });
