#!/bin/sh
# Günlük PostgreSQL yedeği (pg_dump -Fc). Konteynerde sonsuz döngüde çalışır.
# Bağlantı: PGHOST/PGUSER/PGPASSWORD/PGDATABASE (veya DATABASE_URL; yerel deneme için).
# Ortam: BACKUP_DIR (varsayılan /backups), BACKUP_HOUR (varsayılan 3, yerel saat),
#        BACKUP_RUN_ONCE=1 (tek yedek alıp çık), BACKUP_KEEP_DAILY (7), BACKUP_KEEP_SUNDAYS (4)
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_HOUR="${BACKUP_HOUR:-3}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_SUNDAYS="${BACKUP_KEEP_SUNDAYS:-4}"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# DATABASE_URL (postgres://kullanici:parola@sunucu:port/veritabani) -> PG* değişkenleri.
# Parola komut satırına değil ortam değişkenine konur.
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

# Bir sonraki BACKUP_HOUR:00'a kadar saniye.
seconds_until_next_run() {
  h=$(date +%H); m=$(date +%M); s=$(date +%S)
  h=${h#0}; m=${m#0}; s=${s#0}
  now=$(( ${h:-0} * 3600 + ${m:-0} * 60 + ${s:-0} ))
  target=$(( BACKUP_HOUR * 3600 ))
  wait=$(( target - now ))
  [ "$wait" -gt 0 ] || wait=$(( wait + 86400 ))
  echo "$wait"
}

# Tek yedek: geçici adla yaz, pg_restore --list ile doğrula, sonra yeniden adlandır.
take_backup() {
  mkdir -p "$BACKUP_DIR"
  name="capitalforge-$(date +%Y%m%d-%H%M).dump"
  tmp="$BACKUP_DIR/$name.tmp"
  if ! pg_dump -Fc --no-owner -f "$tmp"; then
    log "HATA: pg_dump başarısız"; rm -f "$tmp"; return 1
  fi
  if ! pg_restore --list "$tmp" > /dev/null 2>&1; then
    log "HATA: yedek doğrulanamadı (pg_restore --list), dosya silindi"; rm -f "$tmp"; return 1
  fi
  mv "$tmp" "$BACKUP_DIR/$name"
  log "TAMAM: $name ($(wc -c < "$BACKUP_DIR/$name") bayt)"
}

# Saklama: en yeni KEEP_DAILY farklı günün yedekleri + en yeni KEEP_SUNDAYS pazar günü yedeği. Gerisi silinir.
prune_backups() {
  files=$(ls -1 "$BACKUP_DIR"/capitalforge-????????-????.dump 2>/dev/null | sort -r) || true
  [ -n "$files" ] || return 0
  days=$(echo "$files" | sed 's|.*/capitalforge-\([0-9]\{8\}\)-.*|\1|' | sort -ru)
  keep_days=$(echo "$days" | head -n "$KEEP_DAILY")
  sundays=""
  for d in $days; do
    dow=$(date -d "$(echo "$d" | sed 's/\(....\)\(..\)\(..\)/\1-\2-\3/')" +%u 2>/dev/null || echo 0)
    [ "$dow" = "7" ] && sundays="$sundays $d"
  done
  keep_sundays=$(echo $sundays | tr ' ' '\n' | head -n "$KEEP_SUNDAYS")
  for f in $files; do
    d=$(basename "$f" | sed 's/capitalforge-\([0-9]\{8\}\)-.*/\1/')
    if echo "$keep_days" | grep -qx "$d" || echo "$keep_sundays" | grep -qx "$d"; then continue; fi
    rm -f "$f" && log "silindi (saklama): $(basename "$f")"
  done
}

if [ "${BACKUP_RUN_ONCE:-0}" = "1" ]; then
  take_backup
  prune_backups
  exit 0
fi

log "başladı; her gün $(printf '%02d' "$BACKUP_HOUR"):00 (yerel saat) yedek alınır"
while true; do
  w=$(seconds_until_next_run)
  log "sonraki yedeğe $w sn"
  sleep "$w"
  take_backup || log "yedek alınamadı, yarın yeniden denenecek"
  prune_backups || true
  sleep 60 # aynı dakikada çifte çalışmayı önler
done
