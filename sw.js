/* sw.js — ทำให้แอปเปิดได้แม้ไม่มีสัญญาณ
 *
 * รุ่นก่อนหน้าแคชแค่ไฟล์ของแอป ส่วนไลบรารี AI ปล่อยให้ HTTP cache จัดการ
 * ซึ่งถูกล้างเมื่อไหร่ก็ได้ ผลคือขับเข้าที่ไม่มีสัญญาณแล้วแอปเปิดไม่ขึ้น
 * ตอนที่ต้องการมันที่สุด ที่นี่จึงแคชไลบรารีจาก CDN ไว้ด้วย
 * ส่วนน้ำหนักโมเดลถูกเก็บแยกใน IndexedDB โดย detector.js
 */

const CACHE = 'navassist-v1';

const SHELL = [
  './', './index.html', './style.css', './manifest.json',
  './js/main.js', './js/ui.js', './js/camera.js', './js/detector.js',
  './js/tracker.js', './js/lane.js', './js/vision.js', './js/alerts.js',
  './js/geo.js', './js/osm.js', './js/store.js', './js/health.js', './js/calibrate.js', './js/util.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

const CDN = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // CDN อาจล้มเหลวได้ ไม่ให้ทำให้การติดตั้งทั้งหมดพัง
    await Promise.allSettled(CDN.map(u => c.add(new Request(u, { mode: 'cors' }))));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ข้อมูลถนนต้องสดเสมอ ไม่แคช
  if (url.hostname.includes('overpass')) return;

  const isShell = url.origin === self.location.origin;
  const isCdn = CDN.some(u => req.url.startsWith(u.split('@')[0]));
  if (!isShell && !isCdn) return;

  if (isCdn) {
    // ไลบรารีตรึงเวอร์ชันไว้แล้ว จึงใช้ของในแคชก่อนเพื่อความเร็วและความแน่นอน
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    })));
    return;
  }

  // ไฟล์แอป: เอาของใหม่ก่อน เพื่อให้การแก้ไขถึงผู้ใช้เร็ว แล้วค่อยตกไปที่แคช
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
