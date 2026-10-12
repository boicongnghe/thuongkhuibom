// Tạo desktop/icon.png (256×256): ô vuông bo góc màu tím + dấu tích trắng.
// Chạy lại khi muốn đổi màu: node desktop/make-icon.js
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256;
const BG = [79, 70, 229];        // #4F46E5
const FG = [255, 255, 255];
const R = 56;                    // bán kính bo góc
const STROKE = 22;               // độ dày nét tích
const CHECK = [[70, 134], [112, 176], [190, 92]];

function distToSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Độ phủ của ô vuông bo góc tại (x, y) — khử răng cưa 1px
function roundRectCoverage(x, y) {
  const cx = Math.min(Math.max(x, R), S - R), cy = Math.min(Math.max(y, R), S - R);
  const d = Math.hypot(x - cx, y - cy) - R;
  return Math.max(0, Math.min(1, 0.5 - d));
}

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;     // filter: none
  for (let x = 0; x < S; x++) {
    const px = x + 0.5, py = y + 0.5;
    const bgA = roundRectCoverage(px, py);
    const d = Math.min(distToSeg(px, py, CHECK[0], CHECK[1]), distToSeg(px, py, CHECK[1], CHECK[2]));
    const fgA = Math.max(0, Math.min(1, STROKE / 2 + 0.5 - d)) * (bgA > 0 ? 1 : 0);
    const o = y * (S * 4 + 1) + 1 + x * 4;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - fgA) + FG[c] * fgA);
    raw[o + 3] = Math.round(255 * bgA);
  }
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('Đã tạo desktop/icon.png', png.length, 'bytes');
