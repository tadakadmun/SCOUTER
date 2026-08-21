const $=id=>document.getElementById(id);
const video=$("video"),canvas=$("canvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});
let model=null,stream=null,running=false,facing="environment",voiceOn=true,waterMode=false,loading=false,frameBusy=false,lastInference=0;
let tracks=[];
const sticky=new Map();
const HOLD_MS=1800;          // keep a detected object visible this long
const INFER_MS=260;          // do not refresh the result too fast
const MAX_OBJECTS=8;
const names={person:"คน",bicycle:"จักรยาน",car:"รถยนต์",motorcycle:"รถจักรยานยนต์",airplane:"เครื่องบิน",bus:"รถโดยสาร",train:"รถไฟ",truck:"รถบรรทุก",boat:"เรือ",bird:"นก",cat:"แมว",dog:"สุนัข",horse:"ม้า",sheep:"แกะ",cow:"วัว",elephant:"ช้าง",bear:"หมี",zebra:"ม้าลาย",giraffe:"ยีราฟ",backpack:"กระเป๋า",umbrella:"ร่ม",handbag:"กระเป๋าถือ",tie:"เนกไท",suitcase:"กระเป๋าเดินทาง",bottle:"ขวด",wine_glass:"แก้ว",cup:"ถ้วย",fork:"ส้อม",knife:"มีด",spoon:"ช้อน",bowl:"ชาม",banana:"กล้วย",apple:"แอปเปิล",sandwich:"แซนด์วิช",orange:"ส้ม",broccoli:"บรอกโคลี",carrot:"แครอต",chair:"เก้าอี้",couch:"โซฟา",potted_plant:"ต้นไม้",bed:"เตียง",dining_table:"โต๊ะ",toilet:"สุขภัณฑ์",tv:"ทีวี",laptop:"แล็ปท็อป",mouse:"เมาส์",remote:"รีโมต",keyboard:"คีย์บอร์ด",cell_phone:"โทรศัพท์",microwave:"ไมโครเวฟ",oven:"เตาอบ",toaster:"เครื่องปิ้งขนมปัง",sink:"อ่างล้างจาน",refrigerator:"ตู้เย็น",book:"หนังสือ",clock:"นาฬิกา",vase:"แจกัน",scissors:"กรรไกร",teddy_bear:"ตุ๊กตา",hair_drier:"ไดร์เป่าผม",toothbrush:"แปรงสีฟัน"};
function setStatus(t){$("status").textContent=t}
function fail(msg){setStatus("ERROR");$("cards").innerHTML=`<div class="empty">⚠️ ${msg}<br><small>iPhone: Settings → Safari → Camera → Allow แล้วโหลดหน้าใหม่</small></div>`;$("start").textContent="📷 TRY AGAIN"}
async function loadModel(){
 if(model)return model;if(loading)return null;loading=true;setStatus("LOADING AI…");
 if(!window.tf||!window.cocoSsd)throw new Error("AI library โหลดไม่สำเร็จ กรุณาต่ออินเทอร์เน็ตแล้วรีโหลด");
 await tf.ready();model=await cocoSsd.load({base:"lite_mobilenet_v2"});loading=false;return model;
}
async function openAI(){
 if(running)return;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error("เบราว์เซอร์ไม่รองรับกล้อง หรือหน้าเว็บไม่ได้เปิดผ่าน HTTPS");
  setStatus("REQUEST CAMERA…");
  if(!stream){
   stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}},audio:false});
   video.srcObject=stream;await new Promise(r=>video.onloadedmetadata=r);await video.play();
  }
  await loadModel();running=true;$("start").textContent="■ AI RUNNING";setStatus("LIVE AI");requestAnimationFrame(loop);
 }catch(e){console.error(e);loading=false;fail(e.message||"เปิดระบบไม่สำเร็จ")}
}
function stop(){running=false;$("start").textContent="📷 OPEN AI";setStatus(stream?"CAMERA READY":"READY")}
async function flip(){facing=facing==="environment"?"user":"environment";if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;running=false;await openAI()}
function colorOf(x,y,w,h){
 if(!video.videoWidth||!video.videoHeight)return"ไม่ทราบ";
 const sx=Math.max(0,Math.floor(x)),sy=Math.max(0,Math.floor(y)),sw=Math.max(1,Math.min(Math.floor(w),video.videoWidth-sx)),sh=Math.max(1,Math.min(Math.floor(h),video.videoHeight-sy));
 const cw=Math.min(32,sw),ch=Math.min(32,sh);ctx.clearRect(0,0,cw,ch);ctx.drawImage(video,sx,sy,sw,sh,0,0,cw,ch);
 const d=ctx.getImageData(0,0,cw,ch).data;let r=0,g=0,b=0,n=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++}r/=n;g/=n;b/=n;
 if(Math.max(r,g,b)<45)return"ดำ/มืด";if(Math.max(r,g,b)-Math.min(r,g,b)<18)return"เทา/ขาว";if(r>g*1.35&&r>b*1.35)return"แดง";if(g>r*1.2&&g>b*1.15)return"เขียว";if(b>r*1.2&&b>g*1.05)return"น้ำเงิน";if(r>100&&g>75&&b<80)return"เหลือง/ส้ม";return"ผสม";
}
function distHint(b){const area=b[2]*b[3],full=video.videoWidth*video.videoHeight;if(!full)return"ไม่ทราบ";if(area/full>.25)return"ใกล้";if(area/full>.07)return"ปานกลาง";return"ไกล"}
function matchTrack(p){
 const [x,y,w,h]=p.bbox,cx=x+w/2,cy=y+h/2;let best=null,bestD=Infinity;
 for(const t of tracks){if(t.class!==p.class)continue;const d=Math.hypot(cx-t.x,cy-t.y);if(d<Math.max(w,h)*.8&&d<bestD){best=t;bestD=d}}
 const now=performance.now();
 if(best){const dt=(now-best.t)/1000,vx=dt>0?(cx-best.x)/dt:0,vy=dt>0?(cy-best.y)/dt:0;best.x=cx;best.y=cy;best.t=now;return{dir:Math.abs(vx)<18?"เกือบนิ่ง":vx>0?"ซ้าย → ขวา":"ขวา → ซ้าย"}}
 tracks.push({class:p.class,x:cx,y:cy,t:now});if(tracks.length>40)tracks.shift();return{dir:"กำลังตรวจ…"}
}
function draw(preds){
 canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.clearRect(0,0,canvas.width,canvas.height);
 preds.forEach(p=>{const[x,y,w,h]=p.bbox;ctx.strokeStyle="#69ff91";ctx.lineWidth=Math.max(3,canvas.width/320);ctx.strokeRect(x,y,w,h);ctx.fillStyle="#69ff91";ctx.font=`bold ${Math.max(15,canvas.width/44)}px monospace`;ctx.fillText(`🎯 ${names[p.class]||p.class} ${Math.round(p.score*100)}%`,x,Math.max(28,y-9))});
}
function render(preds,moves){
 $("count").textContent=preds.length;if(!preds.length){$("cards").innerHTML='<div class="empty">กำลังค้นหาวัตถุ…<br>ขยับกล้องเล็กน้อยและให้วัตถุอยู่ในภาพ</div>';return}
 let html="";preds.slice(0,8).forEach((p,i)=>{const[x,y,w,h]=p.bbox,c=colorOf(x,y,w,h),m=moves[i];html+=`<div class="card"><div class="row"><span class="name">${names[p.class]||p.class}</span><span class="confidence">${Math.round(p.score*100)}%</span></div><div class="row"><span>สี</span><b>${c}</b></div><div class="row"><span>ระยะเชิงภาพ</span><b>${distHint(p.bbox)}</b></div><div class="row"><span>ทิศทาง</span><b>${m.dir}</b></div>${waterMode?`<div class="row"><span>💧 WATER</span><b>โหมดตรวจน้ำทำงาน</b></div>`:""}</div>`});$("cards").innerHTML=html;
}
async function loop(){
 if(!running)return;if(video.readyState<2){requestAnimationFrame(loop);return}
 const now=performance.now();if(frameBusy||now-lastInference<INFER_MS){requestAnimationFrame(loop);return}
 frameBusy=true;lastInference=now;
 try{
  const raw=await model.detect(video,20,.28);
  const now2=performance.now();
  // Keep a target on screen briefly so the user can actually read it.
  raw.slice(0,MAX_OBJECTS).forEach(p=>{
    const [x,y,w,h]=p.bbox, cx=x+w/2, cy=y+h/2;
    let bestKey=null,bestD=Infinity;
    for(const [k,s] of sticky){
      if(s.class!==p.class) continue;
      const d=Math.hypot(cx-s.cx,cy-s.cy);
      if(d<Math.max(w,h)*.9 && d<bestD){bestD=d;bestKey=k}
    }
    const key=bestKey || `${p.class}_${Math.round(cx/60)}_${Math.round(cy/60)}`;
    const mv=matchTrack(p);
    sticky.set(key,{...p,cx,cy,mv,lastSeen:now2});
  });
  for(const [k,s] of sticky){
    if(now2-s.lastSeen>HOLD_MS) sticky.delete(k);
  }
  const preds=[...sticky.values()].sort((a,b)=>b.score-a.score).slice(0,MAX_OBJECTS);
  draw(preds);
  render(preds,preds.map(p=>p.mv||{dir:"กำลังตรวจ…"}));
  setStatus(`LIVE AI • ${preds.length} OBJECT${preds.length===1?"":"S"}`);
}catch(e){console.error(e);setStatus("AI ERROR")}
 frameBusy=false;requestAnimationFrame(loop)
}
$("start").onclick=()=>running?stop():openAI();
$("flip").onclick=flip;
$("voice").onclick=()=>{voiceOn=!voiceOn;$("voice").classList.toggle("on",voiceOn)};
$("water").onclick=()=>{waterMode=!waterMode;$("water").classList.toggle("on",waterMode);$("water").textContent=waterMode?"💧 WATER ON":"💧 WATER"};
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
