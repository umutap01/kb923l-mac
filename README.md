# KB923L Pro — Mac yapılandırıcı

Havit KB923L Pro klavyenin (USB VID 0x258A / PID 0x0217, Sinowealth) Windows yazılımının
(`KB923L Pro Keyboard Setup V1.0 20250801.exe`) macOS karşılığı. Electron + React + node-hid.

## Çalıştırma

    npm install
    npm start          # derle + aç
    npm run dist       # release/mac-arm64/KB923L Pro.app

macOS ilk açılışta **Giriş İzleme** izni ister (Sistem Ayarları → Gizlilik ve Güvenlik → Giriş İzleme).
Terminalden `electron` çalıştırırken `ELECTRON_RUN_AS_NODE` tanımlıysa kaldırın (`env -u ELECTRON_RUN_AS_NODE`).

## Özellikler

- Aydınlatma: 19 efekt, parlaklık (0–5), hız (0–5), 7 renk + renkli
- Özel renkler: tuş başına RGB (Kendi Tanımlama modu)
- Ekran: Mac saati ve ses seviyesi klavye ekranına (menü çubuğunda arka planda)
- Tuş atama: macOS `hidutil` UserKeyMapping ile yalnız bu klavyeye (VID/PID); tek tuş, değiştirici, medya/uygulama
  tuşları, devre dışı (F24'e eşlenir), Alt ↔ Win değişimi. Kısayol (⌘+C gibi) yok — hidutil yalnız tuştan tuşa eşler.
  Atamalar `~/Library/Application Support/KB923L Pro/remap.json`'da; uygulama klavye takılınca ve açılışta yeniden uygular
  (isteğe bağlı oturum açılışında başlatma).
- Uyku süresi, fabrika ayarlarına dönüş

Henüz yok: firmware'e tuş atama, Fn katmanı, makro, fare tuşları, ekrana GIF yükleme.

Kurtarma: `hidutil property --matching '{"VendorID":9610,"ProductID":535}' --set '{"UserKeyMapping":[]}'`
(Mac tarafı atamaları kaldırır); `node tools/factory-reset.cjs` (klavye fabrika ayarı).

## Firmware'e tuş atama denemesi (21 Kas 2026, ölçüldü — çalışmadı)

Komut 0x03 ile katman 0'a 504 baytlık matris yazıldı (sürücüdeki FillMatrix/SetMatrix ile birebir). Klavye yazmayı kabul
ediyor (giriş raporu `09 0A 06 00 02`), ama CapsLock→Esc ve Num*→X atamaları uygulanmadı: ne iki bayt düzeninde, ne
LED profili yeniden yazılınca, ne de çıkar-tak sonrasında (giriş raporları `tools/listen.cjs` ile izlendi). Matris geri
okunamıyor (0x83 desteklenmiyor). Sonraki adım: Windows'ta resmî uygulama tuş atarken USBPcap ile trafiği yakalamak.

## Protokol (DeviceDriver.exe → CDevG5KB, statik analizle)

Feature rapor 9, 520 bayt: `[09, komut, alt, 00, toplamPaket, paketNo, boyLo, boyHi, veri×512]`.
Yazma = SetFeature. Okuma = SetFeature(komut) + GetFeature; yanıtın [1] baytı komutla aynı olmalı.

| Komut | Yön | Veri |
|---|---|---|
| 0x82 | oku | 6 bayt kimlik (alt=1); ekran aygıtı PID 0x01B4 ile eşleşir |
| 0x84 / 0x04 | oku / yaz | 128 bayt LED+ayar profili, sonu `5A A5` |
| 0x03 | yaz | tuş matrisi 126×4 bayt (alt = katman, 0 = varsayılan); okunamaz (0x83 → `0A 06`) |
| 0x05 | yaz | makro tamponu |
| 0x06 | yaz | özel renkler R[126] G[126] B[126], alt = grup |
| 0x0B | yaz | 14 bayt: ses, CPU, bellek, yıl(LE), ay, gün, saat, dk, sn, haftanın günü |
| 0x11 | yaz | fabrika ayarı, 1 bayt `00` |

LED profili (Fw=1): `[3]` debounce, `[9]` özel mod bayrağı, `[10]` efekt (1..18, 0=kapalı),
`[0x18]` uyku dk, `[0x3A+2i]` parlaklık (0,4,…,20), `[0x3B+2i]` (hız<<4)|renk (7=renkli), `[0x5E]` özel mod parlaklığı.

Ölçüm (21 Kas 2026): profil oku→aynen yaz→oku birebir aynı; özel moda geçişte firmware `[10]`'u 19 olarak saklıyor.

Tuş kodu (matris girişi, sürücüdeki keyinfo_to_hardware_code): normal `[00, mod, 2.tuş, HID]`, tüketici `[02, 00, hi, lo]`,
Fn `[0D,00,00,00]`, KB.ini tip 9 değeri bayt sırası ters, devre dışı `0`. Matris konumu = KB.ini satırının son alanı.
Firmware matrisi geri vermediği için katman her seferinde KB.ini varsayılanları + atamalardan baştan kurulur.
