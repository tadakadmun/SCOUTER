/* SCOUTER V2 — FREE
 * ทั้งหมดทำงานในเบราว์เซอร์ (TensorFlow.js + COCO-SSD) ไม่มี API แบบคิดเงิน
 * POWER / ระยะ / ROAD / VISION เป็น "ค่าประเมินจากภาพ" เพื่อการทดลองและความบันเทิงเท่านั้น
 * ไม่ใช่การวัดพลังจริง ไม่ใช่ระยะจริง และไม่ใช่ระบบขับรถอัตโนมัติ
 */
const $ = id => document.getElementById(id);

// ---- DOM refs ----
const video = $("video"), overlay = $("overlay"), octx = overlay.getContext("2d");
// offscreen canvas used ONLY for pixel sampling (color / brightness) so it never
// fights with the visible overlay canvas that draws the bounding boxes.
const sample = document.createElement("canvas");
const sctx = sample.getContext("2d", { willReadFrequently: true });

const statusText = $("statusText"), message = $("message");
const startBtn = $("startBtn"), scanBtn = $("scanBtn"), lockBtn = $("lockBtn"),
      voiceBtn = $("voiceBtn"), voiceBtnNav = $("voiceBtnNav"),
      rainBtn = $("rainBtn"), gpsBtn = $("gpsBtn"), flipBtn = $("flipBtn");
const targetInfo = $("targetInfo"), targetType = $("targetType"), lockState = $("lockState"),
      powerEl = $("power"), distanceEl = $("distance"), confEl = $("conf"), directionEl = $("direction");
const targetsEl = $("targets"), powerMainEl = $("powerMain"), distMainEl = $("distMain");
const targetListEl = $("targetList");
const navText = $("navText"), riskText = $("riskText"), gpsText = $("gpsText"), headingText = $("headingText");
const visionBar = $("visionBar"), visionScore = $("visionScore"),
      roadBar = $("roadBar"), roadScore = $("roadScore"), rainWarning = $("rainWarning");
const roadGuide = $("roadGuide"), guideArrow = $("guideArrow"), guideState = $("guideState"), guideText = $("guideText");
const visionScoreBig = $("visionScoreBig"), roadScoreBig = $("roadScoreBig"), riskTextBig = $("riskTextBig");

// two separate screens on purpose — SCOUTER needs tapping, NAV ASSIST is glance-only
const tabScouterBtn = $("tabScouterBtn"), tabNavBtn = $("tabNavBtn");
const scouterPanel = $("scouterPanel"), navPanel = $("navPanel");
let mode = "scouter"; // "scouter" | "nav"

// ---- state ----
let model = null, stream = null, running = false, loadingModel = false;
let facing = "environment";
let voiceOn = true, rainMode = false;
let frameBusy = false, lastInference = 0;
const INFER_MS = 260;      // throttle inference
const HOLD_MS = 1800;      // keep a lost target on screen briefly
const MAX_TARGETS = 8;

let sticky = new Map();    // key -> tracked target
let lockedKey = null;      // currently locked target key, or null = auto (highest score)
let scanCursor = -1;       // for cycling with SCAN button

let gps = null, heading = null, gpsWatchId = null, orientationEnabled = false;
let lastSpoken = "", lastSpokenAt = 0;
let lastRiskLevel = "";

const OBJECT_COLORS = ["#00e5ff","#ff4fd8","#ffd43b","#ff7043","#7cfc00","#b388ff","#00ffa3","#ff5c8a","#4dabf7","#f59f00"];

// coco-ssd label -> Thai name. NOTE: coco-ssd labels use spaces, not underscores.
const NAMES = {
  person:"คน", bicycle:"จักรยาน", car:"รถยนต์", motorcycle:"รถจักรยานยนต์", airplane:"เครื่องบิน",
  bus:"รถโดยสาร", train:"รถไฟ", truck:"รถบรรทุก", boat:"เรือ", "traffic light":"สัญญาณไฟจราจร",
  "fire hydrant":"หัวดับเพลิง", "stop sign":"ป้ายหยุด", "parking meter":"มิเตอร์จอดรถ", bench:"ม้านั่ง",
  bird:"นก", cat:"แมว", dog:"สุนัข", horse:"ม้า", sheep:"แกะ", cow:"วัว", elephant:"ช้าง", bear:"หมี",
  zebra:"ม้าลาย", giraffe:"ยีราฟ", backpack:"กระเป๋าเป้", umbrella:"ร่ม", handbag:"กระเป๋าถือ",
  tie:"เนกไท", suitcase:"กระเป๋าเดินทาง", frisbee:"จานร่อน", skis:"สกี", snowboard:"สโนว์บอร์ด",
  "sports ball":"ลูกบอล", kite:"ว่าว", "baseball bat":"ไม้เบสบอล", "baseball glove":"ถุงมือเบสบอล",
  skateboard:"สเก็ตบอร์ด", surfboard:"กระดานโต้คลื่น", "tennis racket":"ไม้เทนนิส",
  bottle:"ขวด", "wine glass":"แก้วไวน์", cup:"ถ้วย", fork:"ส้อม", knife:"มีด", spoon:"ช้อน", bowl:"ชาม",
  banana:"กล้วย", apple:"แอปเปิล", sandwich:"แซนด์วิช", orange:"ส้ม", broccoli:"บรอกโคลี", carrot:"แครอต",
  "hot dog":"ฮอตดอก", pizza:"พิซซ่า", donut:"โดนัท", cake:"เค้ก",
  chair:"เก้าอี้", couch:"โซฟา", "potted plant":"ต้นไม้กระถาง", bed:"เตียง", "dining table":"โต๊ะอาหาร",
  toilet:"สุขภัณฑ์", tv:"ทีวี", laptop:"แล็ปท็อป", mouse:"เมาส์", remote:"รีโมต", keyboard:"คีย์บอร์ด",
  "cell phone":"โทรศัพท์", microwave:"ไมโครเวฟ", oven:"เตาอบ", toaster:"เครื่องปิ้งขนมปัง", sink:"อ่างล้างจาน",
  refrigerator:"ตู้เย็น", book:"หนังสือ", clock:"นาฬิกา", vase:"แจกัน", scissors:"กรรไกร",
  "teddy bear":"ตุ๊กตาหมี", "hair drier":"ไดร์เป่าผม", toothbrush:"แปรงสีฟัน"
};
const roadClasses = new Set(["car","truck","bus","motorcycle","bicycle"]);
// rough "class weight" used only for the fun POWER score simulation
const POWER_WEIGHT = { person:1, car:2.6, truck:3.4, bus:3.2, motorcycle:1.8, bicycle:1.2,
  airplane:4.5, train:4, boat:2.2, dog:1.1, cat:0.8, elephant:3, bear:2.4, horse:1.6 };

function nameOf(cls){ return NAMES[cls] || cls; }
function setStatus(t){ statusText.textContent = t; }
function say(msg){ message.textContent = msg; }

// ---------- model / camera ----------
async function loadModel(){
  if (model) return model;
  if (loadingModel) return null;
  loadingModel = true; setStatus("LOADING AI…"); say("กำลังโหลดโมเดล AI (ครั้งแรกต้องใช้อินเทอร์เน็ต)…");
  if (!window.tf || !window.cocoSsd) {
    loadingModel = false;
    throw new Error("โหลดไลบรารี AI ไม่สำเร็จ กรุณาต่ออินเทอร์เน็ตแล้วรีโหลดหน้านี้");
  }
  await tf.ready();
  model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  loadingModel = false;
  return model;
}

function fail(msg){
  setStatus("ERROR");
  say(`⚠️ ${msg}`);
  startBtn.textContent = "📷 ลองอีกครั้ง";
}

async function openScouter(){
  if (running) return;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("เบราว์เซอร์นี้ไม่รองรับกล้อง หรือหน้าเว็บไม่ได้เปิดผ่าน HTTPS/localhost");
    setStatus("REQUEST CAMERA…"); say("กำลังขอสิทธิ์กล้อง…");
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = stream;
      await new Promise(r => video.onloadedmetadata = r);
      await video.play();
    }
    await loadModel();
    startGPS();
    enableOrientation(); // must be called from a user gesture for iOS
    running = true;
    startBtn.textContent = "■ STOP SCOUTER";
    startBtn.classList.remove("primary");
    [scanBtn, lockBtn, voiceBtn, voiceBtnNav, rainBtn, gpsBtn].forEach(b => b.disabled = false);
    setStatus("LIVE AI"); say("");
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    loadingModel = false;
    fail(e.message || "เปิดระบบไม่สำเร็จ");
  }
}

function stopScouter(){
  running = false;
  startBtn.textContent = "🔴 START SCOUTER";
  startBtn.classList.add("primary");
  setStatus(stream ? "CAMERA READY" : "READY");
  say("ระบบหยุดทำงาน — กด START SCOUTER เพื่อเริ่มใหม่");
  targetInfo.classList.add("hidden");
}

async function flipCamera(){
  facing = facing === "environment" ? "user" : "environment";
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  const wasRunning = running;
  running = false;
  if (wasRunning) await openScouter();
}

// ---------- pixel sampling helpers (use offscreen `sample` canvas) ----------
function colorOf(x, y, w, h){
  if (!video.videoWidth || !video.videoHeight) return "ไม่ทราบ";
  const sx = Math.max(0, Math.floor(x)), sy = Math.max(0, Math.floor(y));
  const sw = Math.max(1, Math.min(Math.floor(w), video.videoWidth - sx));
  const sh = Math.max(1, Math.min(Math.floor(h), video.videoHeight - sy));
  const cw = Math.min(24, sw), ch = Math.min(24, sh);
  sample.width = cw; sample.height = ch;
  sctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
  const d = sctx.getImageData(0, 0, cw, ch).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
  r /= n; g /= n; b /= n;
  if (Math.max(r,g,b) < 45) return "ดำ/มืด";
  if (Math.max(r,g,b) - Math.min(r,g,b) < 18) return "เทา/ขาว";
  if (r > g*1.35 && r > b*1.35) return "แดง";
  if (g > r*1.2 && g > b*1.15) return "เขียว";
  if (b > r*1.2 && b > g*1.05) return "น้ำเงิน";
  if (r > 100 && g > 75 && b < 80) return "เหลือง/ส้ม";
  return "ผสม";
}

function distHint(bbox){
  const area = bbox[2] * bbox[3], full = video.videoWidth * video.videoHeight;
  if (!full) return "ไม่ทราบ";
  const ratio = area / full;
  if (ratio > .25) return "ใกล้";
  if (ratio > .07) return "ปานกลาง";
  return "ไกล";
}

function powerScore(t){
  const w = POWER_WEIGHT[t.class] || 1.4;
  const sizeFactor = Math.min(1.6, 0.6 + (t.bbox[2]*t.bbox[3]) / (video.videoWidth*video.videoHeight) * 3);
  return Math.max(1, Math.round(t.score * 100 * w * sizeFactor));
}

function objectColor(t){
  if (t.objColor) return t.objColor;
  let hash = 0;
  for (let i = 0; i < t.key.length; i++) hash = ((hash << 5) - hash) + t.key.charCodeAt(i) | 0;
  t.objColor = OBJECT_COLORS[Math.abs(hash) % OBJECT_COLORS.length];
  return t.objColor;
}

// ---------- tracking ----------
function updateTracks(raw){
  const now = performance.now();
  raw.slice(0, MAX_TARGETS).forEach(p => {
    const [x, y, w, h] = p.bbox, cx = x + w/2, cy = y + h/2;
    let bestKey = null, bestD = Infinity;
    for (const [k, s] of sticky) {
      if (s.class !== p.class) continue;
      const d = Math.hypot(cx - s.cx, cy - s.cy);
      if (d < Math.max(w, h) * 0.9 && d < bestD) { bestD = d; bestKey = k; }
    }
    const key = bestKey || `${p.class}_${Math.round(cx/60)}_${Math.round(cy/60)}_${Math.round(now)}`;
    const prev = sticky.get(key);
    let dir = "กำลังตรวจ…";
    if (prev) {
      const dt = (now - prev.t) / 1000;
      const vx = dt > 0 ? (cx - prev.cx) / dt : 0;
      dir = Math.abs(vx) < 18 ? "เกือบนิ่ง" : vx > 0 ? "ซ้าย → ขวา" : "ขวา → ซ้าย";
    }
    sticky.set(key, {
      ...p, key, cx, cy, t: now, dir, lastSeen: now,
      objColor: prev?.objColor
    });
  });
  for (const [k, s] of sticky) if (now - s.lastSeen > HOLD_MS) sticky.delete(k);
  if (lockedKey && !sticky.has(lockedKey)) lockedKey = null; // lost lock
  return [...sticky.values()].sort((a, b) => b.score - a.score).slice(0, MAX_TARGETS);
}

// ---------- drawing ----------
function draw(targets){
  overlay.width = video.videoWidth; overlay.height = video.videoHeight;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  targets.forEach(t => {
    const [x, y, w, h] = t.bbox, c = objectColor(t);
    const isLocked = t.key === lockedKey;
    octx.strokeStyle = c;
    octx.lineWidth = isLocked ? Math.max(4, overlay.width/220) : Math.max(3, overlay.width/320);
    octx.strokeRect(x, y, w, h);
    if (isLocked) {
      octx.strokeStyle = "#ffd43b";
      octx.lineWidth = 2;
      octx.strokeRect(x-4, y-4, w+8, h+8);
    }
    const label = `${nameOf(t.class)} ${Math.round(t.score*100)}%`;
    const fs = Math.max(15, overlay.width/44);
    octx.font = `bold ${fs}px monospace`;
    const tw = octx.measureText(label).width + 16, th = fs + 12, ly = Math.max(0, y - th);
    octx.fillStyle = c; octx.fillRect(x, ly, tw, th);
    octx.fillStyle = "#031006"; octx.fillText(label, x+8, ly+fs);
  });
}

function renderTargetInfo(t){
  if (!t || mode !== "scouter") { targetInfo.classList.add("hidden"); return; }
  targetInfo.classList.remove("hidden");
  targetType.textContent = `🎯 ${nameOf(t.class)}`;
  lockState.textContent = t.key === lockedKey ? "LOCKED" : "TRACKING";
  powerEl.textContent = powerScore(t);
  distanceEl.textContent = distHint(t.bbox);
  confEl.textContent = Math.round(t.score*100) + "%";
  directionEl.textContent = t.dir;
}

function renderList(targets){
  targetsEl.textContent = targets.length;
  if (!targets.length) {
    targetListEl.innerHTML = '<div class="empty">กำลังค้นหาวัตถุ… ขยับกล้องให้เห็นวัตถุชัดขึ้น</div>';
    powerMainEl.textContent = "---"; distMainEl.textContent = "---";
    renderTargetInfo(null);
    return;
  }
  let html = "";
  targets.forEach(t => {
    const c = objectColor(t);
    const locked = t.key === lockedKey;
    html += `<div class="target-card${locked ? " locked" : ""}" style="--obj:${c}" data-key="${t.key}">
      <div class="tc-name">${locked ? "🔒 " : "🎯 "}${nameOf(t.class)}</div>
      <div class="tc-row"><span>PWR</span><b>${powerScore(t)}</b></div>
      <div class="tc-row"><span>ระยะ</span><b>${distHint(t.bbox)}</b></div>
      <div class="tc-row"><span>CONF</span><b>${Math.round(t.score*100)}%</b></div>
    </div>`;
  });
  targetListEl.innerHTML = html;

  const primary = targets.find(t => t.key === lockedKey) || targets[0];
  powerMainEl.textContent = powerScore(primary);
  distMainEl.textContent = distHint(primary.bbox);
  renderTargetInfo(primary);
}

targetListEl.addEventListener("click", e => {
  const card = e.target.closest(".target-card");
  if (!card) return;
  lockedKey = card.dataset.key;
  lockBtn.textContent = "🔓 UNLOCK";
});

// ---------- voice ----------
function speak(text){
  if (!voiceOn || !("speechSynthesis" in window)) return;
  const now = Date.now();
  if (text === lastSpoken && now - lastSpokenAt < 4500) return;
  if (now - lastSpokenAt < 2200) return;
  lastSpoken = text; lastSpokenAt = now;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "th-TH"; u.rate = .97; u.pitch = 1;
  speechSynthesis.speak(u);
}

// ---------- vision / rain / road heuristics ----------
function analyzeVision(targets){
  if (!video.videoWidth || !video.videoHeight) return { road: 0, vision: 0, warning: "กำลังรอภาพ" };
  const w = 64, h = 48, sy = Math.floor(video.videoHeight*.45), sh = Math.floor(video.videoHeight*.55);
  sample.width = w; sample.height = h;
  sctx.drawImage(video, 0, sy, video.videoWidth, sh, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = .2126*d[i] + .7152*d[i+1] + .0722*d[i+2];
    sum += lum; sum2 += lum*lum; n++;
  }
  const mean = sum/n, variance = Math.max(0, sum2/n - mean*mean), contrast = Math.sqrt(variance);
  const objPenalty = Math.min(35, targets.length*2);
  const brightness = Math.max(0, Math.min(100, (mean-25)*1.35));
  const contrastScore = Math.max(0, Math.min(100, contrast*2.3));
  const vision = Math.round(Math.max(0, Math.min(100, .55*brightness + .45*contrastScore)));
  const roadObj = targets.filter(t => roadClasses.has(t.class)).length;
  const road = rainMode
    ? Math.round(Math.max(0, Math.min(100, vision*.75 + Math.min(25, roadObj*5) - objPenalty*.25)))
    : vision;
  let warning = "มองเห็นภาพเพียงพอ";
  if (vision < 25) warning = "🔴 มองเห็นทางไม่ชัดมาก";
  else if (vision < 45) warning = "🟠 ทัศนวิสัยต่ำ";
  else if (vision < 65) warning = "🟡 ทัศนวิสัยลดลง";
  return { road, vision, warning };
}

function updateRainHud(targets){
  // road-guide arrow only ever shows in NAV mode, and only once RAIN MODE analysis is on
  roadGuide.classList.toggle("hidden", !(rainMode && mode === "nav"));
  if (!rainMode) {
    visionScore.textContent = "0%"; visionBar.style.width = "0%";
    roadScore.textContent = "0%"; roadBar.style.width = "0%";
    visionScoreBig.textContent = "0%"; roadScoreBig.textContent = "0%";
    rainWarning.textContent = "กด RAIN MODE เพื่อเริ่มประเมินทัศนวิสัย";
    return { vision: 100, road: 100, state: "OFF" };
  }

  const a = analyzeVision(targets);
  visionScore.textContent = a.vision + "%"; visionBar.style.width = a.vision + "%";
  roadScore.textContent = a.road + "%"; roadBar.style.width = a.road + "%";
  visionScoreBig.textContent = a.vision + "%"; roadScoreBig.textContent = a.road + "%";
  rainWarning.textContent = a.warning;

  if (a.vision < 25) { navText.textContent = "⚠️ ไม่ควรพึ่ง AI นำทาง"; speak("ทัศนวิสัยต่ำมาก กรุณาชะลอความเร็วและตรวจทางด้วยตนเอง"); }
  else if (a.vision < 45) { navText.textContent = "⚠️ มองเห็นทางไม่ชัด"; speak("ทัศนวิสัยลดลง กรุณาเพิ่มความระมัดระวัง"); }
  else if (targets.length === 0) { navText.textContent = "ถนน/วัตถุยังไม่ชัด"; }
  else { navText.textContent = "ช่วยประเมินแนวทาง • ไม่ใช่ระบบขับรถอัตโนมัติ"; }

  const guide = estimateRoadGuidance(a.vision);
  return { ...a, guideState: guide.state };
}

function estimateRoadGuidance(vision){
  const w = 96, h = 54, sy = Math.floor(video.videoHeight*.45), sh = video.videoHeight - sy;
  sample.width = w; sample.height = h;
  sctx.drawImage(video, 0, sy, video.videoWidth, sh, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;
  let left = 0, right = 0, total = 0;
  for (let y = Math.floor(h*.35); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y*w + x)*4, l = .2126*d[i] + .7152*d[i+1] + .0722*d[i+2];
      if (l > 150) { total++; if (x < w*.35) left++; else if (x > w*.65) right++; }
    }
  }
  const laneSignal = Math.min(100, total*0.9);
  let state = "SEARCHING", arrow = "↑", text = "กำลังหาแนวถนน", color = "#ffd43b";
  if (vision < 25) { state = "LOW VIS"; arrow = "⚠"; text = "มองแนวถนนไม่ชัด"; color = "#ff5c5c"; }
  else if (laneSignal > 35 && Math.abs(left-right) < Math.max(12, total*.12)) { state = "ROAD FOUND"; arrow = "↑"; text = "แนวทางตรง"; color = "#69ff91"; }
  else if (left > right*1.35) { state = "ROAD BIAS"; arrow = "↖"; text = "แนวถนนเอนซ้าย"; color = "#ffd43b"; }
  else if (right > left*1.35) { state = "ROAD BIAS"; arrow = "↗"; text = "แนวถนนเอนขวา"; color = "#ffd43b"; }
  else { state = "UNCERTAIN"; arrow = "↑"; text = "แนวถนนยังไม่แน่ใจ"; color = "#ffd43b"; }
  guideState.textContent = state; guideState.style.color = color;
  guideArrow.textContent = arrow; guideArrow.style.color = color;
  guideText.textContent = text;
  return { state, text };
}

// ---------- overall safety status ----------
function updateRisk(targets, vision, guideState){
  const near = targets.some(t => roadClasses.has(t.class) || t.class === "person"
    ? ((t.bbox[2]*t.bbox[3])/(video.videoWidth*video.videoHeight) > .16 && (t.bbox[1]+t.bbox[3]) > video.videoHeight*.55)
    : false);
  let level = "green", label = "ASSIST ACTIVE";
  if (vision < 25 || guideState === "LOW VIS") { level = "red"; label = "⚠ VISION LOW"; }
  else if (near) { level = "yellow"; label = "⚠ OBJECT CLOSE"; }
  else if (vision < 45 || guideState === "UNCERTAIN") { level = "yellow"; label = "CAUTION"; }
  const color = level === "red" ? "#ff5c5c" : level === "yellow" ? "#ffd43b" : "#69ff91";
  riskText.textContent = label; riskText.style.color = color;
  riskTextBig.textContent = label; riskTextBig.style.color = color;
  if (level !== lastRiskLevel && level !== "green") {
    if (level === "red") speak("แจ้งเตือน ทัศนวิสัยต่ำมาก");
    else if (label === "⚠ OBJECT CLOSE") speak("ระวัง มีวัตถุอยู่ใกล้");
  }
  lastRiskLevel = level;
}

// ---------- GPS / heading ----------
function updateGpsUi(){
  gpsText.textContent = gps ? `GPS: ±${Math.round(gps.accuracy)}m` : "GPS: --";
  headingText.textContent = heading != null ? `HEADING: ${Math.round(heading)}°` : "HEADING: --";
}
function startGPS(){
  if (!navigator.geolocation) { gpsText.textContent = "GPS: UNSUPPORTED"; return; }
  if (gpsWatchId != null) return;
  gpsWatchId = navigator.geolocation.watchPosition(pos => {
    gps = pos.coords; updateGpsUi();
    if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) heading = pos.coords.heading;
  }, () => { gpsText.textContent = "GPS: BLOCKED"; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 7000 });
}
async function enableOrientation(){
  if (orientationEnabled) return;
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p !== "granted") return;
    }
    window.addEventListener("deviceorientation", e => {
      const h = e.webkitCompassHeading ?? (e.alpha != null ? (360 - e.alpha) : null);
      if (h != null) { heading = h; updateGpsUi(); }
    }, true);
    orientationEnabled = true;
  } catch (e) { /* ignore — heading just stays unavailable */ }
}

// ---------- main loop ----------
async function loop(){
  if (!running) return;
  if (video.readyState < 2) { requestAnimationFrame(loop); return; }
  const now = performance.now();
  if (frameBusy || now - lastInference < INFER_MS) { requestAnimationFrame(loop); return; }
  frameBusy = true; lastInference = now;
  try {
    const raw = await model.detect(video, 20, 0.5);
    const targets = updateTracks(raw);
    draw(targets);
    renderList(targets);
    const vis = updateRainHud(targets);
    updateRisk(targets, vis.vision, vis.guideState);
    setStatus(`LIVE AI • ${targets.length} TARGET${targets.length === 1 ? "" : "S"}`);
  } catch (e) {
    console.error(e);
    setStatus("AI ERROR");
  }
  frameBusy = false;
  requestAnimationFrame(loop);
}

// ---------- mode switching (SCOUTER MODE vs NAV ASSIST MODE — two separate screens) ----------
function switchMode(next){
  mode = next;
  const isScouter = mode === "scouter";
  tabScouterBtn.classList.toggle("active", isScouter);
  tabNavBtn.classList.toggle("active", !isScouter);
  scouterPanel.classList.toggle("hidden", !isScouter);
  navPanel.classList.toggle("hidden", isScouter);
  $("reticle").classList.toggle("hidden", !isScouter);
  if (!isScouter) targetInfo.classList.add("hidden");
  if (isScouter) roadGuide.classList.add("hidden");
}
tabScouterBtn.onclick = () => switchMode("scouter");
tabNavBtn.onclick = () => switchMode("nav");

// ---------- UI bindings ----------
startBtn.onclick = () => running ? stopScouter() : openScouter();
flipBtn.onclick = flipCamera;

scanBtn.onclick = () => {
  const targets = [...sticky.values()].sort((a,b) => b.score - a.score);
  if (!targets.length) { speak("ไม่พบวัตถุ"); return; }
  scanCursor = (scanCursor + 1) % targets.length;
  lockedKey = targets[scanCursor].key;
  lockBtn.textContent = "🔓 UNLOCK";
  const t = targets[scanCursor];
  speak(`ล็อกเป้าหมาย ${nameOf(t.class)} พลัง ${powerScore(t)}`);
};

lockBtn.onclick = () => {
  if (lockedKey) {
    lockedKey = null;
    lockBtn.textContent = "🎯 LOCK TARGET";
  } else {
    const targets = [...sticky.values()].sort((a,b) => b.score - a.score);
    if (!targets.length) { speak("ไม่พบวัตถุให้ล็อก"); return; }
    lockedKey = targets[0].key;
    lockBtn.textContent = "🔓 UNLOCK";
    speak(`ล็อกเป้าหมาย ${nameOf(targets[0].class)}`);
  }
};

function toggleVoice(){
  voiceOn = !voiceOn;
  [voiceBtn, voiceBtnNav].forEach(b => {
    b.classList.toggle("on", voiceOn);
    b.textContent = voiceOn ? "🔊 VOICE" : "🔇 VOICE";
  });
  if (!voiceOn) speechSynthesis.cancel();
}
voiceBtn.onclick = toggleVoice;
voiceBtnNav.onclick = toggleVoice;

rainBtn.onclick = () => {
  rainMode = !rainMode;
  rainBtn.classList.toggle("on", rainMode);
  rainBtn.textContent = rainMode ? "🌧️ RAIN: ON" : "🌧️ RAIN MODE";
  if (rainMode) { if (running) speak("เปิดโหมดฝนตกแล้ว"); }
  else { navText.textContent = "รอเปิด Rain Mode"; }
};

gpsBtn.onclick = () => {
  startGPS();
  enableOrientation();
  gpsBtn.classList.add("on");
  navText.textContent = "GPS/เข็มทิศพร้อมเมื่ออุปกรณ์อนุญาต";
};

switchMode("scouter"); // initial state
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
