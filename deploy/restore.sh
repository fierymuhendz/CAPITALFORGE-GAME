#!/bin/sh
# Yedeği geri yükler.
#   restore.sh DOSYA.dump [HEDEF_VERITABANI]
# HEDEF verilmezse "capitalforge_restore_YYYYMMDD" adlı YENİ bir veritabanı açılır (canlıya dokunulmaz).
# HEDEF canlı veritabanıysa (PGDATABASE) mevcut veri ÜZERİNE yazılır: önce server'ı durdurun ve
# RESTORE_CONFIRM=EVET ortam değişkenini verin.
# Bağlantı: PGHOST/PGUSER/PGPASSWORD/PGDATABASE (veya DATABASE_URL).
set -eu

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
  [ "${RESTORE_CONFIRM:-}" = "EVET" ] || die "canlı veritabanının üzerine yazmak için önce server'ı durdurun ve RESTORE_CONFIRM=EVET verin"
  log "canlı veritabanı '$TARGET' üzerine yazılıyor"
  pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$TARGET" "$DUMP"
else
  log "yeni veritabanı: $TARGET"
  createdb "$TARGET" 2>/dev/null || die "'$TARGET' oluşturulamadı (zaten var olabilir)"
  pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET" "$DUMP"
fi

for t in players ledger_entries; do
  n=$(psql -d "$TARGET" -Atc "SELECT count(*) FROM $t" 2>/dev/null || echo "?")
  log "$t: $n satır"
done
log "TAMAM"
