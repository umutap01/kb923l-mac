# KB923L Pro — protokol ve geliştirici notları

Uygulamanın klavyeyle nasıl konuştuğu; Windows yazılımının (`DeviceDriver.exe`) statik analizi ve klavyede yapılan ölçümler.
Kullanım için ana [README](../README.md)'ye bakın.

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

## Fn katmanı (21 Kas 2026)

Klavyenin Fn tuşu firmware'de işlenir ve Mac'e kod göndermez (rapor tanımlayıcısında Fn alanı yok). Bu yüzden katman Mac'te:
- Kullanıcı bir **katman tuşu** seçer (önerilen Caps Lock). hidutil onu F20'ye (HID 0x6f, kVK 90) yönlendirir.
- Yardımcının olay dinleyicisi (`helper/kbmacro.swift`, `layerKey`) F20 basılıyken katmandaki tuşların kVK'sını ve
  bayraklarını olayın üzerinde değiştirir. Sıra bozulmaz, çünkü iş Node'da değil, olay akışının içinde yapılır.
  Katman bırakıldıktan sonra gelen bırakma olayı da çevrilir; otomatik tekrar da çalışır.
- Kısa basış (300 ms altı, araya başka tuş girmemişse) seçilen tuşu gönderir (Caps Lock için Esc).
- Hedefler: tuş (+⌘⌥⌃⇧), medya (ses ±, sessiz, oynat, önceki/sonraki, parlaklık; NSSystemDefined), fare, makro
  (yardımcı `layerMacro` olayı yazar, makroyu uygulama oynatır).
- Kaynak tuş, temel katmandaki atamasıyla Mac'e giden koddur (`effectiveUsage`). Makro / fare atanmış tuş katmanda kullanılamaz.
- Arayüz tarafında `src/apply.js` temel atamayı, bağları ve katmanı tek hidutil listesinde birleştirir.
- Sınama: oturum düzeyinde yutan bir dinleyiciyle sahte F20 / J / K olayları gönderildi. Sonuç `↓123 ↑123 ↓124+cmd ↑124+cmd ↓38 ↑38`
  (katmanlı J → ←, K → ⌘→, katmansız J değişmedi).

## Ekrana GIF / resim (21 Kas 2026, ölçüldü)

Protokolü DeviceDriver.exe'den çıkardım: `CDevG5KB::AccessData_Page` @ 0x412b20, `SetGIFParam` @ 0x4128a0,
`BurnScreen` iş parçacığı @ 0x466640, piksel dönüşümü @ 0x466475. Klavyede doğrulandı: test görüntüsü ve
3 karelik canlandırma doğru göründü, fabrika GIF'inin 35 karesi uygulama üzerinden 131 saniyede yüklendi.
Kod: `electron/screen.cjs`, arayüz `src/ScreenGif.jsx`, deneme `tools/screen-test.cjs`.

| | |
|---|---|
| Ekran aygıtı | 258A:**01B4**, usage 0xFF03/2, rapor 9: 520 bayt özellik, 7 bayt giriş (onay) |
| KB.ini | `ShowScreen=2`, `siScreen=240,240`, `MaxScreenFrame=35`, `DataUnitSize=512`, `DrawFrameTime=0`, `ScreenCRC` yok (0) |
| SetGIFParam | komut **0x0D**, 5 bayt `[bayrak<<6 \| dizin, kare LE16, gecikme LE16]`; bayrak 1 = başla, 0 = bitir, 2 = iptal. Önce klavyeye (0217), sonra ekrana gider; ikisi de `09 0A 06 01 01` ile onaylar |
| Kare | 240×240 **RGB565 büyük uçlu** (`(R>>3)<<11 \| (G>>2)<<5 \| B>>3`, yüksek bayt önce), satır satır; 115200 bayt = 225 sayfa |
| Sayfa | `[09, 0C, 00, kare, sayfa, sağlama(0), boyLo, boyHi, veri×512]`, yalnız ekran aygıtına; onay `09 0A 06 01 <sayfa>` |
| Süre | kare başına ~3,5 sn (sayfa başına ~16 ms); tüm kareler tek gecikmeyle oynar |

- Akış: başla, 120 ms bekle, kareler, 50 ms bekle, bitir. Yükleme klavyenin komut kuyruğunu tutar, böylece saat gönderimi araya girmez.
- 35 karelik bir yüklemede `IOHIDDeviceSetReport ... general error` bir kez görüldü. Yazma artık Windows sürücüsü gibi bekleyip yeniden deniyor.
- GIF kareleri Chromium'un `ImageDecoder`'ıyla çözülür (birleştirilmiş kare + süre). 35'ten fazla kare eşit aralıkla seçilir;
  gecikme = toplam süre / seçilen kare sayısı.
- `src/assets/screen-default.gif` sürücünün `Dev/0217/screen.gif` dosyasıdır (fabrika görüntüsü; 43 kare).

### Hazır ekran görüntüleri (21 Kas 2026)

`src/presets.js`: canvas'ta kare kare çizilir, dosya taşımaz.
- **Apple logosu:** macOS yazı tipindeki U+F8FF glifi, 1977 gökkuşağı şeritleri, parıltı geçişi. 24 kare, 70 ms.
- **Türk bayrağı:** 2994 sayılı Kanun ölçüleri, dalgalanma. 20 kare, 80 ms.
- **Radar:** dönen ışın, sönen hedefler. 30 kare, 60 ms.
- **Atatürk:** 2 Ekim 1936 portresi. Kaynak Wikimedia Commons "Mustafa Kemal Atatürk siyah beyaz.jpg", lisans CC0;
  dosya `src/assets/ataturk-1936.jpg`. Gri ton, ağır yakınlaşma (1 → 1,08 → 1), kırmızı halka, altta kıvrık ad. 24 kare, 90 ms.
- Hazır görüntüler (fabrika görüntüsü dahil) arayüzde açılır listeden seçilir.

Tuzak: canvas'ta renkleri `source-in` ile birden çok `fillRect` hâlinde basmak, her çizimde alanın dışını siliyor ve logo boş çıkıyor.
Doğrusu önce renkleri çizip sonra maskeyi `destination-in` ile uygulamak.
