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
| trade_sell | productId, qtyKg, cityId, gross, pricePerKg | anlık satış gerçekleşti (satıcıya) |
| trade_buy | productId, qtyKg, cityId, gross, pricePerKg | anlık alım gerçekleşti (alıcıya) |
| contract_offer_received | contractId, productId, from, system? | doğrudan teklif geldi |
| contract_accepted | contractId, productId, by | teklifin kabul edildi |
| contract_declined | contractId, by | teklifin reddedildi |
| contract_cancelled | contractId, by, penalty | sözleşme karşı tarafça iptal edildi |
| contract_expired | contractId, productId | teklifin süresi doldu |
| contract_delivery_received | contractId, productId, qtyKg, late | sözleşme teslimi alındı (alıcıya) |
| installment_window_open | contractId, installmentId, seq, dueAt, qtyKg, productId | taksit penceresi açıldı (satıcıya) |
| installment_due_soon | contractId, installmentId, seq, dueAt, missingKg | vadeye 1 saat kala eksik teslim var |
| installment_closed | contractId, seq, result, penalty, refund, missingKg | taksit kapandı (fulfilled/partial/missed, ceza kuruş) |
| shipment_arrived | shipmentId, cityId | sevkiyat vardı (yük sahibi ve alıcı) |
| freight_accepted | jobId, carrier, cityId | taşıma işin taşımacı tarafından alındı |
| freight_delivered | jobId, pay, cityId, role | taşıma işi teslim edildi (role: carrier/shipper) |
| freight_expired | jobId, cityId | taşıma işinin süresi doldu, emanet iade |
