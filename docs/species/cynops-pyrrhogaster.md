# Kırmızı karınlı semender — *Cynops pyrrhogaster*

Etiketler: **[D]** kaynakta doğrulanmış · **[G]** semenderler/amfibiler için genel bilgi, bu türde ayrıca test edilmemiş · **[V]** simülasyon varsayımı

## Biyoloji → simülasyon

| Konu | Gerçek | Oyunda |
|---|---|---|
| Besin | Erişkinler suda sinek larvaları, karada eklembacaklılar; az besin döneminde kendi döktüğü deri de yenir [D: Current Herpetology 33(1)] | Solucanlar; deri değiştirdikten sonra eski derisini yer |
| Av bulma | Hareketli avı görme, duran yiyeceği koku; suda yan çizgi [G] | Görme (harekete duyarlı, ışığa bağlı, sırtın üstünü de görür), suda zamanla yayılan koku alanı (iki burun deliği farkıyla yön = zikzak izleme), suda yan çizgi, karada zemin titreşimi |
| Yakalama | Suda emme ile, karada çene/dil atağı [G] | Yaklaş → kilitlen → atak; ıskalarsa en fazla 3 deneme; solucanı baş sallayarak yutar |
| Solunum | Akciğer + deri; yüzeye çıkıp hava yutar, sıcakta daha sık [G] | Oksijen deposu suda azalır (Q10 ve hareketle hızlanır), yüzeyde yutkunarak dolar |
| Deri nemi | Karada nem kaybeder [G] | Ortam nemine bağlı kurur; düşünce suya döner |
| Savunma | Başa dokunulunca **unken refleksi** (sırt içe bükülür, turuncu karın gösterilir); kuyruk dalgalandırma 20°C'de daha sık [D: Current Herpetology 35(1); PLOS ONE 2021] | Karada çok yakın tehditte unken; uzakta suya / dibe kaçış |
| Deri değiştirme | Düzenli; deri çoğunlukla yenir, sıklık bireye göre değişir [G: bakıcı raporları] | ~3.5 oyun gününde bir: çene sürtme → sıyrılma → deriyi yeme |
| Etkinlik | Alacakaranlık / gece daha hareketli [G] | Gece %75 hareketli, gündüz %88 dinlenme (5 günlük test) |
| Öğrenme | Amfibiler beslenme olaylarını yer ve zamanla ilişkilendirebilir [G] | Yemi ilk fark ettiği saat ve yer öğrenilir; açken saat yaklaşınca yem yerine gidip bekler |
| Sıcaklık | Serin su türü, ~15–22°C [G] | Q10≈2 metabolizma; 24°C üstünde serin dipte dinlenir, stres artar |
| Bireysellik | — | Etkinlik, cesaret, karaya eğilim, koku duyarlılığı bireye göre dağılımlı [V] |

## Mimari

- `src/eco/` ortak çekirdek: varlık kaydı + uzamsal ızgara, titreşim uyaranları, LOD (görünür/uzak ajanlar seyrek düşünür), fayda tabanlı karar (bağlılık payı, kilitli eylemler), algı ve yer hafızası.
- `src/terra/Newt.js`: algı, sınıflandırma, metabolizma, hareket (bekçi: 15 sn ilerleyemezse yeniden karar), iskelet animasyonu.
- `src/terra/newtActions.js`: dinlenme, yiyecek arama, koku izleme, avlanma, hava alma, nemlenme, deri değiştirme, unken, kaçış, yem bekleme, gezinme.
- Ajan haritayı bilmez: yalnızca algıladıkları ve hafızası. Yaşadığı terraryumun kuytularını ve gölet derinliklerini bildiği varsayılır [V].

## Kaynaklar

- Feeding habits — [Current Herpetology 42(2)](https://complete.bioone.org/journals/current-herpetology/volume-42/issue-2/hsj.42.162/Feeding-Habits-of-the-Japanese-Fire-belly-Newt-Ampbihia/10.5358/hsj.42.162.full), [33(1)](https://bioone.org/journals/current-herpetology/volume-33/issue-1/hsj.33.38/Food-Habits-of-the-Adult-Japanese-Newt-Cynops-pyrrhogaster-Amphibia/10.5358/hsj.33.38.full)
- Juvenile diet — [Zoological Science 20(7)](https://complete.bioone.org/journals/zoological-science/volume-20/issue-7/zsj.20.855/Food-Habit-of-the-Juvenile-of-the-Japanese-Newt-Cynops/10.2108/zsj.20.855.full)
- Unken / coiling — [Current Herpetology 35(1)](https://complete.bioone.org/journals/current-herpetology/volume-35/issue-1/hsj.35.69/An-Observation-of-Coiling-around-Behavior-as-a-Putative-Antipredator/10.5358/hsj.35.69.full)
- Tail displays vs snakes — [PLOS ONE 2021](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8629279/)
- Shedding (keeper reports) — [caudata.org](https://www.caudata.org/threads/newt-skin-shedding.2306/)
