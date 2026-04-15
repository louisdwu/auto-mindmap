/**
 * 思维导图导出工具
 * 将思维导图渲染为 PNG 图片或 PDF 文件
 *
 * 设计：利用已有的 layout 引擎计算全展开节点位置，
 * 在离屏 Canvas 上重绘节点和贝塞尔连线，然后导出。
 */

import { INodeData, parseMarkdown } from './markdownParser';
import {
  calculateLayout, calculateLayoutBounds,
  generateLinkPath, NodePosition, LayoutOptions
} from './layout';

// 分支颜色（与 CSS 中 branch-0~4 保持一致）
const BRANCH_COLORS = ['#b3005b', '#ff80cc', '#2b00b3', '#5c3daf', '#cc80ff'];

const ROOT_STYLE = {
  bg: '#0099ff',
  color: '#ffffff',
  radius: 6,
  shadowColor: 'rgba(0, 153, 255, 0.3)',
  shadowBlur: 12,
  shadowOffsetY: 4
};

const EXPORT_PADDING = 60;
const TITLE_BAR_HEIGHT = 48;
const DPR = 2;

export interface ExportOptions {
  markdown: string;
  title: string;
  format: 'png' | 'pdf';
  layoutOptions?: Partial<LayoutOptions>;
  fontSizeBase?: number;
}

/** 强制展开所有节点 */
function expandAllNodes(node: INodeData): INodeData {
  return {
    ...node,
    expanded: true,
    children: node.children.map(expandAllNodes)
  };
}

/** 获取节点所属的一级分支索引 */
function getBranchIndex(nodeId: string, root: INodeData): number {
  if (nodeId === 'root') return -1;
  for (let i = 0; i < root.children.length; i++) {
    if (isDescendant(root.children[i], nodeId)) return i % 5;
  }
  return -1;
}

function isDescendant(node: INodeData, targetId: string): boolean {
  if (node.id === targetId) return true;
  return node.children.some(c => isDescendant(c, targetId));
}

/** 绘制贝塞尔连线 */
function drawLink(
  ctx: CanvasRenderingContext2D,
  from: NodePosition,
  to: NodePosition,
  branchIndex: number
): void {
  const pathStr = generateLinkPath(from, to);
  const match = pathStr.match(
    /M\s+([\d.-]+)\s+([\d.-]+)\s+C\s+([\d.-]+)\s+([\d.-]+),\s*([\d.-]+)\s+([\d.-]+),\s*([\d.-]+)\s+([\d.-]+)/
  );
  if (!match) return;

  const nums = match.slice(1).map(Number);
  const [mx, my, c1x, c1y, c2x, c2y, ex, ey] = nums;

  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);

  const levelWidths = [2.5, 2, 1.5, 1.2, 1];
  ctx.lineWidth = levelWidths[Math.min(to.level, 4)] || 1;
  ctx.strokeStyle = branchIndex >= 0 ? BRANCH_COLORS[branchIndex] : '#94a3b8';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** 绘制圆角矩形 */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** 绘制节点 */
function drawNode(
  ctx: CanvasRenderingContext2D,
  pos: NodePosition,
  branchIndex: number
): void {
  const isRoot = pos.id === 'root';
  const x = pos.x - pos.width / 2;
  const y = pos.y - pos.baseHeight / 2;

  if (isRoot) {
    ctx.save();
    ctx.shadowColor = ROOT_STYLE.shadowColor;
    ctx.shadowBlur = ROOT_STYLE.shadowBlur;
    ctx.shadowOffsetY = ROOT_STYLE.shadowOffsetY;
    drawRoundRect(ctx, x, y, pos.width, pos.baseHeight, ROOT_STYLE.radius);
    ctx.fillStyle = ROOT_STYLE.bg;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = ROOT_STYLE.color;
    ctx.font = `600 ${pos.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pos.text, pos.x, pos.y);
  } else {
    const color = branchIndex >= 0 ? BRANCH_COLORS[branchIndex] : '#444';
    const fontWeight = pos.level <= 2 ? '500' : '400';
    ctx.fillStyle = color;
    ctx.font = `${fontWeight} ${pos.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pos.text, x, pos.y);

    // 下划线
    const underlineY = pos.y + pos.baseHeight / 2;
    ctx.beginPath();
    ctx.moveTo(x, underlineY);
    ctx.lineTo(x + pos.width, underlineY);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** 绘制标题栏 */
function drawTitleBar(
  ctx: CanvasRenderingContext2D,
  title: string,
  canvasWidth: number
): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, TITLE_BAR_HEIGHT);

  ctx.beginPath();
  ctx.moveTo(0, TITLE_BAR_HEIGHT);
  ctx.lineTo(canvasWidth, TITLE_BAR_HEIGHT);
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#374151';
  ctx.font = '500 14px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const maxTitleWidth = canvasWidth - 32;
  let displayTitle = title;
  if (ctx.measureText(displayTitle).width > maxTitleWidth) {
    while (ctx.measureText(displayTitle + '...').width > maxTitleWidth && displayTitle.length > 0) {
      displayTitle = displayTitle.slice(0, -1);
    }
    displayTitle += '...';
  }
  ctx.fillText(displayTitle, 16, TITLE_BAR_HEIGHT / 2);
}

/**
 * 核心导出函数
 */
export async function exportMindmap(options: ExportOptions): Promise<void> {
  const { markdown, title, format, fontSizeBase = 1.0 } = options;

  const parsed = parseMarkdown(markdown);
  const expanded = expandAllNodes(parsed);

  const layoutOpts: Partial<LayoutOptions> = {
    direction: 'right',
    horizontalSpacing: 140,
    verticalSpacing: 20,
    nodeWidth: 100,
    nodeHeight: 32,
    centerOffset: 0,
    levelSpacingMultiplier: 0.85,
    fontSizeBase,
    ...options.layoutOptions
  };

  const positions = calculateLayout(expanded, layoutOpts);
  const bounds = calculateLayoutBounds(positions);

  const contentWidth = bounds.width + EXPORT_PADDING * 2;
  const contentHeight = bounds.height + EXPORT_PADDING * 2 + TITLE_BAR_HEIGHT;

  const canvas = document.createElement('canvas');
  canvas.width = contentWidth * DPR;
  canvas.height = contentHeight * DPR;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPR, DPR);

  // 白色背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, contentWidth, contentHeight);

  // 标题栏
  drawTitleBar(ctx, title, contentWidth);

  // 坐标偏移
  const offsetX = -bounds.minX + EXPORT_PADDING;
  const offsetY = -bounds.minY + EXPORT_PADDING + TITLE_BAR_HEIGHT;
  ctx.save();
  ctx.translate(offsetX, offsetY);

  // 先绘制连线
  positions.forEach((pos, id) => {
    if (pos.parentId && pos.parentId !== 'root') {
      const parentPos = positions.get(pos.parentId);
      if (parentPos) {
        drawLink(ctx, parentPos, pos, getBranchIndex(id, expanded));
      }
    }
  });

  // 再绘制节点
  positions.forEach((pos) => {
    if (pos.id === 'root') return;
    drawNode(ctx, pos, getBranchIndex(pos.id, expanded));
  });

  ctx.restore();

  // 导出
  if (format === 'png') {
    const blob = await canvasToBlob(canvas, 'image/png');
    downloadBlob(blob, `${title}_思维导图.png`);
  } else {
    await exportAsPdf(canvas, title);
  }
}

/** Canvas 转 Blob */
function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob 失败'));
    }, type);
  });
}

/** 下载 Blob */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Data URL → Uint8Array */
function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 导出为 PDF（Canvas → JPEG → 嵌入 PDF） */
async function exportAsPdf(
  canvas: HTMLCanvasElement,
  title: string
): Promise<void> {
  const jpegBytes = dataUrlToUint8Array(canvas.toDataURL('image/jpeg', 0.95));
  const imgW = canvas.width;
  const imgH = canvas.height;

  const maxPageWidth = 842;
  const scaleRatio = maxPageWidth / imgW;
  const pageW = imgW * scaleRatio;
  const pageH = imgH * scaleRatio;

  const pdfBytes = assemblePdf(jpegBytes, imgW, imgH, pageW, pageH);
  downloadBlob(
    new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
    `${title}_思维导图.pdf`
  );
}

/**
 * 手动拼装 PDF 1.4（JPEG 图片嵌入）
 * 无第三方依赖，纯前端生成
 */
function assemblePdf(
  jpegBytes: Uint8Array,
  imgW: number, imgH: number,
  pageW: number, pageH: number
): Uint8Array {
  const parts: (string | Uint8Array)[] = [];
  const objOffsets: number[] = [];
  let currentOffset = 0;

  const writeStr = (s: string) => { parts.push(s); currentOffset += s.length; };
  const writeBytes = (b: Uint8Array) => { parts.push(b); currentOffset += b.length; };
  const markObj = () => { objOffsets.push(currentOffset); };

  writeStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // 1: Catalog
  markObj();
  writeStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2: Pages
  markObj();
  writeStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // 3: Page
  markObj();
  writeStr(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Img 5 0 R >> >> >>\nendobj\n`);

  // 4: Content stream
  const cs = `q\n${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm\n/Img Do\nQ\n`;
  markObj();
  writeStr(`4 0 obj\n<< /Length ${cs.length} >>\nstream\n`);
  writeStr(cs);
  writeStr('endstream\nendobj\n');

  // 5: Image XObject (JPEG / DCTDecode)
  markObj();
  writeStr(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  writeBytes(jpegBytes);
  writeStr('\nendstream\nendobj\n');

  // xref
  const xrefOffset = currentOffset;
  writeStr('xref\n');
  writeStr(`0 ${objOffsets.length + 1}\n`);
  writeStr('0000000000 65535 f \n');
  for (const off of objOffsets) {
    writeStr(`${String(off).padStart(10, '0')} 00000 n \n`);
  }

  writeStr('trailer\n');
  writeStr(`<< /Size ${objOffsets.length + 1} /Root 1 0 R >>\n`);
  writeStr('startxref\n');
  writeStr(`${xrefOffset}\n`);
  writeStr('%%EOF\n');

  // 合并
  const totalLen = parts.reduce(
    (acc, p) => acc + (typeof p === 'string' ? p.length : p.length), 0
  );
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of parts) {
    if (typeof part === 'string') {
      for (let i = 0; i < part.length; i++) result[pos++] = part.charCodeAt(i);
    } else {
      result.set(part, pos);
      pos += part.length;
    }
  }
  return result;
}
