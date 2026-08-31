/* ============================================================================
 * lane-color.js — ตรวจจับ "สีเส้นจราจร" บนถนนจากกล้องมือถือ
 * ทำงานในเบราว์เซอร์ล้วน ไม่ใช้ API เสียเงิน ไม่ส่งภาพออกนอกเครื่อง
 *
 * ใช้งาน:
 *   const lane = LaneColor.create(videoElement);
 *   const r = lane.update();      // เรียกทุกเฟรม (ราคาถูกมาก ~1500 พิกเซล/เฟรม)
 *   lane.drawOverlay(ctx);        // ไม่บังคับ — วาดจุดที่ตรวจเจอทับภาพ
 *
 * สิ่งที่คืนกลับมา (r):
 *   r.ok            มีข้อมูลพอจะสรุปไหม
 *   r.confidence    0..1
 *   r.left / r.right  { color, pattern, coverage }
 *                     color   = 'white' | 'yellow' | 'red' | null
 *                     pattern = 'solid' | 'dashed' | null
 *   r.doubleYellow  เจอเส้นเหลืองคู่ไหม
 *   r.offset        ตำแหน่งรถในเลน  -1=ชิดซ้ายสุด 0=กลาง +1=ชิดขวาสุด
 *   r.curve         'left' | 'right' | 'straight' | null
 *   r.rules         ข้อความกฎจราจรภาษาไทย (array)
 *   r.warning       ข้อความเตือนออกนอกเลน หรือ null
 * ========================================================================= */
(function (global) {
  'use strict';

  const CFG = {
    roiTop: 0.55,        // เก็บภาพเฉพาะส่วนล่างของเฟรม (ตัดท้องฟ้า/รถ/ป้ายออก)
    W: 160, H: 90,       // ความละเอียดที่ใช้วิเคราะห์ (ย่อลงเพื่อความเร็ว)
    scanRows: 10,        // จำนวนเส้นสแกนแนวนอน
    baselineWin: 31,     // หน้าต่างหาค่าเฉลี่ยผิวถนน
    minContrast: 9,      // เส้นต้องสว่างกว่าถนนรอบข้างอย่างน้อยเท่านี้
    minRunPx: 1,         // ความกว้างแถบต่ำสุด
    ema: 0.25,           // ค่าถ่วงเวลา (กันค่ากระพริบ)
    departThreshold: 0.42, // เกินเท่านี้ถือว่าเริ่มออกนอกเลน
    minRowsPerSide: 3,   // ต้องเจอเส้นอย่างน้อยกี่แถวจึงจะฟิตเส้นตรง
  };

  // ---- แปลง RGB เป็นชื่อสีเส้นจราจร ------------------------------------
  // ใช้ HSV เพราะ hue ทนต่อความสว่างที่เปลี่ยนไปได้ดีกว่า RGB มาก
  function classifyColor(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const v = max / 255;
    const s = max === 0 ? 0 : d / max;
    if (v < 0.18) return null;                    // มืดเกินไป ไม่สรุป
    if (s < 0.20) return 'white';                 // ไร้สี = เส้นขาว
    let h = 0;
    if (d > 0) {
      if (max === r) h = 60 * ((((g - b) / d) % 6 + 6) % 6);
      else if (max === g) h = 60 * (((b - r) / d) + 2);
      else h = 60 * (((r - g) / d) + 4);
    }
    if (h >= 33 && h <= 78 && s >= 0.24) return 'yellow';
    if ((h <= 16 || h >= 338) && s >= 0.32) return 'red';
    return null;                                  // สีอื่น = ไม่ใช่เส้นจราจร
  }

  // ---- ค่าเฉลี่ยเฉพาะถิ่นของแต่ละแถว (ประมาณ "ระดับผิวถนน") ----------
  function localBaseline(lum, win) {
    const n = lum.length, out = new Float32Array(n), pre = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + lum[i];
    const h = win >> 1;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - h), b = Math.min(n, i + h + 1);
      out[i] = (pre[b] - pre[a]) / (b - a);
    }
    return out;
  }

  function fitLine(pts) {
    // least squares:  x = a*y + b   (y คือแกนดิ่งของภาพ)
    const n = pts.length;
    if (n < 2) return null;
    let sy = 0, sx = 0, syy = 0, sxy = 0;
    for (const p of pts) { sy += p.y; sx += p.x; syy += p.y * p.y; sxy += p.x * p.y; }
    const den = n * syy - sy * sy;
    if (Math.abs(den) < 1e-6) return null;
    const a = (n * sxy - sy * sx) / den;
    const b = (sx - a * sy) / n;
    // R² ใช้เป็นตัววัดว่าจุดเรียงเป็นเส้นตรงจริงแค่ไหน
    const mx = sx / n;
    let ssTot = 0, ssRes = 0;
    for (const p of pts) {
      const pred = a * p.y + b;
      ssRes += (p.x - pred) ** 2;
      ssTot += (p.x - mx) ** 2;
    }
    const r2 = ssTot < 1e-6 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    return { a, b, r2, n };
  }

  function create(video, userCfg) {
    const cfg = Object.assign({}, CFG, userCfg || {});
    const cv = document.createElement('canvas');
    cv.width = cfg.W; cv.height = cfg.H;
    const cx = cv.getContext('2d', { willReadFrequently: true });

    // แถวสแกน: ถี่ที่ด้านล่าง (ใกล้รถ = ข้อมูลน่าเชื่อถือกว่า)
    const rows = [];
    for (let i = 0; i < cfg.scanRows; i++) {
      const t = i / (cfg.scanRows - 1);
      rows.push(Math.round((0.30 + 0.68 * t * t) * (cfg.H - 1)));
    }

    // สถานะที่ต้องจำข้ามเฟรม
    const st = {
      cov: { left: 0, right: 0 },
      colorVote: { left: {}, right: {} },
      offset: 0, curveSig: 0, conf: 0, doubleY: 0,
      lastHits: [], egoCenter: cfg.W / 2,
    };

    const mix = (old, now) => old + (now - old) * cfg.ema;

    function update() {
      if (!video.videoWidth || video.readyState < 2) return { ok: false, confidence: 0, rules: [] };

      const sy = Math.floor(video.videoHeight * cfg.roiTop);
      cx.drawImage(video, 0, sy, video.videoWidth, video.videoHeight - sy, 0, 0, cfg.W, cfg.H);
      const data = cx.getImageData(0, 0, cfg.W, cfg.H).data;

      const hits = [];
      const lum = new Float32Array(cfg.W);

      for (const y of rows) {
        const base = y * cfg.W * 4;
        for (let x = 0; x < cfg.W; x++) {
          const i = base + x * 4;
          lum[x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        }
        const bl = localBaseline(lum, cfg.baselineWin);

        // เส้นยิ่งอยู่ไกล (แถวบน) ยิ่งแคบ — เพดานความกว้างจึงแปรตามแถว
        const maxRun = Math.max(3, Math.round(2 + 11 * (y / cfg.H)));

        let run = null;
        for (let x = 0; x <= cfg.W; x++) {
          const isLine = x < cfg.W && (lum[x] - bl[x]) > cfg.minContrast;
          if (isLine) {
            if (!run) run = { x0: x, x1: x };
            else run.x1 = x;
            continue;
          }
          if (!run) continue;
          const w = run.x1 - run.x0 + 1;
          if (w >= cfg.minRunPx && w <= maxRun) {
            let r = 0, g = 0, b = 0, n = 0;
            for (let px = run.x0; px <= run.x1; px++) {
              const i = base + px * 4;
              r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
            }
            const color = classifyColor(r / n, g / n, b / n);
            if (color) hits.push({ x: (run.x0 + run.x1) / 2, y, w, color });
          }
          run = null;
        }
      }
      st.lastHits = hits;

      // ---- แยกซ้าย/ขวา แล้วฟิตเส้น -----------------------------------
      const L = hits.filter(h => h.x < st.egoCenter);
      const R = hits.filter(h => h.x >= st.egoCenter);
      const fL = fitLine(L), fR = fitLine(R);

      const rowsL = new Set(L.map(h => h.y)).size;
      const rowsR = new Set(R.map(h => h.y)).size;
      st.cov.left = mix(st.cov.left, rowsL / rows.length);
      st.cov.right = mix(st.cov.right, rowsR / rows.length);

      // ---- โหวตสีแบบถ่วงเวลา -----------------------------------------
      for (const side of ['left', 'right']) {
        const src = side === 'left' ? L : R, votes = st.colorVote[side];
        for (const k of ['white', 'yellow', 'red']) {
          const now = src.filter(h => h.color === k).length / Math.max(1, rows.length);
          votes[k] = mix(votes[k] || 0, now);
        }
      }
      const pickColor = side => {
        const v = st.colorVote[side];
        let best = null, bv = 0.12;                // ต่ำกว่านี้ถือว่าไม่พอสรุป
        for (const k of ['white', 'yellow', 'red']) if ((v[k] || 0) > bv) { bv = v[k]; best = k; }
        return best;
      };

      // ---- เส้นเหลืองคู่: สองแถบเหลืองขนานกันในแถวเดียว --------------
      let dyNow = 0;
      for (const y of rows) {
        const ys = hits.filter(h => h.y === y && h.color === 'yellow').sort((a, b) => a.x - b.x);
        for (let i = 1; i < ys.length; i++) {
          const gap = ys[i].x - ys[i - 1].x;
          if (gap > 1.5 && gap < cfg.W * 0.075) { dyNow = 1; break; }
        }
        if (dyNow) break;
      }
      st.doubleY = mix(st.doubleY, dyNow);

      // ---- ตำแหน่งในเลน + ความโค้ง -----------------------------------
      let offsetNow = st.offset, curveNow = st.curveSig, laneOk = false;
      if (fL && fR && rowsL >= cfg.minRowsPerSide && rowsR >= cfg.minRowsPerSide) {
        const yb = cfg.H - 1, yt = rows[0];
        const xLb = fL.a * yb + fL.b, xRb = fR.a * yb + fR.b;
        const width = xRb - xLb;
        if (width > cfg.W * 0.18) {
          laneOk = true;
          offsetNow = (st.egoCenter - (xLb + xRb) / 2) / (width / 2);
          const topC = ((fL.a * yt + fL.b) + (fR.a * yt + fR.b)) / 2;
          curveNow = (topC - (xLb + xRb) / 2) / cfg.W;   // บวก=โค้งขวา
        }
      }
      st.offset = mix(st.offset, Math.max(-1.6, Math.min(1.6, offsetNow)));
      st.curveSig = mix(st.curveSig, curveNow);

      // ---- ความเชื่อมั่นรวม ------------------------------------------
      const fitQ = ((fL?.r2 || 0) + (fR?.r2 || 0)) / 2;
      const covQ = Math.min(1, (st.cov.left + st.cov.right) / 1.2);
      const confNow = laneOk ? 0.55 * fitQ + 0.45 * covQ : 0.35 * covQ;
      st.conf = mix(st.conf, confNow);

      const patternOf = c => c < 0.20 ? null : c > 0.80 ? 'solid' : 'dashed';
      const left = { color: pickColor('left'), pattern: patternOf(st.cov.left), coverage: +st.cov.left.toFixed(2) };
      const right = { color: pickColor('right'), pattern: patternOf(st.cov.right), coverage: +st.cov.right.toFixed(2) };
      const doubleYellow = st.doubleY > 0.45;
      const ok = st.conf >= 0.35;

      // ---- แปลงเป็นกฎจราจรไทย ----------------------------------------
      const rules = [];
      if (ok) {
        const describe = (s, label) => {
          if (!s.color || !s.pattern) return;
          if (s.color === 'yellow' && s.pattern === 'solid')
            rules.push(`เส้นเหลืองทึบ${label} — ห้ามแซงล้ำเส้น`);
          else if (s.color === 'yellow')
            rules.push(`เส้นเหลืองประ${label} — แซงได้เมื่อปลอดภัย`);
          else if (s.color === 'white' && s.pattern === 'solid')
            rules.push(`เส้นขาวทึบ${label} — ไม่ควรเปลี่ยนเลน`);
          else if (s.color === 'white')
            rules.push(`เส้นขาวประ${label} — เปลี่ยนเลนได้`);
          else if (s.color === 'red')
            rules.push(`ขอบทางขาว-แดง${label} — ห้ามจอด`);
        };
        if (doubleYellow) rules.push('เส้นเหลืองคู่ — ห้ามแซงทั้งสองทาง');
        else describe(left, 'ทางซ้าย');
        describe(right, 'ทางขวา');
      }

      let warning = null;
      if (ok && Math.abs(st.offset) > cfg.departThreshold)
        warning = st.offset > 0 ? 'รถค่อนไปทางขวาของเลน' : 'รถค่อนไปทางซ้ายของเลน';

      const curve = !ok ? null
        : st.curveSig < -0.035 ? 'left'
        : st.curveSig > 0.035 ? 'right' : 'straight';

      return {
        ok, confidence: +st.conf.toFixed(2),
        left, right, doubleYellow,
        offset: +st.offset.toFixed(2), curve,
        rules, warning,
        hitCount: hits.length,
      };
    }

    // วาดจุดที่ตรวจเจอทับ canvas overlay (ขนาดเท่าวิดีโอ)
    function drawOverlay(ctx) {
      if (!video.videoWidth) return;
      const sy = video.videoHeight * cfg.roiTop;
      const sx = video.videoWidth / cfg.W, syy = (video.videoHeight - sy) / cfg.H;
      const paint = { white: '#ffffff', yellow: '#ffd43b', red: '#ff5c5c' };
      for (const h of st.lastHits) {
        ctx.fillStyle = paint[h.color] || '#888';
        ctx.beginPath();
        ctx.arc(h.x * sx, sy + h.y * syy, Math.max(3, video.videoWidth / 220), 0, 6.2832);
        ctx.fill();
      }
    }

    // ปรับแนวกลางรถ ถ้ากล้องไม่ได้ติดตรงกลางกระจก (-1..1)
    function calibrateCenter(rel) {
      st.egoCenter = cfg.W / 2 * (1 + Math.max(-0.6, Math.min(0.6, rel)));
    }

    return { update, drawOverlay, calibrateCenter, cfg };
  }

  global.LaneColor = { create, classifyColor };
})(window);
