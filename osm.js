/* osm.js — ข้อมูลถนนจาก OpenStreetMap ผ่าน Overpass API (ใช้ฟรี ไม่ต้องมีคีย์)
 *
 * ทำไมต้องมี: กล้องมองเห็นได้ไกลไม่กี่สิบเมตร และตาบอดทันทีเมื่อฝนตกหนัก
 * แต่รูปร่างของถนนกับป้ายจำกัดความเร็วเป็นข้อมูลที่รู้ล่วงหน้าได้ ไม่ขึ้นกับสภาพอากาศ
 * การเตือน "โค้งหักข้างหน้า 250 เมตร" จึงแม่นกว่าและมาก่อนที่กล้องจะเห็นเสมอ
 *
 * มารยาทการใช้: Overpass เป็นบริการอาสาสมัคร จึงจำกัดไว้ที่หนึ่งคำขอต่อ 30 วินาที
 * และเฉพาะเมื่อเคลื่อนที่ไปแล้วเกิน 350 เมตร ผลลัพธ์เก็บลงเครื่องเพื่อใช้ซ้ำ
 * ถ้าเรียกไม่สำเร็จ ระบบยังทำงานครบทุกอย่าง เพียงแต่ไม่มีข้อมูลถนนช่วย
 */

import { haversine, toLocalMeters, circleRadius, clamp } from './util.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const MIN_INTERVAL_MS = 30000;
const MIN_MOVE_M = 350;
const RADIUS_M = 700;
const CACHE_KEY = 'navassist.osm.v1';
const CACHE_TTL_MS = 6 * 3600 * 1000;

const HW = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link)$';

function parseMaxspeed(tag) {
  if (!tag) return null;
  const s = String(tag).trim().toLowerCase();
  if (s === 'none' || s === 'signals' || s === 'walk') return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(km\/h|kph|kmh)?$/);
  if (m) return Math.round(parseFloat(m[1]));
  const mph = s.match(/^(\d+(?:\.\d+)?)\s*mph$/);
  if (mph) return Math.round(parseFloat(mph[1]) * 1.609);
  return null;   // ค่าแบบ "TH:urban" เราไม่เดา เพราะเดาผิดแล้วเตือนผิด
}

function bearing(a, b) {
  const toRad = Math.PI / 180;
  const dLon = (b.lon - a.lon) * toRad;
  const y = Math.sin(dLon) * Math.cos(b.lat * toRad);
  const x = Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export class RoadData {
  constructor() {
    this.ways = [];
    this.center = null;
    this.lastFetch = 0;
    this.inFlight = false;
    this.available = false;
    this.status = 'ยังไม่ได้ดึงข้อมูลถนน';
    this.#loadCache();
  }

  #loadCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (raw && Date.now() - raw.t < CACHE_TTL_MS) {
        this.ways = raw.ways; this.center = raw.center;
        this.available = true;
        this.status = 'ใช้ข้อมูลถนนที่เก็บไว้';
      }
    } catch { }
  }

  #saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        t: Date.now(), center: this.center, ways: this.ways,
      }));
    } catch { /* เต็มหรือปิดอยู่ ไม่เป็นไร */ }
  }

  needsRefresh(lat, lon) {
    if (this.inFlight) return false;
    if (Date.now() - this.lastFetch < MIN_INTERVAL_MS) return false;
    if (!this.center) return true;
    return haversine(lat, lon, this.center.lat, this.center.lon) > MIN_MOVE_M;
  }

  async refresh(lat, lon) {
    if (!this.needsRefresh(lat, lon)) return;
    this.inFlight = true;
    this.lastFetch = Date.now();
    const q = `[out:json][timeout:20];way(around:${RADIUS_M},${lat.toFixed(5)},${lon.toFixed(5)})["highway"~"${HW}"];out geom tags;`;

    for (const url of ENDPOINTS) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(q),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: ctrl.signal,
        });
        clearTimeout(to);
        if (!res.ok) continue;
        const json = await res.json();

        this.ways = (json.elements || [])
          .filter(e => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2)
          .map(e => ({
            id: e.id,
            name: e.tags?.name || null,
            highway: e.tags?.highway,
            maxspeed: parseMaxspeed(e.tags?.maxspeed),
            oneway: e.tags?.oneway === 'yes',
            geom: e.geometry.map(g => ({ lat: g.lat, lon: g.lon })),
          }));

        this.center = { lat, lon };
        this.available = true;
        this.status = `ข้อมูลถนน ${this.ways.length} เส้น`;
        this.#saveCache();
        this.inFlight = false;
        return;
      } catch { /* ลอง endpoint ถัดไป */ }
    }

    this.inFlight = false;
    if (!this.available) this.status = 'ดึงข้อมูลถนนไม่ได้ (ระบบยังทำงานปกติ)';
  }

  /**
   * หาถนนที่รถอยู่ตอนนี้ พร้อมข้อมูลจำกัดความเร็วและโค้งข้างหน้า
   * @returns {{way, maxspeed, distanceM, curve} | null}
   */
  match(lat, lon, headingDeg, speedKmh) {
    if (!this.ways.length) return null;

    let best = null;
    for (const w of this.ways) {
      for (let i = 0; i < w.geom.length - 1; i++) {
        const a = w.geom[i], b = w.geom[i + 1];
        const d = pointToSegmentM(lat, lon, a, b);
        if (d > 28) continue;
        const brg = bearing(a, b);
        let align = 0;
        if (headingDeg != null) {
          const fwd = angleDiff(brg, headingDeg);
          const rev = angleDiff((brg + 180) % 360, headingDeg);
          align = Math.min(fwd, rev);
          if (align > 55) continue;
        }
        const cost = d + align * 0.25;
        if (!best || cost < best.cost) {
          best = { way: w, idx: i, dist: d, cost, forward: headingDeg == null || angleDiff(brg, headingDeg) <= 90 };
        }
      }
    }
    if (!best) return null;

    return {
      way: best.way,
      maxspeed: best.way.maxspeed,
      distanceM: Math.round(best.dist),
      curve: this.#curveAhead(best, lat, lon, speedKmh),
    };
  }

  /** โค้งที่แหลมที่สุดในระยะที่จะถึงภายในไม่กี่วินาทีข้างหน้า */
  #curveAhead(m, lat, lon, speedKmh) {
    const geom = m.way.geom;
    const lookaheadM = clamp((speedKmh / 3.6) * 6, 80, 400);
    const order = m.forward
      ? Array.from({ length: geom.length - m.idx }, (_, k) => m.idx + k)
      : Array.from({ length: m.idx + 2 }, (_, k) => m.idx + 1 - k).filter(i => i >= 0);

    const pts = order.map(i => ({ ...toLocalMeters(geom[i].lat, geom[i].lon, lat, lon), ll: geom[i] }));
    let acc = 0, minR = Infinity, atM = null;
    for (let i = 1; i < pts.length - 1; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc > lookaheadM) break;
      if (acc < 15) continue;
      const R = circleRadius(pts[i - 1], pts[i], pts[i + 1]);
      if (R < minR) { minR = R; atM = Math.round(acc); }
    }
    if (!Number.isFinite(minR) || minR > 900) return null;

    // ความเร็วที่ยังสบายในโค้งรัศมี R โดยใช้แรงเข้าศูนย์กลางประมาณ 0.25 g
    const safeKmh = Math.round(Math.sqrt(0.25 * 9.81 * minR) * 3.6);
    return { radiusM: Math.round(minR), distanceM: atM, safeKmh };
  }
}

function pointToSegmentM(lat, lon, a, b) {
  const p = toLocalMeters(lat, lon, a.lat, a.lon);
  const q = toLocalMeters(b.lat, b.lon, a.lat, a.lon);
  const len2 = q.x * q.x + q.y * q.y;
  if (len2 < 1e-6) return Math.hypot(p.x, p.y);
  const t = clamp((p.x * q.x + p.y * q.y) / len2, 0, 1);
  return Math.hypot(p.x - q.x * t, p.y - q.y * t);
}

/* ---------- ตรรกะการเตือนความเร็วและโค้ง ---------- */

const SPEED = { tolerance: 1.08, minOver: 5, sustainMs: 4000, cooldownMs: 25000 };
const CURVE = { factor: 1.15, cooldownMs: 20000 };

const spState = { since: 0, last: 0 };
const cvState = { last: 0, lastRadius: 0 };

export function assessSpeed(match, speedKmh, now) {
  if (!match?.maxspeed || speedKmh < 25) { spState.since = 0; return null; }
  const limit = match.maxspeed;
  const over = speedKmh - limit;
  if (speedKmh <= limit * SPEED.tolerance || over < SPEED.minOver) { spState.since = 0; return null; }
  if (!spState.since) { spState.since = now; return null; }
  if (now - spState.since < SPEED.sustainMs) return null;
  if (now - spState.last < SPEED.cooldownMs) return null;
  spState.last = now;
  return { limit, over: Math.round(over) };
}

export function assessCurve(match, speedKmh, now) {
  const c = match?.curve;
  if (!c || speedKmh < 40) return null;
  if (speedKmh <= c.safeKmh * CURVE.factor) return null;
  if (now - cvState.last < CURVE.cooldownMs && Math.abs(c.radiusM - cvState.lastRadius) < 40) return null;
  cvState.last = now;
  cvState.lastRadius = c.radiusM;
  return c;
}
