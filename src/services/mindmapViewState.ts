/**
 * 思维导图视图状态服务
 *
 * 背景：导图渲染组件（MindmapRenderer）在「点击时间戳跳转视频并关闭查看器」
 * 「切换 Markdown 视图」等场景下会被卸载，重新打开时展开状态与画布位置
 * 会退回默认值。本服务在内存中按导图维度缓存这些视图状态，用于重新挂载
 * 时还原，让用户回到之前浏览导图的现场。
 */

/** 单张导图的视图快照 */
export interface MindmapViewSnapshot {
  /** 处于展开状态的节点 id 集合（根节点除外，根节点始终展开） */
  expandedIds: string[];
  /** 画布缩放比例 */
  scale?: number;
  /** 画布平移偏移 */
  offset?: { x: number; y: number };
}

/** 最多缓存多少张导图的视图状态，超出后按 LRU 淘汰 */
const MAX_ENTRIES = 30;

/** djb2 变体，生成稳定、短小的缓存键 */
function hashSeed(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash) ^ seed.charCodeAt(i);
  }
  return `${(hash >>> 0).toString(36)}-${seed.length.toString(36)}`;
}

function cloneSnapshot(snapshot: MindmapViewSnapshot): MindmapViewSnapshot {
  return {
    expandedIds: [...snapshot.expandedIds],
    scale: snapshot.scale,
    offset: snapshot.offset ? { x: snapshot.offset.x, y: snapshot.offset.y } : undefined
  };
}

export class MindmapViewStateService {
  /** 键 -> 快照；Map 的插入顺序天然可用于实现 LRU */
  private static cache = new Map<string, MindmapViewSnapshot>();

  /**
   * 生成导图视图状态的缓存键。
   * 同一份导图（同一 id 或同一 Markdown 内容）始终得到同一个键。
   */
  static createKey(seed: string): string {
    return `mmv-${hashSeed(seed)}`;
  }

  /** 读取视图快照（返回副本，调用方可自由修改） */
  static get(key: string | undefined | null): MindmapViewSnapshot | null {
    if (!key) return null;
    const snapshot = this.cache.get(key);
    if (!snapshot) return null;
    // 命中即刷新 LRU 顺序
    this.cache.delete(key);
    this.cache.set(key, snapshot);
    return cloneSnapshot(snapshot);
  }

  /** 写入视图快照 */
  static save(key: string | undefined | null, snapshot: MindmapViewSnapshot): void {
    if (!key) return;
    this.cache.delete(key);
    this.cache.set(key, cloneSnapshot(snapshot));
    while (this.cache.size > MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  /** 删除单张导图的视图快照；不传键时清空全部 */
  static clear(key?: string): void {
    if (key === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(key);
  }

  /** 当前缓存的导图数量（测试与调试用） */
  static size(): number {
    return this.cache.size;
  }
}
