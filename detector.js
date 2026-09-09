/* detector.js — ตรวจจับวัตถุ
 *
 * ใช้ TensorFlow.js + COCO-SSD (lite_mobilenet_v2) ทำงานในเครื่องล้วน
 * จุดสำคัญ: เซฟน้ำหนักโมเดลลง IndexedDB หลังโหลดครั้งแรก
 * เพื่อให้ครั้งต่อไปเปิดได้แม้ไม่มีสัญญาณ — ซึ่งเป็นตอนที่ต้องการมันที่สุด
 */

const IDB_URL = 'indexeddb://navassist-cocossd-lite';

// เฉพาะคลาสที่เกี่ยวกับความปลอดภัยบนถนน คลาสอื่นถูกทิ้งตั้งแต่ต้นทาง
export const ROAD_CLASSES = new Set([
  'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'train',
]);

export const CLASS_TH = {
  person: 'คนเดินถนน', bicycle: 'จักรยาน', car: 'รถยนต์',
  motorcycle: 'รถจักรยานยนต์', bus: 'รถโดยสาร', truck: 'รถบรรทุก', train: 'รถไฟ',
};

/** ความสูงจริงโดยประมาณ (เมตร) ใช้ประมาณระยะแบบ pinhole */
export const CLASS_HEIGHT_M = {
  person: 1.70, bicycle: 1.10, motorcycle: 1.30,
  car: 1.50, bus: 3.20, truck: 3.20, train: 3.80,
};

export class Detector {
  constructor() {
    this.model = null;
    this.source = null;      // 'cache' | 'network'
    this.lastLatency = 0;
    this.busy = false;
  }

  async load(onProgress) {
    if (this.model) return this.model;
    if (!window.tf || !window.cocoSsd) {
      throw new Error('โหลดไลบรารี AI ไม่สำเร็จ ต่ออินเทอร์เน็ตครั้งแรกแล้วเปิดใหม่');
    }
    // อ้างผ่าน window อย่างชัดเจน ไลบรารีทั้งสองถูกโหลดด้วย <script> ธรรมดา
    // จึงอยู่บน window ไม่ได้อยู่ในขอบเขตของโมดูลนี้
    const tf = window.tf, cocoSsd = window.cocoSsd;
    await tf.ready();

    // พยายามใช้ WebGL ก่อน ถ้าไม่ได้ค่อยตกไป WASM/CPU
    try { await tf.setBackend('webgl'); } catch { /* ปล่อยให้ tf เลือกเอง */ }

    onProgress?.('กำลังอ่านโมเดลจากเครื่อง');
    try {
      this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: IDB_URL });
      this.source = 'cache';
      return this.model;
    } catch { /* ยังไม่เคยเซฟ หรือ IndexedDB ใช้ไม่ได้ */ }

    onProgress?.('กำลังดาวน์โหลดโมเดล (ครั้งเดียว)');
    this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    this.source = 'network';

    // เซฟไว้ใช้ครั้งหน้า ถ้าเซฟไม่ได้ก็ไม่เป็นไร แค่ต้องโหลดใหม่
    try { await this.model.model?.save?.(IDB_URL); } catch { }
    return this.model;
  }

  /**
   * ตรวจจับหนึ่งเฟรม คืนเฉพาะวัตถุบนถนนที่ผ่านเกณฑ์ความเชื่อมั่น
   * bbox = [x, y, w, h] ในพิกัดพิกเซลของวิดีโอ
   */
  async detect(video, minScore = 0.45) {
    if (!this.model || this.busy) return null;
    this.busy = true;
    const t0 = performance.now();
    try {
      const raw = await this.model.detect(video, 12, minScore);
      this.lastLatency = performance.now() - t0;
      return raw
        .filter(d => ROAD_CLASSES.has(d.class))
        .sort((a, b) => b.score - a.score);
    } finally {
      this.busy = false;
    }
  }
}
