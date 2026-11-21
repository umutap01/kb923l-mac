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

## Makrolar (21 Kas 2026)

Firmware'e makro yazımı (komut 0x05) tuş matrisine bağlı; matris yazımı klavyede uygulanmadığı için makrolar da Mac'te çalışır.

- **Tetik:** Tuş Atama'da bir tuşa makro bağlanınca o tuş hidutil ile F24'e yönlendirilir (kendi karakterini yazmaz).
  `electron/macro.cjs` klavyenin giriş raporlarını okur (Giriş İzleme izni); hidutil öncesi fiziksel kodu görür.
  - Arayüz 0: boot klavye, rapor no yok: `[değiştiriciler, 00, k1..k6]`
  - Arayüz 1, rapor 4: NKRO `[04, değiştiriciler, 13 bayt bit alanı (0x00..0x67), 1 bayt (0x85,87,88,89,8a,8b,91,92)]`
  - (rapor tanımlayıcıları `ioreg -r -c IOHIDInterface -a -l` ile okundu)
- **Oynatıcı:** `helper/kbmacro.swift` (CGEvent). Uygulama bir kez başlatır, stdin'den JSON satırları alır; Erişilebilirlik izni
  ister (izin uygulamaya verilir). Paketlemede `npm run helper` ile derlenir, `Contents/Resources/kbmacro` olarak gelir.
- **Adımlar:** tuş bas/bırak (HID kullanımı, oynatırken macOS kVK'ya çevrilir), bekleme, metin (Unicode, düzenden bağımsız),
  fare tıkı (imlecin olduğu yerde). Kayıt KB923L'den yapılır; kullanıcının tuş atamaları kayda uygulanır.
- **Biçimler:** bir kez (1–99 tekrar), basılı tuttukça, aç/kapa.
- Saklama: `~/Library/Application Support/KB923L Pro/macros.json` (makrolar + bağlar), `remap.json` (hidutil çiftleri).
- Uygulama kapalıyken makrolar çalışmaz; tetik tuşu da F24 kalır (Tuş Atama → "Tümünü kaldır" ya da hidutil kurtarma komutu).

## İmza ve izinler (21 Kas 2026)

Ad-hoc imzada uygulamanın kimliği (cdhash) her derlemede değişiyor, macOS da Giriş İzleme ve Erişilebilirlik iznini
bu kimliğe bağlıyor. Bu yüzden her yeni sürümde izinler sessizce geçersizleşiyordu ("not permitted").
Çözüm: `npm run dist` paketi bu Mac'e özel, kendinden imzalı "KB923L Yerel Imza" sertifikasıyla imzalar (`tools/sign.sh`).
Kimlik `identifier "com.kb923l.mac" and certificate leaf = H"…"` olur ve derlemeler arasında aynı kalır.
Sertifika yoksa `tools/make-cert.sh` ile oturum anahtar zincirine eklenir.
electron-builder güvenilmeyen sertifikayı kabul etmediği için imzayı ona bırakmayıp paketten sonra `codesign` ile atıyoruz.
İzin yoksa uygulama `IOHIDRequestAccess` ile macOS'un izin penceresini kendisi açar.

## Fare tuşları (21 Kas 2026)

Tuş Atama → "Fare" grubu: sol / sağ / orta tık, geri / ileri (fare 4–5), tekerlek (4 yön). Makrolarla aynı yol:
tuş hidutil ile F24'e gider, `macro.cjs` basmayı ve bırakmayı ayrı ayrı yardımcıya iletir (`{"op":"mouse"}`).
- Çift tık: yardımcı tıklama sayısını (`mouseEventClickState`) macOS'un çift tık süresine göre artırır.
- Sürükleme: tuşla bir fare tuşu basılı tutulurken yardımcının olay dinleyicisi (event tap) fiziksel fare hareketini
  `*MouseDragged`'e çevirir.
- Tekerlek: basınca 3 satır, 350 ms sonra basılı tuttukça 60 ms'de bir tekrar.
- Erişilebilirlik izni gerekir; yoksa Tuş Atama sekmesinde uyarı çıkar.

Not: VS Code terminalinden `open` ile açarken `ELECTRON_RUN_AS_NODE` uygulamaya geçer ve uygulama hemen kapanır;
`env -u ELECTRON_RUN_AS_NODE open "/Applications/KB923L Pro.app"` kullanın. (`spctl` "rejected" demesi önemsiz:
karantinasız yerel derlemede Gatekeeper açılışı engellemiyor.)
