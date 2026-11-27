# 3D şehir performans notları

Sahne: `apps/web/src/scene/` (three.js 0.180, harici model/doku yok), 2D alternatif: `apps/web/src/map2d/`.

## Kalite kademeleri

| Kademe | Renderer | Gölge | Piksel oranı | Süs | Duman | Kare hızı |
|---|---|---|---|---|---|---|
| high | antialias, high-performance | PCFSoft 2048 | min(DPR, 2) | 170 ağaç, 50 kaya | evet (tek InstancedMesh) | 60 |
| low | antialias yok, low-power | yok | 1 | 50 ağaç, 12 kaya | yok | ~30 (kare atlanır) |
| lite | WebGL yok: SVG harita | - | - | - | - | 4 Hz araç güncellemesi |

`detectQuality(pref)` (`scene/quality.ts`): lite seçimi veya WebGL yoksa lite; auto iken azaltılmış hareket, deviceMemory <= 2, çekirdek <= 4, küçük dokunmatik ekran (deviceMemory >= 6 ve 8+ çekirdek değilse) low; aksi halde high. Bağlam kaybı veya renderer hatasında `CityView` kendiliğinden 2D haritaya düşer.

## Ölçümler (dev sayfası, 80 arsa, 26 araç, headless Chromium + SwiftShader)

Tek kare, `renderer.info` (high değerleri gölge geçişi dahil):

| Durum | Çizim çağrısı | Üçgen |
|---|---|---|
| low, ülke görünümü | 80 | 22 280 |
| low, tek şehir | 51 | 19 370 |
| high, ülke görünümü (ana 81 + gölge) | 145 | 50 710 |
| high, tek şehir | 116 | 47 800 |

Kalite değiştirme döngüsü (6 kez) sonrası geometri sayısı sabit (49), sızıntı yok.

## Kararlar

- Her bina türü x seviye tek birleşik, köşe renkli geometri (1 çağrı) ve önbellekte paylaşılır.
- Tabela, çerçeve, bayrak, iskele, kepenk ve parıltı/lamba kutuları veri değişince tek birleşik ağa dönüşür (yaklaşık 70 çağrı tasarruf).
- Arsa zeminleri, ağaçlar, kayalar ve duman InstancedMesh.
- Düz gölgeli (flatShading) Lambert, ışık sayısı 2 (hemisfer + güneş), nokta ışığı yok; kızıl parıltı emissive benzeri BasicMaterial.
- Veri güncellemesi arsa imzasına göre farklıdır: yalnızca değişen arsalar yeniden kurulur; araçlar kimliğe göre güncellenir, konum her karede transitProgress ile hesaplanır.
- Sekme gizliyken veya görünüm dışındayken (visibilitychange, IntersectionObserver) çizim döngüsü durur.
- Sökülürken: kontroller, olay dinleyicileri, geometri/malzeme, renderer (forceContextLoss), etiket div'leri temizlenir.
- Araçlar hâlâ tek tek çizilir (araç başına 1 çağrı); yüzlerce araç olursa kimlik/model başına InstancedMesh'e geçilmeli.

## Bilinen sınırlar

- 3D tuval klavyeyle gezilemez; klavye ve ekran okuyucu için 2D harita (button rolü, aria-label) kullanılır.
- Gerçek mobil cihazda ölçüm yapılmadı; sayılar yazılım rasterleştirici ile alındı.

## v4: 45 bina türü, 6x6 ızgara (180 arsa)

- Silüet bina tanımındaki `archetype` alanından gelir (`WorldDto.buildingTypes`); ilk 6 tür (field, barn, mine, food_plant, steel_mill, garage) tür kimliğiyle çizilir ve görünümü değişmedi. `BUILDING_TYPE_IDS` kaldırıldı, yerine `LEGACY_TYPE_IDS`.
- Yeni arketipler: quarry, mill, kiln, warehouse, greenhouse, orchard, forest, workshop (factory = food_plant geometrisi). Geometri önbelleği anahtarı `arketip:iş kolu rengi:seviye:aksan`; aynı arketip ve iş kolundaki türler tek geometriyi paylaşır, yani 45 tür en çok (arketip x iş kolu x seviye) kadar geometri üretir, çizim çağrısı yine bina başına 1.
- Dış halka: arsa hücresi 6x6 = 36/şehir, `InstancedMesh` arsa zemini 180 örnek (tek çağrı). Şehir zemini PAD_HALF 4,65. Yatak işaretleri (boş arsada) mevcut süs birleştirmesine girer, ek çağrı yok.
- Ölçüm (yazılım rasterleştirici, düşük kalite, Demirdağ odağı, 180 arsa): 140 çizim çağrısı, 44 700 üçgen, 75 geometri; 60 sn boyunca uygulamadan kaynaklanan konsol hatası yok.
- Kamera: ülke görünümü ve şehir odağı çerçevesi PAD_HALF'e bağlı, 6x6 hücreye göre otomatik büyür.
