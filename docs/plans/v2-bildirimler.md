# Bildirim türleri

Sunucu `notify(..., kind, params)` ile yazar; istemci `notifications.<kind>` anahtarını `params` ile çevirir.
Yeni tür ekleyen modül buraya bir satır ekler.

| kind | params | ne zaman |
|---|---|---|
| welcome | company, building | şirket kuruldu |
