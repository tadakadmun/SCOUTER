# SCOUTER V2 — ฟรี 100%

เพิ่มจาก V1:
- Multi Target
- Target Lock
- Target list
- ประเมินระยะจากขนาดวัตถุ (ไม่ใช่ระยะจริง)
- Power score แบบจำลอง
- Voice feedback
- HUD/reticle
- สลับกล้อง
- ประมวลผลใน browser

## เปิดใช้งาน
ต้องเปิดผ่าน HTTPS หรือ localhost เพื่อให้ iPhone อนุญาตกล้อง
โมเดล V2 โหลดจาก CDN ครั้งแรก จึงควรมีอินเทอร์เน็ตในครั้งแรก
หลังจากนั้นส่วนประมวลผล AI ทำใน browser เป็นหลัก

ไม่มี API แบบคิดเงิน

V2 RAIN MODE
- Rain Mode HUD สำหรับประเมินทัศนวิสัยและคุณภาพภาพแบบสัมพัทธ์
- แถบ ROAD / VISION confidence
- แจ้งเตือนเสียงภาษาไทยเมื่อทัศนวิสัยต่ำ
- ใช้ GPS ของมือถือเพื่อบอกว่าตำแหน่งพร้อม (ยังไม่ทำ turn-by-turn)
- NAV ASSIST เป็นระบบช่วยเตือน ไม่ใช่ระบบขับรถอัตโนมัติ
- ไม่ใช้ Paid API

ข้อจำกัดด้านความปลอดภัย:
- ค่า ROAD/VISION เป็นคะแนนจากภาพ ไม่ใช่การรับรองว่าถนนปลอดภัย
- ฝนหนัก กลางคืน น้ำเกาะเลนส์/กระจก หรือภาพพร่ามาก อาจทำให้ AI ผิดพลาด
- ผู้ขับต้องมองถนนและควบคุมรถเองเสมอ

SCOUTER AI INSPECTOR — FREE FINAL BUILD

ฟังก์ชันรวม:
1) Object Detection แบบต่อเนื่อง
2) สีของวัตถุ + กรอบสีเดียวกัน + Tracking
3) ประเมินทิศทางการเคลื่อนที่
4) RAIN MODE
5) Vision / Road confidence แบบสัมพัทธ์
6) เสียงเตือนภาษาไทย
7) Road Guidance แบบ lightweight heuristic บนภาพ
8) Safety status: ASSIST ACTIVE / CAUTION / VISION LOW / OBJECT CLOSE
9) GPS ตำแหน่ง + heading เมื่อเบราว์เซอร์/อุปกรณ์อนุญาต
10) ทำงานโดยไม่ต้องใช้ Paid AI API

ข้อจำกัด:
- Road Guidance รุ่นฟรีนี้เป็นการประเมินจากภาพ ไม่ใช่ lane-level autonomous navigation
- ไม่รับรองความปลอดภัยของถนน และไม่ควรใช้แทนผู้ขับ
- ระยะจริง ความเร็วจริง และแนวถนนที่แม่นยำต้องใช้ calibration/depth/sensor เพิ่ม
- Turn-by-turn navigation ให้ใช้แอปแผนที่ที่เชื่อถือได้ควบคู่
- ต้องเปิดกล้องผ่าน HTTPS/localhost
- AI model โหลดจาก CDN ในครั้งแรก จึงต้องมีอินเทอร์เน็ตตอนเริ่มต้น
