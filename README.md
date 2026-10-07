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
- **Hava / Işık**: hava taşı ve lamba (lamba 08:00–21:00 otomatik)
- **1× / 4× / 16×**: zaman hızı (1 sn = 1 oyun dakikası)
- **Ses**: aç/kapa (tercih hatırlanır)
- **Fotoğraf**: arayüzü gizler, alan derinliği açar; Boşluk veya deklanşör ile PNG indirir, Esc ile çıkar

İlerleme tarayıcıda otomatik kaydedilir; geri döndüğünde geçen süre (en fazla 12 oyun saati) simüle edilir.
Kaydı sıfırlamak için tarayıcı konsolunda `vivarium.reset()`. Su yüzeyi yansıması zayıf makinelerde adrese `?norefl` eklenerek kapatılabilir.

## Dokular

`public/textures/` içindeki kum, taş, kök, zemin, dolap ve duvar dokuları ile `hotel_room_1k.hdr` ortam ışığı [Poly Haven](https://polyhaven.com)'dan alınmıştır (CC0, kamu malı). Anubias modeli Poly Haven'ın `anthurium_botany_01` modelinden, vallisneria yaprak dokusu `grass_bermuda_01`'den gelir (`public/models/plants/`, CC0). UV'si olmayan taş ve çakıllarda üç eksenli (triplanar) yansıtma kullanılır.

## Yapı

- `src/render/` — sahne, cam, su (emilim, kostik, yüzey, ışık huzmeleri), partiküller, post-processing
- `src/world/` — kum, taşlar, kök, ekipman, bitkiler
- `src/creatures/` — prosedürel balık geometrisi, yüzme shader'ı, davranış (Fish, Shrimp), tür verileri
- `src/sim/ecosystem.js` — atık → filtre → nitrat, yosun, oksijen, sağlık/açlık/stres, gelir
- `src/audio/Sound.js` — Web Audio ile sentezlenen sesler (dosya yok): filtre uğultusu, su şırıltısı, hava taşı kabarcıkları, olay sesleri; kamera suya girince boğuklaşır
- `src/game/` — oyun çekirdeği (Game.js) ve görevler
- `src/ui/` — arayüz
