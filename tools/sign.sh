#!/bin/sh
# Paketlenen uygulamayı bu Mac'teki sabit, kendinden imzalı sertifikayla imzalar (21 Kas 2026).
# Neden: ad-hoc imzada kimlik (cdhash) her derlemede değişir; macOS Giriş İzleme / Erişilebilirlik iznini
# kimliğe bağladığı için her yeni sürümde izin geçersizleşiyordu. Sertifikayla imzada kimlik
# "identifier + sertifika" olur ve derlemeler arasında aynı kalır.
# Sertifika yoksa: tools/make-cert.sh (oturum anahtar zincirine "KB923L Yerel Imza" ekler).
set -e
ID="KB923L Yerel Imza"
APP="release/mac-arm64/KB923L Pro.app"
if ! security find-identity -p codesigning | grep -q "$ID"; then
  echo "'$ID' sertifikası yok; ad-hoc imzalanıyor (izinler her derlemede yeniden verilmeli). tools/make-cert.sh ile oluşturun." >&2
  ID="-"
fi
codesign --force --deep --sign "$ID" "$APP/Contents/Resources/kbmacro"
codesign --force --deep --sign "$ID" "$APP"
codesign --verify --deep --strict "$APP"
codesign -dr- "$APP" 2>&1 | grep designated
