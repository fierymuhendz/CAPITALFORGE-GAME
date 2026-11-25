#!/bin/sh
# Yedeği geri yükler.
#   restore.sh DOSYA.dump [HEDEF_VERITABANI]
# HEDEF verilmezse "capitalforge_restore_YYYYMMDD" adlı YENİ bir veritabanı açılır (canlıya dokunulmaz).
# HEDEF canlı veritabanıysa (PGDATABASE) mevcut veri ÜZERİNE yazılır. Koşullar:
#   - önce server'ı durdurun: docker compose stop server
#   - RESTORE_CONFIRM değeri hedef veritabanı adına eşit olmalı (ör. RESTORE_CONFIRM=capitalforge)
#   - hedefte başka bağlantı olmamalı (varsa reddedilir)
# Üzerine yazmadan önce BACKUP_DIR (varsayılan /backups) altına pre-restore-<zaman>.dump güvenlik yedeği alınır;
# geri yükleme tek transaction'dadır (hata olursa canlı veri değişmez).
# Bağlantı: PGHOST/PGUSER/PGPASSWORD/PGDATABASE (veya DATABASE_URL).
set -eu
umask 077

log() { echo "[restore] $*"; }
die() { echo "[restore] HATA: $*" >&2; exit 1; }

if [ -n "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  rest="${DATABASE_URL#*://}"
  creds="${rest%%@*}"
  hostpart="${rest#*@}"
  PGUSER="${creds%%:*}"
  PGPASSWORD="${creds#*:}"
  PGDATABASE="${hostpart#*/}"
  PGDATABASE="${PGDATABASE%%\?*}"
  hostport="${hostpart%%/*}"
  PGHOST="${hostport%%:*}"
  case "$hostport" in *:*) PGPORT="${hostport#*:}" ;; esac
  export PGHOST PGUSER PGPASSWORD PGDATABASE
  [ -z "${PGPORT:-}" ] || export PGPORT
fi

DUMP="${1:-}"
[ -n "$DUMP" ] || die "kullanım: restore.sh DOSYA.dump [HEDEF_VERITABANI]"
[ -f "$DUMP" ] || die "dosya yok: $DUMP"
pg_restore --list "$DUMP" > /dev/null 2>&1 || die "dosya geçerli bir pg_dump -Fc yedeği değil"

LIVE_DB="${PGDATABASE:-capitalforge}"
TARGET="${2:-capitalforge_restore_$(date +%Y%m%d)}"
case "$TARGET" in *[!a-zA-Z0-9_]*|"") die "veritabanı adı yalnızca harf, rakam ve _ içerebilir" ;; esac

if [ "$TARGET" = "$LIVE_DB" ]; then
  [ "${RESTORE_CONFIRM:-}" = "$TARGET" ] || die "canlı veritabanının üzerine yazmak için RESTORE_CONFIRM=$TARGET verin (değer hedef veritabanı adına eşit olmalı)"
  others=$(psql -d "$TARGET" -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'") \
    || die "pg_stat_activity okunamadı"
  [ "$others" = "0" ] || die "'$TARGET' veritabanında $others başka bağlantı var; önce 'docker compose stop server' çalıştırın"
  BACKUP_DIR="${BACKUP_DIR:-/backups}"
  [ -d "$BACKUP_DIR" ] && [ -w "$BACKUP_DIR" ] || die "güvenlik yedeği için yazılabilir klasör yok: $BACKUP_DIR"
  pre="$BACKUP_DIR/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
  log "güvenlik yedeği alınıyor: $pre"
  if ! pg_dump -Fc --no-owner -d "$TARGET" -f "$pre.tmp"; then rm -f "$pre.tmp"; die "güvenlik yedeği alınamadı, geri yükleme iptal"; fi
  if ! pg_restore --list "$pre.tmp" > /dev/null; then rm -f "$pre.tmp"; die "güvenlik yedeği doğrulanamadı, geri yükleme iptal"; fi
  mv "$pre.tmp" "$pre"
  log "canlı veritabanı '$TARGET' üzerine yazılıyor (tek transaction)"
  pg_restore --clean --if-exists --single-transaction --no-owner --no-privileges --exit-on-error -d "$TARGET" "$DUMP" \
    || die "geri yükleme başarısız; transaction geri alındı, veri değişmedi. Güvenlik yedeği: $pre"
else
  log "yeni veritabanı: $TARGET"
  createdb "$TARGET" || die "'$TARGET' oluşturulamadı (zaten var olabilir)"
  pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET" "$DUMP"
fi

# Doğrulama: tablolar var olmalı, defter toplamı 0 olmalı. Hata = başarısızlık.
for t in cf.accounts cf.companies cf.ledger_entries; do
  n=$(psql -d "$TARGET" -Atc "SELECT count(*) FROM $t") || die "$t tablosu okunamadı (eksik tablo)"
  log "$t: $n satır"
done
sum=$(psql -d "$TARGET" -Atc "SELECT COALESCE(sum(amount), 0) FROM cf.ledger_entries") || die "defter toplamı hesaplanamadı"
[ "$sum" = "0" ] || die "defter değişmezi bozuk: cf.ledger_entries toplamı $sum (0 olmalı)"
log "TAMAM"
