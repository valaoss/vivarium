# Vivarium — ilk etap

Three.js ile tarayıcıda çalışan, gerçekçi görünümlü küçük bir tatlı su akvaryumu simülasyonu.

## Çalıştırma

```bash
npm install
npm run dev
```

Ardından terminalde yazan adresi (varsayılan `http://localhost:5173`) aç.

## Kontroller

- **Sürükle**: kamerayı döndür · **Tekerlek**: yakınlaş
- **Bak**: balığa dokun → bilgi kartı, cama dokun → balıklar ürker
- **Yem**: su yüzeyine dokunarak pul yem bırak
- **Cam sil**: ön camdaki yosunu sürükleyerek temizle
- **Su değişimi**: %10–50 kısmi değişim (%30 üstü stres yaratır)
- **Tank büyütme**: Dükkân → Tank sekmesi; Nano 60 L → Orta 150 L (Sv 4) → Büyük 250 L (Sv 6). Büyük tankta atık seyrelir, canlı sınırı artar; bitkiler ve canlılar yeni tanka taşınır
- **Hava / Işık**: hava taşı ve lamba (lamba 08:00–21:00 otomatik)
- **1× / 4× / 16×**: zaman hızı (1 sn = 1 oyun dakikası)
- **Ses**: aç/kapa (tercih hatırlanır)
- **Fotoğraf**: arayüzü gizler, alan derinliği açar; Boşluk veya deklanşör ile PNG indirir, Esc ile çıkar

İlerleme tarayıcıda otomatik kaydedilir; geri döndüğünde geçen süre (en fazla 12 oyun saati) simüle edilir.
Kaydı sıfırlamak için tarayıcı konsolunda `vivarium.reset()`. Su yüzeyi yansıması zayıf makinelerde adrese `?norefl` eklenerek kapatılabilir.

## Türler ve ilerleme

Bitkiler: vallisneria, java eğreltisi, anubias, kriptokorin, Amazon kılıcı, Ludwigia (prosedürel, kızıl tepeli) ve yüzen Amazon frogbit (prosedürel, sarkan kökleriyle).

8 tür var: lepistes, neon tetra, corydoras, red cherry karides, nerit salyangoz, zebra danio, beta ve melek balığı. Yeni türler **Doğa Seviyesi** ile açılır (görev, gözlem ve sağlıklı tank deneyim kazandırır). Dükkân uyumsuz türler için uyarır: beta lepisteslere ve başka betalara saldırır, melek balığı neon ve karides avlar. Stresli balıklarda beyaz benek hastalığı çıkabilir; bilgi kartından tedavi edilir.

## Dokular

`public/textures/` içindeki kum, taş, kök, zemin, dolap ve duvar dokuları ile `hotel_room_1k.hdr` ortam ışığı [Poly Haven](https://polyhaven.com)'dan alınmıştır (CC0, kamu malı). Vallisneria yaprak dokusu `grass_bermuda_01`'den gelir (`public/models/plants/`, CC0). UV'si olmayan taş ve çakıllarda üç eksenli (triplanar) yansıtma kullanılır.

## 3D model atıfları (CC-BY 4.0)

- Neon tetra: "[Paracheirodon Innesi _ Tetra Neon](https://sketchfab.com/3d-models/paracheirodon-innesi---tetra-neon-2fabf5db754746b7b81ebfa0bbe99161)" — [BlueMesh](https://sketchfab.com/VapTor), [CC-BY 4.0](http://creativecommons.org/licenses/by/4.0/). Oyunda iskelet animasyonu yerine kendi yüzme shader'ımıza uyarlandı.
- Lepistes (erkek): "[Guppy Fish](https://sketchfab.com/3d-models/21e14e4b961e406385539f79eacdb1dc)" — BlueMesh, CC-BY 4.0
- Lepistes (dişi): "[Guppy ♀](https://sketchfab.com/3d-models/feab250d4ab544de8eb7fda9fc1c2978)" — Nestaeric, CC-BY 4.0
- Beta: "[Betta Splendens](https://sketchfab.com/3d-models/f4eeb7f50ad24873842bd954ad27d23b)" — BlueMesh, CC-BY 4.0
- Java eğreltisi, kriptokorin ve Amazon kılıcı: "[Aquariumplants (Java Fern, Vallisneria etc)](https://sketchfab.com/3d-models/f34fac656a364f8eaeab0918179d6df6)" — [Nullified](https://sketchfab.com/Nullifiedit), CC-BY 4.0 (parçalara ayrıldı, sadeleştirildi ve tür renklerine boyandı)
- Anubias: "[Plants Anubias](https://sketchfab.com/3d-models/2ba1d06a191b437e848b81b2981a9e02)" — Pala_002, CC-BY 4.0
- Otocinclus (gövde): "[Hypostomus / Coroncoro](https://sketchfab.com/3d-models/3c4466d5f0ce4b2e81a692ba89807ced)" — alzarac, CC-BY 4.0 (otocinclus deseniyle)
- Nerit kabuğu: "[Black and White Nerite Shell](https://sketchfab.com/3d-models/c3b2ba55a35946608814d0db896cbe58)" — RISD Nature Lab, CC-BY 4.0 (zebra nerit tonuyla)
- Kök: "[Real Aquarium Wood 3D scan](https://sketchfab.com/3d-models/c53807eff7c4427faacfde6c1b581532)" — zdenkoroman, CC-BY 4.0

Teraryum (Dock → Teraryum): Japon kırmızı karınlı semenderi için yarısı gölet, mantar kabuklu cam teraryum. Semenderin yürüme (çapraz bacak çiftleri, S kıvrımlı gövde), yüzme (bacaklar gövdeye yatık, kuyruk dalgası), yüzeyden hava alma, avına sinsice yaklaşıp atakla yakalama ve yutkunma hareketleri iskelet üzerinde prosedürel üretilir. Sis püskürtme nemi artırır ve ön camı buğulandırır.

- Semender: "[CC0 Japanese Fire-bellied Newt](https://sketchfab.com/3d-models/162a62976ebd4b7180db6723564b72ab)" — ffish.asia / floraZia, CC0
- Mantar kabuğu: "[Cork bark flat](https://sketchfab.com/3d-models/55783c3b79764ef4b06fd0b99a620220)" ve "[Cork Bark tube](https://sketchfab.com/3d-models/07dec8bbaf1f4a6c88799ea6147ba6c2)" — harenil, CC-BY 4.0
- Yosun: "[Ground moss fores square 2k](https://sketchfab.com/3d-models/8b5699d30035485c9564035bb4458a91)" — 3dhdscan, CC-BY 4.0
- Eğrelti `fern_02`, `calathea_orbifolia_01` ve zemin dokusu `forest_leaves_02`: Poly Haven, CC0

Melek balığı: "[Freshwater Angelfish](https://sketchfab.com/3d-models/37475fc6c8904b6bbf7e27617bd851b8)" — Wataru Onuki (monte-hotate), Sketchfab Standard lisansı; yabani gümüş-çizgili desenle boyandı.

CC0 (atıf gerekmez, teşekkürler): ffishAsia & floraZia taramaları (kılıçkuyruk; medaka gövdesi zebra danio, kiraz barbus ve harlequin rasbora desenleriyle; loach gövdesi kuhli deseniyle; karides; sivrisinek balığı gövdesi siyah moli ve plati renkleriyle; cennet balığı gövdesi cüce gurami deseniyle), Poly Haven `rock_07`, `rock_09`, `dead_quiver_branch_01`. Modeller telefon için sadeleştirildi ve dokuları WebP'ye çevrildi.

## Yapı

- `src/render/` — sahne, cam, su (emilim, kostik, yüzey, ışık huzmeleri), partiküller, post-processing
- `src/world/` — kum, taşlar, kök, ekipman, bitkiler
- `src/creatures/` — prosedürel balık geometrisi, yüzme shader'ı, davranış (Fish, Shrimp), tür verileri
- `src/sim/ecosystem.js` — atık → filtre → nitrat, yosun, oksijen, sağlık/açlık/stres, gelir
- `src/audio/Sound.js` — Web Audio ile sentezlenen sesler (dosya yok): filtre uğultusu, su şırıltısı, hava taşı kabarcıkları, olay sesleri; kamera suya girince boğuklaşır
- `src/game/` — oyun çekirdeği (Game.js) ve görevler
- `src/ui/` — arayüz
