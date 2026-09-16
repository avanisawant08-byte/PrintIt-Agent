const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy UI assets to dist/ui
const uiSrc = path.join(__dirname, '..', 'src', 'ui');
const uiDest = path.join(__dirname, '..', 'dist', 'ui');
if (fs.existsSync(uiSrc)) {
  if (!fs.existsSync(uiDest)) {
    fs.mkdirSync(uiDest, { recursive: true });
  }
  const files = fs.readdirSync(uiSrc);
  for (const file of files) {
    if (file.endsWith('.html') || file.endsWith('.css')) {
      fs.copyFileSync(path.join(uiSrc, file), path.join(uiDest, file));
      console.log(`Copied ${file} to dist/ui/`);
    }
  }
}

console.log('Asset copying completed.');
