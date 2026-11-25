// Genera assets/icon.png (256x256) y assets/icon.ico para Exum sin dependencias externas
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function wrapPngAsIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(1, 4); // 1 image

  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256px
  entry[1] = 0; // 256px
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12); // offset after header+entry

  return Buffer.concat([header, entry, pngBuffer]);
}

// Dibuja el emblema de Exum: fondo obsidian redondeado, borde rojo vino y barras de ecualizador + triángulo Play
const rgba = Buffer.alloc(SIZE * SIZE * 4);

function setPx(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  rgba[idx] = r;
  rgba[idx + 1] = g;
  rgba[idx + 2] = b;
  rgba[idx + 3] = a;
}

function insideRoundedRect(x, y, pad, rad) {
  const x0 = pad;
  const y0 = pad;
  const x1 = SIZE - 1 - pad;
  const y1 = SIZE - 1 - pad;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + rad ? x0 + rad : x > x1 - rad ? x1 - rad : x;
  const cy = y < y0 + rad ? y0 + rad : y > y1 - rad ? y1 - rad : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

const bars = [
  { x0: 44, x1: 68, top: 132 },
  { x0: 78, x1: 102, top: 84 },
  { x0: 112, x1: 136, top: 60 },
  { x0: 146, x1: 170, top: 98 },
  { x0: 180, x1: 204, top: 72 },
];

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!insideRoundedRect(x, y, 8, 42)) {
      setPx(x, y, 0, 0, 0, 0);
      continue;
    }

    // Borde exterior vino
    if (!insideRoundedRect(x, y, 16, 36)) {
      setPx(x, y, 201, 59, 82, 255); // #c93b52
      continue;
    }

    // Fondo degradado oscuro obsidian -> vino muy profundo
    const t = y / SIZE;
    const bgR = Math.round(14 + t * 24);
    const bgG = Math.round(9 + t * 6);
    const bgB = Math.round(11 + t * 12);
    setPx(x, y, bgR, bgG, bgB, 255);

    // Barras de ecualizador estilo Winamp (segmentadas cada 14px)
    for (const bar of bars) {
      if (x >= bar.x0 && x <= bar.x1 && y >= bar.top && y <= 200) {
        const segOffset = (200 - y) % 14;
        if (segOffset < 10) {
          if (y < bar.top + 12) {
            setPx(x, y, 252, 231, 235, 255); // pico blanco rosado #fce7eb
          } else {
            const grad = (y - 60) / 140;
            const r = Math.round(225 - grad * 75);
            const g = Math.round(70 - grad * 38);
            const b = Math.round(98 - grad * 48);
            setPx(x, y, r, g, b, 255);
          }
        }
      }
    }
  }
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const png = encodePng(SIZE, SIZE, rgba);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), wrapPngAsIco(png));
console.log('Generated assets/icon.png and assets/icon.ico');
