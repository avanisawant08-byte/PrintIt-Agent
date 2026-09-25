const { nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'assets', 'logo_cropped.png');
const img = nativeImage.createFromPath(src);
console.log('Original logo size:', img.getSize());

// Generate icon.png (256x256 high-res for windows/taskbar)
const icon256 = img.resize({ width: 256, height: 256, quality: 'best' });
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), icon256.toPNG());

// Generate icon32.png (32x32 for system tray)
const icon32 = img.resize({ width: 32, height: 32, quality: 'best' });
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon32.png'), icon32.toPNG());

function createIco(pngBuffers) {
  const count = pngBuffers.length;
  let headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = [];
  
  for (const buf of pngBuffers) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    entries.push({
      width: w >= 256 ? 0 : w,
      height: h >= 256 ? 0 : h,
      colorCount: 0,
      reserved: 0,
      planes: 1,
      bitCount: 32,
      bytesInRes: buf.length,
      imageOffset: offset,
      buffer: buf
    });
    offset += buf.length;
  }
  
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  
  const entryBuffers = entries.map(e => {
    const b = Buffer.alloc(16);
    b.writeUInt8(e.width, 0);
    b.writeUInt8(e.height, 1);
    b.writeUInt8(e.colorCount, 2);
    b.writeUInt8(e.reserved, 3);
    b.writeUInt16LE(e.planes, 4);
    b.writeUInt16LE(e.bitCount, 6);
    b.writeUInt32LE(e.bytesInRes, 8);
    b.writeUInt32LE(e.imageOffset, 12);
    return b;
  });
  
  return Buffer.concat([header, ...entryBuffers, ...entries.map(e => e.buffer)]);
}

const icoBuf = createIco([
  img.resize({ width: 16, height: 16, quality: 'best' }).toPNG(),
  img.resize({ width: 32, height: 32, quality: 'best' }).toPNG(),
  img.resize({ width: 48, height: 48, quality: 'best' }).toPNG(),
  img.resize({ width: 64, height: 64, quality: 'best' }).toPNG(),
  img.resize({ width: 128, height: 128, quality: 'best' }).toPNG(),
  img.resize({ width: 256, height: 256, quality: 'best' }).toPNG()
]);

fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.ico'), icoBuf);
console.log('Icon generation successful! ICO bytes:', icoBuf.length);
process.exit(0);
