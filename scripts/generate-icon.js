const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// 16x16 PNG icon
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA7SURBVDhPY2AYmEAHxP//D1WMCxgGfB1o5hgYqG4An/pRF4w6gAcGYI01D1VMCgM4k0k1A/7//w83DgC0r2sH7K7/fQAAAABJRU5ErkJggg==';
const pngBuffer = Buffer.from(pngBase64, 'base64');
fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuffer);

// Basic standard ICO file structure containing the PNG image
// Header: 0, 0, 1 (type 1 for icon), 1 (number of images)
const header = Buffer.from([0, 0, 1, 0, 1, 0]);
// Directory entry: width (16), height (16), colors (0), reserved (0), planes (1, 0), bpp (32, 0), size (4 bytes), offset (4 bytes: 6 + 16 = 22)
const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(16, 0); // width
dirEntry.writeUInt8(16, 1); // height
dirEntry.writeUInt8(0, 2);  // colors
dirEntry.writeUInt8(0, 3);  // reserved
dirEntry.writeUInt16LE(1, 4); // color planes
dirEntry.writeUInt16LE(32, 6); // bits per pixel
dirEntry.writeUInt32LE(pngBuffer.length, 8); // image size
dirEntry.writeUInt32LE(22, 12); // image offset

const icoBuffer = Buffer.concat([header, dirEntry, pngBuffer]);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoBuffer);

console.log('Icon assets generated in assets/ directory.');
