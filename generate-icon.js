const sharp = require('sharp');
const { imagesToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

// 终端风格图标 SVG：圆角矩形背景 + >_ 提示符 + 分屏线条
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#313244"/>
      <stop offset="100%" style="stop-color:#1e1e2e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#89b4fa"/>
      <stop offset="100%" style="stop-color:#94e2d5"/>
    </linearGradient>
  </defs>

  <!-- 背景圆角矩形 -->
  <rect x="16" y="16" width="224" height="224" rx="40" ry="40" fill="url(#bg)"/>

  <!-- 顶部标题栏 -->
  <rect x="16" y="16" width="224" height="40" rx="40" ry="40" fill="#181825"/>
  <rect x="16" y="36" width="224" height="20" fill="#181825"/>

  <!-- 标题栏圆点 -->
  <circle cx="48" cy="36" r="6" fill="#f38ba8"/>
  <circle cx="68" cy="36" r="6" fill="#f9e2af"/>
  <circle cx="88" cy="36" r="6" fill="#a6e3a1"/>

  <!-- 分屏竖线 -->
  <line x1="128" y1="56" x2="128" y2="240" stroke="#45475a" stroke-width="2"/>

  <!-- 左侧面板: > 提示符 -->
  <text x="40" y="110" font-family="Consolas, monospace" font-size="48" font-weight="bold" fill="url(#accent)">&gt;_</text>

  <!-- 左侧面板: 模拟文本行 -->
  <rect x="40" y="130" width="60" height="4" rx="2" fill="#585b70"/>
  <rect x="40" y="145" width="45" height="4" rx="2" fill="#585b70"/>

  <!-- 右侧面板: > 提示符 -->
  <text x="148" y="110" font-family="Consolas, monospace" font-size="48" font-weight="bold" fill="#cba6f7">&gt;_</text>

  <!-- 右侧面板: 模拟文本行 -->
  <rect x="148" y="130" width="55" height="4" rx="2" fill="#585b70"/>
  <rect x="148" y="145" width="70" height="4" rx="2" fill="#585b70"/>
  <rect x="148" y="160" width="40" height="4" rx="2" fill="#585b70"/>

  <!-- 底部光标闪烁效果 (左侧) -->
  <rect x="40" y="165" width="10" height="16" rx="1" fill="#89b4fa" opacity="0.8"/>
</svg>
`;

async function generate() {
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngBuffers = [];

  for (const size of sizes) {
    const buf = await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(buf);
  }

  // 保存 256px PNG
  fs.writeFileSync(path.join(__dirname, 'icon.png'), pngBuffers[0]);
  console.log('icon.png (256x256) 已生成');

  // 生成 ICO（包含多种尺寸）- 使用 PNG 嵌入格式，兼容 rcedit
  const pngImages = [];
  for (const size of sizes) {
    const buf = await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toBuffer();
    pngImages.push(buf);
  }

  // 手动构建 ICO 文件（PNG 嵌入格式）
  const numImages = pngImages.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dataOffset = headerSize + dirEntrySize * numImages;

  // ICO header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: 1 = ICO
  header.writeUInt16LE(numImages, 4);

  // Directory entries + image data
  const dirEntries = [];
  const imageDataParts = [];
  let currentOffset = dataOffset;

  for (let i = 0; i < numImages; i++) {
    const size = sizes[i];
    const pngBuf = pngImages[i];
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);   // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);   // height
    entry.writeUInt8(0, 2);                          // color palette
    entry.writeUInt8(0, 3);                          // reserved
    entry.writeUInt16LE(1, 4);                       // color planes
    entry.writeUInt16LE(32, 6);                      // bits per pixel
    entry.writeUInt32LE(pngBuf.length, 8);           // image size
    entry.writeUInt32LE(currentOffset, 12);          // offset
    dirEntries.push(entry);
    imageDataParts.push(pngBuf);
    currentOffset += pngBuf.length;
  }

  const icoBuffer = Buffer.concat([header, ...dirEntries, ...imageDataParts]);
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), icoBuffer);
  console.log('icon.ico 已生成 (' + (icoBuffer.length / 1024).toFixed(1) + ' KB)');
}

generate().catch(console.error);
