# Görsel hedef ve bakım performansı

Hedef: Akvaryum ve teraryum, kullanıcının gerçek bir canlı yaşam alanını izlediği hissini vermeli. Kullanıcı özellikle oyun görünümünden uzak, mümkün olduğunca fotogerçekçi bir sonuç istiyor. Bu hedef ışık, malzeme, ölçek, canlı hareketleri ve bakım etkileşimleri için birlikte korunmalı.

Bakım sırasında akıcılık öncelikli: yem verme, sifon ve dolum görsel kalite kadar önemlidir. Geometri veya doku eklerken her fare olayında GPU kaynağı oluşturmaktan kaçın. Fizik ve canlı davranışını ekranın kare hızına göre azaltma.

## 9 Ekim 2026

- Bakım imleci kare başına bir kez işleniyor; sifonun hortum tamponları yeniden kullanılıyor.
- Yan cam yansımaları dönüşümlü güncelleniyor; fotoğraf modunda ikisi de her karede güncelleniyor.
- İki habitatta uzun süren kare hızı düşüşlerinde çizim çözünürlüğü kademeli azaltılıyor, yeterli boşluk oluşunca yavaşça geri yükseltiliyor. Kamera konumu ve simülasyon değişmiyor.
- Su değişimi göstergesi her kare yerine saniyede beş kez güncelleniyor.
- Dolum akışı aşağı doğru inceliyor ve bakış açısına bağlı parlıyor. Yem pulları farklı pigment tonları taşıyor. Teraryum kıyısında ıslak bölgelere ince su filmi yansıması eklendi.

Kontrol: `node --test tests/*.test.js`, `npm run build`; tarayıcıda yem verme ve sifon/dolum akışı ile iki habitatın shader hata günlükleri kontrol edildi. Donanıma göre önce/sonra FPS ölçümü henüz yapılmadı; fotogerçekçilik tamamlanmış kabul edilmiyor.

### Canlı hareketleri ve temas

- Balıklar bağıl hızdan yakınlaşmayı öngörerek kesişen rotalarda erken yana açılıyor ve yavaşlıyor. Süzülme sırasında yem ve bitkilerle aynı akıntı alanından sürükleniyorlar.
- Yüzeydeki iz, kuyruk vuruşunun fazına göre sağa-sola kayıyor; çukur ve tepe itmeleri dengeli tutuluyor.
- Kuyruk geçişlerinden kalan sekiz sınırlı su izi bitkileri kısa süre daha etkiliyor; izler zamanla sönüyor. Su üstündeki yapraklar sualtı hareketinden etkilenmiyor.
- Semender dönüşlerinde açısal ivme sınırı, adım kaldırma/indirmede yumuşak dikey başlangıç eklendi. Ayak IK'si salınımda ve uzaktaki görünümde de temas kontrolünü sürdürüyor.
- Son güvenlik geçişi gerçek skinned modelin bütün köşelerini yükseklik alanına karşı kontrol ediyor (parmak, dirsek, karın ve kuyruk dahil). Kemik matrisleri her pozda bir kez hesaplanıyor. Artan zemin yüksekliğine anında düzeltme, azalan yüksekliğe yumuşak geri dönüş uygulanıyor.
- Gerçek GLB iskeleti ve geometrisiyle dört zeminde 240 poz test edildi. Tüm köşeler zemin üzerinde kaldı; bu makinede tam yüzey geçişi yaklaşık 2 ms/poz. Bu, cihaz FPS ölçümü değildir. Çok dik dekor kenarlarında son güvenlik düzeltmesi gövdeyi yukarı kaldırabilir; tüm arazi üzerindeki doğal ayak basışı görsel olarak tamamlanmış kabul edilmemeli. Yükseklik alanı üst yüzey yaklaşımı kullanır; mağara/çıkıntı altındaki fizik ayrı bir konudur.

Kontrol: 10 Node testi, üretim derlemesi, iki habitatta tarayıcı shader/hata günlükleri. Görsel fotogerçekçilik hedefi sürüyor.
