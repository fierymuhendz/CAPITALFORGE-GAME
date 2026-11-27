---
name: cf-tasarim
description: Capital Forge oyun ve web tasarımını Sim Companies’in üretim ve ticaret kararlarından esinlenerek mevcut çalışan oyunda uygular. Stüdyo ajanlarını, frontend-design ve ui-ux-pro-max becerilerini koordine eder.
argument-hint: "[ekran, oyuncu hedefi veya tasarım isteği]"
disable-model-invocation: true
---

# Capital Forge tasarım çalışması

Kullanıcı isteği: $ARGUMENTS

İstek kapsam belirtmiyorsa şirket görünümü → tesis → üretim → stok → pazar veya sevkiyat zincirini ele al. Önce `CLAUDE.md`, ilgili mevcut ekranlar, veri sözleşmeleri ve tasarım token’larını oku. Başlangıç noktası çalışan Next.js uygulamasıdır.

1. **Oynanış ve ekonomi.** `game-designer` ile `economy-designer` alt ajanlarına aynı oyuncu hedefini ver. Birincisi karar ve geri bildirim akışını, ikincisi ekranlarda gereken doğrulanmış miktar, süre, stok ve fiyat alanlarını çıkarsın.
2. **Görsel yön ve kullanım.** `art-director` ile `ux-designer` alt ajanlarını görevlendir. Referans oyundan üretim zincirlerinin ve pazarın okunabilmesini al. Sim Companies’in marka, görsel ve metinleri yerine Capital Forge’un şehir ve sanayi kimliğini kullan. Tasarım kararlarını doğrudan uygulayıcıya geçir.
3. **Uygulama.** `frontend-design` ve `ui-ux-pro-max` becerilerini yükle. Projeye özel kodu yazmak için mevcut `arayuz-dev` ajanını veya ana oturumu kullan. Eşzamanlı çalışan uygulayıcıların dosyaları ayrı olsun. Kurulu istemcide alt ajan desteği yoksa ilgili `.claude/agents/*.md` tanımlarını ve iki becerinin `SKILL.md` dosyalarını okuyup aynı sorumlulukları ana oturumda uygula. Bu durumda hangi rollerin doğrudan yürütüldüğünü teslimde açıkla.

   UI/UX Pro Max içinde proje kökünden dar bir sorgu örneği:

   ```sh
   python3 .claude/skills/ui-ux-pro-max/scripts/search.py "focus not obscured" --domain ux -n 2
   ```

4. **Karar ekranları.** Masaüstünde kullanılabilir genişliği paylaşan gezinme, çalışma alanı ve gerektiğinde ayrıntı düzeni kur. Telefonda işlemleri parmakla ve klavyeyle erişilebilir tut. Gerçek API alanlarını, TR/EN sözlüğünü, seçili ürün ve tesis bağlamını kullan. Bir ekran içinde aynı bilgi ve başlığı tekrar etme. Mevcut çevrimdışı ilerleme ve oyun modu sürelerini görüntüle.
5. **Oynayarak kontrol.** Kapsamdaki ana eylemi çalıştır. Masaüstü ve telefon genişliğinde ana akışı, klavye odağını, taşma ve örtülen eylemleri kontrol et. İlgili kod denetimini ve projedeki uygun testleri çalıştır. Teslimde değişen ekranları ve doğrulanmış akışı yaz. Bir ortam erişilemiyorsa hangi kontrolün kaldığını belirt.

Kullanıcı tarafından verilmiş görsel yön ve ürün kurallarıyla ilerle; küçük tasarım kararlarını çalışan oyun içinde çöz.
