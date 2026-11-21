#!/bin/sh
# Bu Mac'e özel kod imzalama sertifikası üretir ve oturum anahtar zincirine ekler (yalnız codesign kullanabilir).
set -e
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
cat > "$D/c.cnf" <<'CNF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = KB923L Yerel Imza
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$D/k.pem" -out "$D/c.pem" -days 3650 -config "$D/c.cnf"
P=$(openssl rand -hex 12)
openssl pkcs12 -export -legacy -inkey "$D/k.pem" -in "$D/c.pem" -out "$D/i.p12" -passout "pass:$P"
security import "$D/i.p12" -k ~/Library/Keychains/login.keychain-db -P "$P" -T /usr/bin/codesign
