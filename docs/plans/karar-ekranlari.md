# Karar ekranları: ne üretmeli, nerede satmalı, şimdi ne yapmalı

Kaynak: yeni oyuncu oyun testi (Tarım, Körfezkent, Tarla) + game-designer, economy-designer, art-director, ux-designer brifleri.

## Oyun testinde bulunan duraksamalar
- Arsa listesinde ilk kartlar "seviye yetersiz"; İleri devre dışı ve nedeni görünmüyor. → Uygun arsalar önce sıralanır.
- Tek tesis varken önce liste, sonra "İş başlat" tıklaması gerekiyordu. → Tek tesiste doğrudan üretim kararı açılır; `?tab=facilities&facility=<id>` derin bağlantısı.
- Tarif kartları yalnızca tahmini kâr gösteriyordu; girdi, eksik, çıktı, maliyet karşılaştırılamıyordu. → Tarif karşılaştırma tablosu.
- **Tahmini kâr navlunu düşmüyordu.** Yem bitkisi +₺1.176 görünüyordu; Kavşak'a navlun düşülünce −₺2.772. → `estimateSale` alıcı başka şehirdeyse sistem navlununu düşer, navlun sonrası en çok kazandıran alıcıyı seçer, `estimate.freight` ve `estimate.km` döner.
- Uzak alıcıya "Oraya gönder" kendi aracı olmayan oyuncuyu boş "Boşta aracın yok" ekranına götürüyordu. → `POST /market/haul`: stoğu alıcının şehrine sistem taşımacısı tarifesiyle taşıt (kamyon dolusu başına iş, stok rezervi + navlun emaneti tek işlemde).
- Ana ekranda çalışan/boşta tesis, yoldaki mal, satılabilir stok yoktu; telefonda "Sıradaki adımlar" haritanın altında kalıyordu. → Operasyon panosu, telefonda haritanın üstünde.
- Depo telefonda "Daha fazla" içindeydi; depodan satışa geçerken miktar taşınmıyordu. → Alt sekmede Depo; satır içi "Piyasada sat" ürün, kalite, şehir ve miktarı korur.
- Eksik girdiyi almaya giden oyuncunun tesise dönüş yolu yoktu. → Pazarda "Tarla tesisine dön", aynı tarif seçili.

## Ekranlar
1. **Ne üretmeli** (`FacilityDetail`): Ürün · Girdi (elde/gereken, eksik kırmızı) · Süre · Çıktı · Maliyet · Tahmini kâr (alıcı şehri, navlun dahil) · Kâr/saat. "En iyi" = en yüksek kâr/saat. Seçili tarifin eksik girdisi: "Eksik X kg Tohum al" → Pazar Al, ürün/şehir/miktar dolu. Başlatılamıyorsa eylem çubuğunda nedeni (`aria-describedby`).
2. **Nerede satmalı** (`MarketPanel` Sat): Alıcı · Şehir · Miktar · Alıcı fiyatı · Komisyon + navlun · Eline geçen · Kâr · Tahsilat. En iyi teklif kartında kâr ve doğrudan "Sat"/"Taşıt". Uzak alıcı → taşıt penceresi: mal bedeli, komisyon, navlun, tahmini net, kâr ve iki adım.
3. **Şimdi ne yapmalı** (`OpsBoard`): Dikkat isteyen işler (gecikmiş ödeme, durmuş tesis, boş hat, satılabilir stok), Tesisler (durum + geri sayım), Yoldaki sevkiyatlar (varış sayacı, taşıyıcı bekleyen işler). Her satır ilgili işlemi açar.

## Görsel kararlar (art-director)
- Durum dili `Status`: çalışıyor dolu daire (yeşil), boşta halka (gri), durdu kare (kırmızı), yolda ok (çelik mavi), dikkat üçgen (kehribar). Bakır yalnızca seçim ve ana eylem.
- Tablo sayıları sağa hizalı, tabular rakam; başlıklarda büyük harf yok.
- Seçili satır: `--surface-3` zemin + bakır sol çizgi; "en iyi" yıldız etiketiyle ayrı.
- Portal pencereler (Sheet) de çalışma alanı renklerini kullanır.

## Doğrulama
- `apps/server/src/test/v3.int.test.ts`: tahminde navlun; `POST /market/haul` (2 iş, emanet, rezerv, tekrar, aynı şehir reddi, varışta maliyete navlun, defter değişmezleri).
