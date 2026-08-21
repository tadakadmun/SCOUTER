
const $=id=>document.getElementById(id);
const video=$("video"), canvas=$("canvas"), ctx=canvas.getContext("2d");
let model=null, stream=null, running=false, facing="environment", voiceOn=true, waterMode=false;
let tracks=new Map(), lastTime=performance.now(), nextId=1;

const names={person:"คน",bicycle:"จักรยาน",car:"รถยนต์",motorcycle:"รถจักรยานยนต์",airplane:"เครื่องบิน",bus:"รถโดยสาร",train:"รถไฟ",truck:"รถบรรทุก",boat:"เรือ",bird:"นก",cat:"แมว",dog:"สุนัข",horse:"ม้า",sheep:"แกะ",cow:"วัว",elephant:"ช้าง",bear:"หมี",zebra:"ม้าลาย",giraffe:"ยีราฟ",backpack:"กระเป๋า",umbrella:"ร่ม",handbag:"กระเป๋าถือ",tie:"เนกไท",suitcase:"กระเป๋าเดินทาง",bottle:"ขวด",wine_glass:"แก้ว",cup:"ถ้วย",fork:"ส้อม",knife:"มีด",spoon:"ช้อน",bowl:"ชาม",banana:"กล้วย",apple:"แอปเปิล",sandwich:"แซนด์วิช",orange:"ส้ม",broccoli:"บรอกโคลี",carrot:"แครอต",chair:"เก้าอี้",couch:"โซฟา",potted_plant:"ต้นไม้",bed:"เตียง",dining_table:"โต๊ะ",toilet:"สุขภัณฑ์",tv:"ทีวี",laptop:"แล็ปท็อป",mouse:"เมาส์",remote:"รีโมต",keyboard:"คีย์บอร์ด",cell_phone:"โทรศัพท์",microwave:"ไมโครเวฟ",oven:"เตาอบ",toaster:"เครื่องปิ้งขนมปัง",sink:"อ่างล้างจาน",refrigerator:"ตู้เย็น",book:"หนังสือ",clock:"นาฬิกา",vase:"แจกัน",scissors:"กรรไกร",teddy_bear:"ตุ๊กตา",hair_drier:"ไดร์เป่าผม",toothbrush:"แปรงสีฟัน"};

async function start(){
  try{
    if(!stream){
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}},audio:false});
      video.srcObject=stream; await video.play();
    }
    if(!model){$("status").textContent="LOADING AI";model=await cocoSsd.load();$("status").textContent="AI READY"}
    running=true;$("start").textContent="■ STOP";requestAnimationFrame(loop);
  }catch(e){$("status").textContent="CAMERA ERROR";alert("เปิดกล้องไม่ได้: "+e.message)}
}
function stop(){running=false;$("start").textContent="▶ START";$("status").textContent="PAUSED"}
async function flip(){
  facing=facing==="environment"?"user":"environment";
  if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;await start();
}
function colorOf(x,y,w,h){
  const sw=Math.max(1,Math.floor(w/12)),sh=Math.max(1,Math.floor(h/12));
  ctx.drawImage(video,x,y,w,h,0,0,sw,sh);let d=ctx.getImageData(0,0,sw,sh).data,r=0,g=0,b=0,n=0;
  for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++}
  r/=n;g/=n;b/=n;
  if(Math.max(r,g,b)<45)return"ดำ/มืด";
  if(Math.max(r,g,b)-Math.min(r,g,b)<18)return"เทา/ขาว";
  if(r>g*1.35&&r>b*1.35)return"แดง";if(g>r*1.2&&g>b*1.15)return"เขียว";if(b>r*1.2&&b>g*1.05)return"น้ำเงิน";
  if(r>100&&g>75&&b<80)return"เหลือง/ส้ม";return"ผสม";
}
function distHint(p){
  const area=p[2]*p[3], full=video.videoWidth*video.videoHeight;
  if(area/full>.25)return"ใกล้";if(area/full>.07)return"ปานกลาง";return"ไกล";
}
function direction(cx,prev){
  if(!prev)return"กำลังตรวจทิศทาง";
  const dx=cx-prev.x;
  if(Math.abs(dx)<4)return"เกือบนิ่ง";
  return dx>0?"ซ้าย → ขวา":"ขวา → ซ้าย";
}
function draw(preds){
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.clearRect(0,0,canvas.width,canvas.height);
  preds.forEach(p=>{
    const [x,y,w,h]=p.bbox, key=p.class+"_"+Math.round(x/40)+"_"+Math.round(y/40);
    let tr=tracks.get(key),cx=x+w/2,cy=y+h/2,now=performance.now();
    const prev=tr;tracks.set(key,{x:cx,y:cy,t:now});
    ctx.strokeStyle="#69ff91";ctx.lineWidth=Math.max(2,canvas.width/350);ctx.strokeRect(x,y,w,h);
    ctx.fillStyle="#69ff91";ctx.font=`bold ${Math.max(14,canvas.width/45)}px monospace`;ctx.fillText(names[p.class]||p.class,x,y>25?y-6:y+20);
  });
}
function render(preds){
  $("count").textContent=preds.length;
  if(!preds.length){$("cards").innerHTML='<div class="empty">ยังไม่พบวัตถุที่มั่นใจพอ</div>';return}
  let html="";
  preds.slice(0,8).forEach(p=>{
    const [x,y,w,h]=p.bbox,cx=x+w/2, key=p.class+"_"+Math.round(x/40)+"_"+Math.round(y/40),prev=tracks.get(key);
    const c=colorOf(Math.max(0,x),Math.max(0,y),Math.min(w,video.videoWidth-x),Math.min(h,video.videoHeight-y));
    html+=`<div class="card"><div class="row"><span class="name">${names[p.class]||p.class}</span><span class="confidence">${Math.round(p.score*100)}%</span></div>
    <div class="row"><span>สี</span><b>${c}</b></div><div class="row"><span>ระยะโดยประมาณ</span><b>${distHint(p.bbox)}</b></div>
    <div class="row"><span>การเคลื่อนที่</span><b>${prev?direction(cx,prev):"กำลังตรวจ..."}</b></div>
    ${waterMode?`<div class="row"><span>💧 Water mode</span><b>กำลังตรวจภาพน้ำ</b></div>`:""}</div>`;
  });
  $("cards").innerHTML=html;
}
async function loop(){
  if(!running)return;
  const preds=await model.detect(video,20,.5);
  draw(preds);render(preds);
  $("status").textContent=`LIVE • ${preds.length} OBJECT${preds.length===1?"":"S"}`;
  requestAnimationFrame(loop);
}
$("start").onclick=()=>running?stop():start();
$("flip").onclick=flip;
$("voice").onclick=()=>{voiceOn=!voiceOn;$("voice").classList.toggle("on",voiceOn)};
$("water").onclick=()=>{waterMode=!waterMode;$("water").classList.toggle("on",waterMode);$("water").textContent=waterMode?"💧 WATER ON":"💧 WATER"};
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
