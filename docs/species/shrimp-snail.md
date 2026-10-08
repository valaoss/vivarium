# Karides ve nerit salyangoz — davranış profilleri

Etiketler: **[D]** kaynakta doğrulanmış · **[G]** genel akvaryum / omurgasız bilgisi · **[V]** simülasyon varsayımı

## Ortak zemin

- Akvaryum dibi (kum, çakıl, taş taramaları, kök, ekipman) açılışta ve taş taramaları yüklenince yukarıdan çizilip yükseklik haritasına dönüşür (`bakeHeightfield`). Karides ayakları ve salyangoz tabanı ekranda görünen yüzeye basar [V].
- Ayak yerleştirme ortak modülde (`src/eco/legs.js`): basan ayak kilitli, salınımda ayak iniş noktasına alçak bir yayla gider, uzanamadığı yere basmaz [V].

## Red cherry / Amano karides (Neocaridina davidi, Caridina multidentata)

| Davranış | Oyunda | Dayanak |
|---|---|---|
| Yürüme | 3 çift yürüme bacağı (P3–P5) her yanda arkadan öne metakronal dalga, karşı taraf yarım faz geride; gövde bacak alanındaki zemine uydurulan düzleme göre eğilir | Caridea'da P1–P2 kıskaçlı beslenme, P3–P5 yürüme [G]; dalga düzeni [V] |
| Beslenme | Kıskaçlı ilk iki çift sırayla yüzeyi tarar ve ağza götürür; taş/kök üstünde biyofilm kumdan zengin | Biyofilm ve detritus temel besin [G: Viau ve ark. 2020] |
| Koku | Antenciklerle yem kokusu; yayılan koku bulutu (difüzyon), sol/sağ antencik farkıyla dönüş (klinotaksi), koku alınca antencikler sık çırpılır | Antencik çırpma koku örneklemesidir [G: dekapod kimyasal algısı]; bulut modeli [V] |
| Yüzme | Karın altındaki yüzme bacaklarıyla kürek; suya yem düşünce sık sık yüzerek arar; yürüyerek geçemediği taşın üstünden yüzer | [G] |
| Kaçış | Ani tehditte karın bir anda kıvrılır, geriye doğru fırlar (kuyruk çırpma); tehdit sürerse 2–3 vuruş | Karidoid kaçış tepkisi [G] |
| Avcı algısı | Melek balığı gibi avcı ya da iri balık yaklaşınca tedirginlik; saldırıda kaçış | [G] |
| Saklanma | Stresliyken, avcı yakındayken ve kabuk değişimi yaklaşırken taş/kök/bitki dibine | [G] |
| Kabuk değişimi | Yaklaşık 8–12 oyun gününde bir (küçükler daha sık); sığınakta 4 sn'de eski kabuktan sıyrılır, kabuk yerde kalıp solar; yeni kabuk yumuşakken saklanır | 23 °C'de ~10 gün; deri değiştirme sonrası ~1 gün yumuşak dönem [D: SICB molt-cycle özeti] |

## Nerit salyangoz (Neritina natalensis)

| Davranış | Oyunda | Dayanak |
|---|---|---|
| Taban dalgası | İki sıralı (ditaksik), geriye ilerleyen (retrograd) dalgalar; sağ ve sol yarı aynı anda; camdan bakınca bantlar görünür | Nerita: ditaksik retrograd, iki yan "karşılıklı" (eş zamanlı) [D: Parker 1911, Kyoto Üniv. derlemesi]; Neritina için aynı varsayıldı [V] |
| Mukus izi | Tabanın bıraktığı ince parlak şerit, ~4 dk'da incelip kaybolur | Taban dalgaları mukus tabakası üzerinde iş görür [D]; sürenin kendisi [V] |
| Yüzeye uyum | Zemin, taş ve kök üstünde yüzey normaline göre döner; ön camın iç yüzüne ayağını yapıştırıp ~5 sn'de tırmanır | [G] |
| Beslenme | Radulayla yosun kazır; camdaki yosun gerçekten temizlenir; yosunlu yerde yavaşlayıp kıvrılır | [G]; arama düzeni [V] |
| Koku | Dokunaçlarla dipteki yemi bulur, yavaş klinotaksi | [G] |
| Çekilme | Titreşim, dokunuş ya da üstünden hızla geçen büyük balığın gölgesiyle ayağını kabuğa çeker, operkulumu kapatır; sonra önce dokunaçlar, sonra ayak çıkar | Gölge refleksi gastropodlarda yaygın [G]; süreler [V] |
| Dinlenme | Ara ara uzun hareketsiz dönemler | [G] |

## Test sonuçları (tarayıcıda)

- Karides, 8000 kare: basan ayağın uç noktası ile zemin arası %99'da 0.1 mm içinde; IK menzil hatası %99'da 0.3 mm; basan ayak kayması 0.
- Yem: 8 cm'deki dipteki yemin kokusunu yaklaşık 2 sn'de alıp izledi, başını yemin üstüne getirip 6 sn didikleyerek yedi.
- Kaçış: yakın tehditte kuyruk çırpıp geriye fırladı, sonra süzülerek indi.
- Kabuk değişimi: sığınağa gitti, 4 sn'de sıyrıldı, kabuk yerde kaldı, yumuşak dönemde saklandı.
- Salyangoz, 4 dk: zeminden ön cama geçti, camda yosun temizledi, titreşimde kabuğuna çekilip sonra çıktı; zemin teması 1.5 mm içinde.

## Kaynaklar

- [Gastropod taban dalgaları (Kyoto Üniv.)](https://repository.kulib.kyoto-u.ac.jp/dspace/bitstream/2433/257858/1/mcskiu-b_12_2_237.pdf) · [Jones & Trueman 1970, JEB](https://cob.silverchair.com/jeb/article-pdf/3177365/jexbio_52_1_201.pdf) · [Su salyangozu hareketi](https://ar5iv.labs.arxiv.org/html/0806.3651)
- [Neocaridina davidi deri değiştirme döngüsü (SICB)](https://sicb.org/abstracts/characterization-of-the-molt-cycle-of-the-cherry-shrimp-neocaridina-davidi/) · [Neocaridina bakım rehberi](https://shrimpupaquatics.com/blogs/news/ultimate-neocaridina-shrimp-care-guide)
