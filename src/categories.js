/**
 * หมวดหลักของหนังสือ กฎทุกข้อต้องอยู่ในหมวดใดหมวดหนึ่งในนี้ และแต่ละหมวดคือหนึ่งบทในหนังสือ
 * บทในหนังสือและในหน้าผู้ดูแลเรียงตามลำดับในรายการนี้
 *
 * scope บอก AI ว่าหมวดไหนเก็บเรื่องอะไร ใช้ทั้งตอนจดกฎใหม่และตอนย้ายกฎเก่าเข้าหมวด
 * จะเพิ่ม ลด หรือเปลี่ยนชื่อหมวด แก้ที่นี่ที่เดียว กฎที่อยู่ในชื่อหมวดที่ไม่มีแล้ว
 * จะถูก AI ย้ายเข้าหมวดใหม่ให้เองตอนเปิดเครื่องครั้งถัดไป (ดู recategorize.js)
 */
export const CATEGORIES = [
  {
    name: 'Machine',
    scope: 'เครื่องจักร ข้อเท็จจริงของตัวเครื่องทุกเรื่อง เช่น ชนิดและความหมายของเครื่อง สเปก จำนวนฟีดเดอร์ CAP ของเครื่อง กลุ่มเครื่อง (MC Group) ไอเท็มหรือโครงสร้างผ้าที่เครื่องทอได้ การตั้งเครื่อง เครื่องทดแทน และ Spare Part',
  },
  {
    name: 'การวางแผน',
    scope: 'วิธีคิดและขั้นตอนการวางแผนการผลิตและแผนทอ เช่น สูตรคำนวณกำลังการผลิต (Capacity) การเลือกเครื่องให้แต่ละ Order การจัดลำดับงาน การลงแผนในระบบ และการคุมปริมาณผ้าดิบ',
  },
  {
    name: 'Order Management',
    scope: 'การรับและดูแล Order ข้อมูลและ Requirement ของลูกค้า กำหนดส่ง การติดตามสถานะ การแก้ไขหรือยกเลิก Order และการส่งมอบ',
  },
  {
    name: 'ศัพท์เฉพาะ',
    scope: 'ความหมายของคำศัพท์และคำย่อที่ใช้ในงาน ชื่อเรียกวัสดุ เส้นด้าย สินค้า หรือสถานะ และคำที่ต้องสะกดหรือใช้ให้ถูก (ยกเว้นความหมายของชนิดเครื่อง ให้อยู่ Machine)',
  },
  {
    name: 'อื่นๆ',
    scope: 'เรื่องที่ไม่เข้ากับหมวดไหนข้างบนเลย',
  },
];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
/** หมวดเครื่องจักร บทนี้ในหนังสือมีตาราง Master MC ต่อท้ายคำอธิบาย (ดู master-mc.js) */
export const MACHINE_CATEGORY = 'Machine';
export const FALLBACK_CATEGORY = 'อื่นๆ';

const squash = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, '');

// ชื่อที่ AI หรือคนพิมพ์มาไม่ตรงตัว แต่หมายถึงหมวดเดียวกัน
const ALIASES = new Map(
  [
    ...CATEGORY_NAMES.map((name) => [name, name]),
    ['mc', 'Machine'],
    ['m/c', 'Machine'],
    ['เครื่องจักร', 'Machine'],
    ['วางแผน', 'การวางแผน'],
    ['planning', 'การวางแผน'],
    ['order', 'Order Management'],
    ['ศัพท์เฉพราะ', 'ศัพท์เฉพาะ'],
    ['คำศัพท์', 'ศัพท์เฉพาะ'],
    ['อื่น', 'อื่นๆ'],
    ['other', 'อื่นๆ'],
    ['others', 'อื่นๆ'],
  ].map(([alias, name]) => [squash(alias), name]),
);

export const isCategory = (value) => CATEGORY_NAMES.includes(value);

/** ชื่อหมวดที่ถูกต้องของชื่อที่ได้มา หรือ null ถ้าไม่ตรงหมวดไหนเลย */
export const matchCategory = (value) => ALIASES.get(squash(value)) ?? null;

/** เหมือน matchCategory แต่ชื่อที่ไม่ตรงหมวดไหนเลยให้ไปอยู่ "อื่นๆ" */
export const toCategory = (value) => matchCategory(value) ?? FALLBACK_CATEGORY;

export const categoryScope = (name) => CATEGORIES.find((c) => c.name === name)?.scope ?? '';

/** รายชื่อหมวดพร้อมขอบเขตและวิธีเลือกเมื่อเข้าได้หลายหมวด สำหรับใส่ใน prompt */
export const CATEGORY_GUIDE = [
  ...CATEGORIES.map((c) => `  - "${c.name}" = ${c.scope}`),
  '  ถ้าเข้าได้หลายหมวด: ข้อเท็จจริงของตัวเครื่องอยู่ "Machine" แม้กฎจะบอกว่าเอาไปใช้ตอนวางแผน ส่วนขั้นตอนหรือวิธีตัดสินใจอยู่หมวดของงานนั้น',
  `  ใช้ "${FALLBACK_CATEGORY}" เฉพาะเมื่อไม่เข้าหมวดไหนเลยจริง ๆ`,
].join('\n');

/**
 * เรียงชื่อบทตามลำดับหมวด ชื่อที่ไม่ใช่หมวด (ข้อมูลเก่าที่ยังไม่ได้ย้าย) ต่อท้ายเรียงตามตัวอักษร
 */
export function byCategory(a, b) {
  const rank = (name) => (isCategory(name) ? CATEGORY_NAMES.indexOf(name) : CATEGORY_NAMES.length);
  return rank(a) - rank(b) || a.localeCompare(b, 'th');
}
