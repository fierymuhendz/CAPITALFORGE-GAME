# Bildirim türleri

Sunucu `notify(..., kind, params)` ile yazar; istemci `notifications.<kind>` anahtarını `params` ile çevirir.
Yeni tür ekleyen modül buraya bir satır ekler.

| kind | params | ne zaman |
|---|---|---|
| welcome | company, building | şirket kuruldu |
| account_frozen | (yok) | yönetici hesabı dondurdu |
| account_unfrozen | (yok) | yönetici hesabı çözdü |
| admin_transaction_reversed | kind | yönetici bir işlemi ters kayıtla düzeltti |
| admin_listing_cancelled | productId, cityId | yönetici ilan/emri iptal etti (rezerv/emanet iade edildi) |
| admin_contract_cancelled | productId | yönetici sözleşmeyi iptal etti (emanet ve teminat iade edildi) |
| production_done | recipe, product, qtyKg, quality, city | üretim işi bitti, çıktı depoya girdi |
| line_stalled | facility, city, reason (MISSING_INPUT/INSUFFICIENT_FUNDS/ARREARS), product, recipe | tekrar modundaki hat yeni işi başlatamadı |
| construction_done | building, city | inşaat bitti, bina hazır |
| upgrade_done | building, city, level | bina seviye yükseltmesi bitti |
| quality_upgrade_done | building, city, quality | bina kalite iyileştirmesi bitti |
| research_done | research, level | araştırma bitti |
| loan_installment_paid | amount, remaining | günlük kredi taksiti ödendi (tutar ve kalan anapara kuruş metni) |
| loan_installment_missed | amount, arrears | taksit ödenemedi; ödenemeyen kısım + gecikme ücreti arrears'a yazıldı, arrears toplamı |
| upkeep_missed | amount, arrears | günlük bakımın ödenemeyen kısmı arrears'a yazıldı |
| arrears_settled | amount, remaining | nakit girişinden sonra gecikmiş borç (kısmen) kapandı |
