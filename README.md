# LINE OA ↔ AI Bridge

ตัวกลางเชื่อม LINE Official Account เข้ากับ AI ภายนอกผ่าน API
รับ webhook จาก LINE → ส่งไปถาม AI → ตอบกลับเข้าแชท

```
ผู้ใช้ LINE ──► LINE Platform ──► POST /webhook ──► OpenAI API
     ▲                                  │                │
     └────── reply / push ◄─────────────┴────────────────┘
```

## ขั้นตอนตั้งค่า

### 1. เปิด Messaging API ให้ LINE OA ที่มีอยู่

ทำครั้งเดียว ที่ [LINE Official Account Manager](https://manager.line.biz/)

1. เลือก OA ของคุณ → **ตั้งค่า** → **Messaging API**
2. กด **ใช้ Messaging API** แล้วเลือก Provider (ถ้ายังไม่มี ให้สร้างใหม่ได้เลย)
3. ไปที่ **ตั้งค่า → การตอบกลับ** แล้วตั้งค่าดังนี้ — **สำคัญมาก ถ้าไม่ปิดบอทจะไม่ทำงาน**
   - ตอบกลับอัตโนมัติ (Auto-reply): **ปิด**
   - ข้อความทักทายเพื่อนใหม่ (Greeting message): ปิดหรือเปิดก็ได้
   - Webhook: **เปิด**

### 2. เอา Token กับ Secret

ที่ [LINE Developers Console](https://developers.line.biz/console/) → เลือก Channel ที่เพิ่งสร้าง

| ค่าที่ต้องใช้ | หาได้ที่ |
|---|---|
| `LINE_CHANNEL_SECRET` | แท็บ **Basic settings** → Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | แท็บ **Messaging API** → Channel access token (long-lived) → กด Issue |

### 3. ตั้งค่า environment

สร้างไฟล์ชื่อ `.env` ไว้ที่โฟลเดอร์หลักของโปรเจกต์ แล้วใส่ค่าตามนี้

```
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
SYSTEM_PROMPT=คุณเป็นผู้ช่วยของ LINE Official Account ตอบเป็นภาษาไทยสั้น กระชับ สุภาพ
PORT=3000
```

ไฟล์นี้เก็บค่าลับทั้งหมด จึงถูกกันไว้ใน `.gitignore` และจะไม่ถูก push ขึ้น GitHub
ตอน deploy ขึ้น Render ไม่ต้องใช้ไฟล์นี้ ให้ไปกรอกค่าในหน้า Environment ของ Render แทน

### 4. รันเครื่องตัวเอง + เปิดให้ LINE เข้าถึง

LINE ยิง webhook เข้ามาได้เฉพาะ **HTTPS สาธารณะ** เท่านั้น ตอน dev ใช้ ngrok เปิดอุโมงค์

```powershell
npm run dev          # เทอร์มินัลที่ 1
ngrok http 3000      # เทอร์มินัลที่ 2
```

เอา URL ที่ ngrok ให้มา ต่อท้ายด้วย `/webhook` ไปใส่ที่
LINE Developers Console → **Messaging API** → Webhook URL

```
https://xxxx-xx-xx.ngrok-free.app/webhook
```

กด **Verify** ต้องขึ้น Success แล้วเปิดสวิตช์ **Use webhook**

> ngrok ฟรีจะเปลี่ยน URL ทุกครั้งที่ restart ต้องกลับมาแก้ Webhook URL ใหม่

### 5. ทดสอบ

สแกน QR ใน LINE Developers Console เพื่อเพิ่มเพื่อน แล้วพิมพ์คุยได้เลย

## โครงสร้างโค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `src/server.js` | รับ webhook, ตรวจ signature, ตอบ 200 ทันทีแล้วทำงานต่อเบื้องหลัง |
| `src/handler.js` | ตัดสินใจว่า event แต่ละอันทำอะไร, กัน event ซ้ำ, ดัก error |
| `src/ai.js` | **จุดเดียวที่คุยกับ AI** — จะเปลี่ยนเจ้าอื่นแก้แค่ไฟล์นี้ |
| `src/line.js` | ตรวจ signature, ส่ง reply/push, loading animation |
| `src/conversation.js` | จำบทสนทนารายคน (in-memory) |
| `src/config.js` | รวม config และเช็ก env ตอนเริ่ม |

## คำสั่งที่บอทรู้จัก

พิมพ์ `เริ่มใหม่` / `ล้างประวัติ` / `reset` → ล้างบทสนทนาเริ่มคุยใหม่

## ข้อควรรู้เรื่องพฤติกรรมของ LINE

- **LINE รอแค่ ~1 วินาที** โค้ดนี้จึงตอบ `200` ทันทีแล้วค่อยไปถาม AI ต่อเบื้องหลัง
- **`replyToken` ใช้ได้ครั้งเดียว อายุ ~30 วินาที** ถ้า AI ตอบช้าเกิน ระบบจะสลับไปใช้ **push** ให้อัตโนมัติ
  (push กินโควต้าข้อความตามแพ็กเกจ LINE OA ส่วน reply ฟรี)
- **LINE ยิงซ้ำได้** ถ้า network สะดุด จึงกันด้วย `webhookEventId`
- **Loading animation ใช้ได้เฉพาะแชท 1:1** ในกลุ่มจะไม่แสดง

## Deploy ขึ้น Render

ไฟล์ [render.yaml](render.yaml) เตรียมไว้ให้แล้ว Render จะอ่านแล้วสร้าง service ให้เอง

1. push โปรเจกต์นี้ขึ้น GitHub เป็น **private repository** (`.env` ถูกกันไว้ใน `.gitignore` แล้ว จะไม่ติดขึ้นไป)
2. เข้า https://dashboard.render.com/ → **New** → **Blueprint** → เลือก repo
3. Render จะถามค่า 3 ตัวที่ตั้ง `sync: false` ไว้ ให้กรอก:
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `OPENAI_API_KEY`
4. รอ build เสร็จ จะได้ URL หน้าตาแบบ `https://line-ai-bridge.onrender.com`
5. เอา URL นั้น **ต่อท้ายด้วย `/webhook`** ไปใส่ใน LINE Developers Console → Messaging API → Webhook URL
   แล้วกด **Verify** และเปิดสวิตช์ **Use webhook**

> อย่าตั้ง `PORT` เองใน Render — Render กำหนดค่านี้ให้อัตโนมัติ และโค้ดอ่านจาก `process.env.PORT` อยู่แล้ว

### เรื่องเครื่องหลับ (สำคัญ)

โปรเจกต์นี้ตั้งไว้ที่ `plan: free` ซึ่ง Render จะ**พักเครื่องเมื่อไม่มี request เข้า 15 นาที**
และปลุกกลับมาใช้เวลาราวครึ่งนาที นานเกินกว่าที่ LINE จะรอ ข้อความแรกที่ลูกค้าทักมาจึงหายได้

จึงต้องกันหลับด้วยการยิง `/health` เป็นระยะ **2 ชั้น**

**ชั้นที่ 1 — ยิงจากในตัวโปรแกรมเอง** ([src/keepalive.js](src/keepalive.js))
ทำงานอัตโนมัติเมื่อ deploy บน Render แล้ว ไม่ต้องตั้งค่าอะไร
ข้อจำกัด: กันหลับได้ แต่**ปลุกไม่ได้** ถ้าหลับไปแล้วมันก็หลับไปด้วย

**ชั้นที่ 2 — ยิงจากข้างนอก** (ต้องตั้งเอง แนะนำให้ทำ)
1. สมัคร https://cron-job.org (ฟรี)
2. สร้าง cronjob ใหม่ ตั้ง URL เป็น `https://ชื่อ-service.onrender.com/health`
3. ตั้งความถี่ทุก **10 นาที**

ชั้นนี้จำเป็นเพราะเป็นตัวเดียวที่**ปลุกเครื่องที่หลับไปแล้ว**ให้ตื่นได้

### โควต้าของแพ็กเกจฟรี

Render ให้เวลาทำงาน **750 ชั่วโมง/เดือน** ส่วนหนึ่งเดือนมีราว 730 ชั่วโมง
การกันไม่ให้หลับ = เครื่องทำงานตลอดเวลา = ใช้โควต้าเกือบเต็ม เหลือเผื่อแค่ ~20 ชั่วโมง

ข้อควรระวัง:
- โควต้านี้**นับรวมทุก service ในบัญชี** ถ้าสร้าง service ที่สองขึ้นมารันคู่กัน โควต้าจะหมดกลางเดือนและบอทจะดับ
- ถ้าโควต้าหมด บอทจะหยุดจนกว่าจะขึ้นเดือนใหม่
- ถ้าถึงจุดที่รับความเสี่ยงนี้ไม่ได้ ให้เปลี่ยน `plan: free` เป็น `plan: starter` ($7/เดือน) แล้วลบ cronjob ทิ้ง

## ขึ้น production ต้องแก้อะไรบ้าง

สองจุดนี้คือข้อจำกัดที่รู้ตัวอยู่แล้ว ไม่ใช่บั๊ก

1. **`src/conversation.js` เก็บใน memory** → หายเมื่อ restart และใช้ไม่ได้ถ้ารันหลาย instance
   ถ้าจะขยาย ให้เปลี่ยนไปใช้ Redis หรือฐานข้อมูล
2. **ประมวลผลใน process เดียว** → ถ้าคนใช้เยอะพร้อมกัน ควรแยกเป็น queue (BullMQ / Cloud Tasks)

deploy ได้ที่ Cloud Run, Render, Railway หรือ VPS ที่มี HTTPS
อย่าลืมย้ายค่าใน `.env` ไปตั้งเป็น environment variable ของ platform นั้น และห้าม commit ไฟล์ `.env`
