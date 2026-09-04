/**
 * Generates the extension icons as PNG files at build time, so no binary
 * assets need to be committed. Draws a simple ring with a centre dot.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import zlib from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Render an RGBA ring icon of the given size and return PNG bytes. */
export function makeIconPng(size) {
  const [r, g, b] = [79, 70, 229]; // indigo
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outer = size / 2 - 0.5;
  const inner = outer * 0.62;
  const dot = outer * 0.28;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const ring = clamp01(outer - d + 0.5) * clamp01(d - inner + 0.5);
      const centre = clamp01(dot - d + 0.5);
      const a = Math.round(255 * Math.max(ring, centre));
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function generateIcons(dir, sizes = [16, 32, 48, 128]) {
  await mkdir(dir, { recursive: true });
  for (const s of sizes) await writeFile(join(dir, `icon${s}.png`), makeIconPng(s));
}
