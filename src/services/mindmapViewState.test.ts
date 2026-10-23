import { describe, it, expect, beforeEach } from 'vitest';
import { MindmapViewStateService } from './mindmapViewState';

describe('MindmapViewStateService', () => {
  beforeEach(() => {
    MindmapViewStateService.clear();
  });

  it('保存后可读回展开状态与画布位置', () => {
    const key = MindmapViewStateService.createKey('id:abc');
    MindmapViewStateService.save(key, {
      expandedIds: ['node-0', 'node-3'],
      scale: 1.25,
      offset: { x: 120, y: 240 }
    });

    const snapshot = MindmapViewStateService.get(key);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.expandedIds).toEqual(['node-0', 'node-3']);
    expect(snapshot!.scale).toBe(1.25);
    expect(snapshot!.offset).toEqual({ x: 120, y: 240 });
  });

  it('读取结果为副本，外部修改不会污染缓存', () => {
    const key = MindmapViewStateService.createKey('id:copy');
    MindmapViewStateService.save(key, { expandedIds: ['node-1'], scale: 1, offset: { x: 0, y: 0 } });

    const snapshot = MindmapViewStateService.get(key)!;
    snapshot.expandedIds.push('node-9');
    snapshot.offset!.x = 999;

    const fresh = MindmapViewStateService.get(key)!;
    expect(fresh.expandedIds).toEqual(['node-1']);
    expect(fresh.offset).toEqual({ x: 0, y: 0 });
  });

  it('未知键与空键返回 null', () => {
    expect(MindmapViewStateService.get('not-exist')).toBeNull();
    expect(MindmapViewStateService.get(undefined)).toBeNull();
    expect(MindmapViewStateService.get('')).toBeNull();
  });

  it('相同内容生成相同键，不同内容生成不同键', () => {
    expect(MindmapViewStateService.createKey('same')).toBe(MindmapViewStateService.createKey('same'));
    expect(MindmapViewStateService.createKey('same')).not.toBe(MindmapViewStateService.createKey('other'));
  });

  it('超出容量时按最久未使用淘汰', () => {
    const firstKey = MindmapViewStateService.createKey('k-0');
    for (let i = 0; i < 30; i++) {
      MindmapViewStateService.save(MindmapViewStateService.createKey(`k-${i}`), {
        expandedIds: [],
        scale: 1,
        offset: { x: 0, y: 0 }
      });
    }
    expect(MindmapViewStateService.size()).toBe(30);

    // 再写入一条，最早的键被淘汰
    MindmapViewStateService.save(MindmapViewStateService.createKey('k-30'), {
      expandedIds: [],
      scale: 1,
      offset: { x: 0, y: 0 }
    });
    expect(MindmapViewStateService.size()).toBe(30);
    expect(MindmapViewStateService.get(firstKey)).toBeNull();
    expect(MindmapViewStateService.get(MindmapViewStateService.createKey('k-30'))).not.toBeNull();
  });

  it('clear 可定向清除单个键', () => {
    const a = MindmapViewStateService.createKey('a');
    const b = MindmapViewStateService.createKey('b');
    MindmapViewStateService.save(a, { expandedIds: ['node-1'] });
    MindmapViewStateService.save(b, { expandedIds: ['node-2'] });

    MindmapViewStateService.clear(a);
    expect(MindmapViewStateService.get(a)).toBeNull();
    expect(MindmapViewStateService.get(b)?.expandedIds).toEqual(['node-2']);
  });
});
