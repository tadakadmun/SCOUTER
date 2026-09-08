/* free-only.test.mjs — ยามเฝ้าประตู
 *
 * ข้อกำหนดของโปรเจกต์นี้คือ "ต้องใช้งานได้ฟรี ห้ามเสียเงิน"
 * ซึ่งเป็นข้อกำหนดที่พังง่ายมากเวลาแก้โค้ดในอนาคต แค่เผลอเพิ่มบริการเดียว
 * ไฟล์นี้จึงตรวจซอร์สทั้งหมดว่า
 *   1. ไม่มีปลายทางภายนอกอื่นนอกจากรายการที่อนุญาต ซึ่งฟรีทั้งหมด
 *   2. ไม่มีคีย์ โทเคน หรือร่องรอยของบริการที่คิดเงิน
 *   3. ยังปิดการใช้อินเทอร์เน็ตได้ทั้งหมดโดยระบบหลักยังทำงาน
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ทุกอย่างในรายการนี้ใช้ฟรี ไม่ต้องมีบัญชี ไม่ต้องมีคีย์
const ALLOWED_HOSTS = {
  'cdn.jsdelivr.net': 'CDN สาธารณะ ใช้ฟรี — ใช้โหลด TensorFlow.js (Apache 2.0)',
  'overpass-api.de': 'Overpass API ของอาสาสมัคร ใช้ฟรี ไม่ต้องมีคีย์',
  'overpass.kumi.systems': 'เซิร์ฟเวอร์ Overpass สำรอง ใช้ฟรี',
};

// คำที่บ่งชี้ว่ามีบริการคิดเงินหรือระบบยืนยันตัวตนหลุดเข้ามา
const FORBIDDEN = [
  /api[_-]?key/i, /\bapikey\b/i, /access[_-]?token/i, /client[_-]?secret/i,
  /authorization:\s*bearer/i, /mapbox/i, /googleapis\.com/i, /maps\.google/i,
  /\bstripe\b/i, /\bpaypal\b/i, /subscription/i, /\bbilling\b/i,
  /openai\.com/i, /\bazure\b/i, /amazonaws\.com/i, /\bpaywall\b/i,
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'icons']);
// package-lock.json มีลิงก์ของ registry npm ซึ่งเป็นเรื่องของเครื่องมือพัฒนา
// ไม่ใช่สิ่งที่ผู้ใช้ปลายทางต้องต่อไปหา จึงไม่นับ
const SKIP_FILES = new Set(['package-lock.json']);
const EXTS = ['.js', '.mjs', '.html', '.json', '.css'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (EXTS.some(e => name.endsWith(e)) && !SKIP_FILES.has(name)) {
      out.push(p);
    }
  }
  return out;
}

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n         ' + detail : ''}`); }
};

const files = walk(ROOT).filter(f => !f.endsWith('free-only.test.mjs'));
console.log(`\nตรวจไฟล์ ${files.length} ไฟล์\n`);

console.log('[1] ปลายทางภายนอก');
{
  const found = new Map();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      // example.com เป็นที่อยู่สมมติตามมาตรฐาน RFC 2606 ใช้ในชุดทดสอบเท่านั้น
      if (host === 'localhost' || host === 'example.com' || host.endsWith('.example.com')) continue;
      if (!found.has(host)) found.set(host, []);
      if (!found.get(host).includes(f)) found.get(host).push(f);
    }
  }
  for (const [host, where] of found) {
    check(`${host} — ${ALLOWED_HOSTS[host] || 'ไม่อยู่ในรายการที่อนุญาต'}`,
      host in ALLOWED_HOSTS, `พบใน: ${where.map(w => w.replace(ROOT + '/', '')).join(', ')}`);
  }
  check('ไม่มีปลายทางที่ไม่ได้อนุญาต', [...found.keys()].every(h => h in ALLOWED_HOSTS));
}

console.log('\n[2] คีย์ โทเคน และบริการที่คิดเงิน');
{
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const re of FORBIDDEN) {
      const m = text.match(re);
      if (m) hits.push(`${f.replace(ROOT + '/', '')}: ${m[0]}`);
    }
  }
  check('ไม่พบคีย์หรือร่องรอยบริการที่คิดเงิน', hits.length === 0, hits.join('\n         '));
}

console.log('\n[3] ยังทำงานได้เมื่อไม่มีอินเทอร์เน็ต');
{
  const osm = readFileSync(join(ROOT, 'js/osm.js'), 'utf8');
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const det = readFileSync(join(ROOT, 'js/detector.js'), 'utf8');

  check('ปิดการใช้ข้อมูลถนนได้', /settings\s*=\s*\{\s*enabled/.test(osm));
  check('มีเพดานปริมาณข้อมูล', /budgetExceeded/.test(osm) && /budgetMB/.test(osm));
  check('เคารพสถานะออฟไลน์', /navigator\.onLine/.test(osm));
  check('จำกัดความถี่การเรียก Overpass', /MIN_INTERVAL_MS\s*=\s*30000/.test(osm));
  check('เก็บข้อมูลถนนไว้ใช้ซ้ำ', /TILE_TTL_MS/.test(osm) && /store\.set/.test(osm));
  check('โมเดล AI ถูกเก็บลงเครื่อง', /indexeddb:\/\//.test(det));
  check('Service Worker แคชไลบรารีจาก CDN', /const CDN\s*=/.test(sw));
  check('ไม่แคชคำขอข้อมูลถนน (ต้องสดเสมอ)', /overpass/.test(sw) && /return;/.test(sw));
}

console.log('\n[4] ใบอนุญาตของสิ่งที่พึ่งพา');
{
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  check('README ระบุใบอนุญาตของ TensorFlow.js', /Apache 2\.0/.test(readme));
  check('README ให้เครดิต OpenStreetMap ตาม ODbL', /ODbL/.test(readme) && /OpenStreetMap/.test(readme));
}

console.log('\n[5] ตัวตรวจการเปิดใช้งานต้องไม่ทิ้งข้อผิดพลาดแบบไม่มีรายละเอียด');
{
  const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
  check('ไม่ทิ้ง "Script error." โดยไม่ทำอะไรต่อ (ต้องตั้ง sawScriptFailure ไว้เสมอ)',
    /sawScriptFailure\s*=\s*true;/.test(idx));
  check('มีการถามเซิร์ฟเวอร์จริงว่า js/main.js ตอบกลับสถานะและชนิดไฟล์อะไร',
    /probeServer/.test(idx) && /contentType/.test(idx));
  check('ตรวจจับกรณี Content-Type ผิด (ปัญหา SPA fallback) โดยเฉพาะ',
    /contentType\.indexOf\('javascript'\)/.test(idx));
}

console.log('\n[6] ไฟล์ที่ GitHub Pages ต้องมีเพื่อไม่ให้ Jekyll แทรกแซง');
{
  check('มีไฟล์ .nojekyll อยู่ที่รากโปรเจกต์', existsSync(join(ROOT, '.nojekyll')));
}

console.log(`\nสรุป: ผ่าน ${pass} ข้อ, ไม่ผ่าน ${fail} ข้อ\n`);
process.exit(fail ? 1 : 0);

