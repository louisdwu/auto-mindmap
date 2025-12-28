/**
 * 图标生成脚本
 * 
 * 此脚本用于将SVG图标转换为不同尺寸的PNG图标
 * 需要安装 sharp 包: npm install sharp --save-dev
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sizes = [16, 32, 48, 128];
const svgPath = path.join(__dirname, '../public/icons/icon.svg');
const outputDir = path.join(__dirname, '../public/icons');

async function generateIcons() {
  try {
    // 检查SVG文件是否存在
    if (!fs.existsSync(svgPath)) {
      console.error('SVG图标文件不存在:', svgPath);
      process.exit(1);
    }

    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 生成不同尺寸的PNG图标
    for (const size of sizes) {
      const outputPath = path.join(outputDir, `icon${size}.png`);
      
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`✓ 生成 icon${size}.png (${size}x${size})`);
    }

    console.log('\n所有图标生成完成！');
  } catch (error) {
    console.error('生成图标时出错:', error);
    process.exit(1);
  }
}

// 运行脚本
generateIcons();