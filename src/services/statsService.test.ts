import { beforeEach, describe, expect, it, vi } from 'vitest';

let store: Record<string, any>;

beforeEach(() => {
  vi.resetModules();
  store = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key?: string) => (key && key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, any>) => {
          for (const [key, value] of Object.entries(items)) store[key] = JSON.parse(JSON.stringify(value));
        }),
        remove: vi.fn(async (key: string) => { delete store[key]; })
      },
      sync: {
        get: vi.fn(async (key?: string) => (key && key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, any>) => {
          for (const [key, value] of Object.entries(items)) store[key] = JSON.parse(JSON.stringify(value));
        }),
        remove: vi.fn(async (key: string) => { delete store[key]; })
      }
    }
  };
});

async function load() {
  return import('./statsService');
}

describe('StatsService token 与每日去重', () => {
  it('累计 token、模型 token 与每日去重视频数', async () => {
    const { StatsService } = await load();

    await StatsService.recordGeneration({
      videoId: 'BV1_p1',
      modelId: 'm1',
      isReflectionEnabled: false,
      isSuccess: true,
      inputTokens: 100,
      outputTokens: 20
    });
    await StatsService.recordGeneration({
      videoId: 'BV1_p1',
      modelId: 'm1',
      isReflectionEnabled: false,
      isSuccess: true,
      inputTokens: 50,
      outputTokens: 10
    });

    const stats = await StatsService.getStats();
    const today = new Date().toISOString().split('T')[0];

    expect(stats.totalGenerations).toBe(2);
    expect(stats.totalVideos).toBe(1);
    expect(stats.totalInputTokens).toBe(150);
    expect(stats.totalOutputTokens).toBe(30);
    expect(stats.modelUsage.m1.inputTokens).toBe(150);
    expect(stats.modelUsage.m1.outputTokens).toBe(30);
    expect(stats.dailyStats[today].videos).toBe(1);
    expect(stats.dailyStats[today].generations).toBe(2);
    expect(stats.dailyStats[today].inputTokens).toBe(150);
  });
});

describe('StatsService 反思直通率口径', () => {
  it('分母只统计开启反思且成功的运行', async () => {
    const { StatsService } = await load();

    await StatsService.recordGeneration({
      videoId: 'BV1', modelId: 'm1', isReflectionEnabled: false, isSuccess: true
    });
    await StatsService.recordGeneration({
      videoId: 'BV1', modelId: 'm1', isReflectionEnabled: true, reflectionSuccess: true, isSuccess: true
    });
    await StatsService.recordGeneration({
      videoId: 'BV1', modelId: 'm1', isReflectionEnabled: true, reflectionSuccess: false, isSuccess: true
    });
    await StatsService.recordGeneration({
      videoId: 'BV1', modelId: 'm1', isReflectionEnabled: true, reflectionSuccess: true, isSuccess: false
    });

    const stats = await StatsService.getStats();
    expect(stats.totalGenerations).toBe(3);
    expect(stats.reflectionRuns).toBe(2);
    expect(stats.reflectionSuccessCount).toBe(1);
  });
});

describe('StatsService 跨更新持久化（sync 镜像）', () => {
  it('写入 local 的同时镜像到 sync，超大列表按配额裁剪', async () => {
    const { StatsService } = await load();

    // 造 300 个视频 ID，超出备份第一档的 200
    for (let i = 0; i < 300; i++) {
      await StatsService.recordGeneration({
        videoId: 'BVVIDEO' + String(i).padStart(4, '0'),
        modelId: 'm1',
        isReflectionEnabled: true,
        reflectionSuccess: true,
        isSuccess: true
      });
    }

    const backup = store['app_statistics_backup_v1'];
    expect(backup).toBeTruthy();
    expect(backup.processedVideoIds.length).toBeLessThanOrEqual(200);
    // 裁剪只影响备份：本地完整保留
    expect(backup.totalVideos).toBe(300);
    expect(backup.totalGenerations).toBe(300);
    // 备份必须塞得进 sync 单条目配额
    expect(JSON.stringify(backup).length).toBeLessThanOrEqual(8000);
  });

  it('storage.local 被清空（重装场景）后自动从 sync 恢复', async () => {
    const { StatsService } = await load();

    await StatsService.recordGeneration({
      videoId: 'BV1', modelId: 'm1', isReflectionEnabled: true, reflectionSuccess: true, isSuccess: true,
      inputTokens: 100, outputTokens: 20
    });
    expect(store['app_statistics_backup_v1']).toBeTruthy();

    // 模拟重装：local 全没了，sync 备份还在
    delete store['app_statistics'];

    const restored = await StatsService.restoreFromSync();
    expect(restored).toBe(true);

    const stats = await StatsService.getStats();
    expect(stats.totalGenerations).toBe(1);
    expect(stats.totalVideos).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.reflectionRuns).toBe(1);
    expect(stats.reflectionSuccessCount).toBe(1);
  });

  it('local 数据比备份新时不回滚', async () => {
    const { StatsService } = await load();

    await StatsService.recordGeneration({
      videoId: 'BV1', modelId: 'm1', isReflectionEnabled: false, isSuccess: true
    });
    const newer = store['app_statistics'];

    // 伪造一份更旧的备份
    store['app_statistics_backup_v1'] = {
      ...newer,
      totalGenerations: 99,
      lastUpdated: newer.lastUpdated - 10000
    };

    const restored = await StatsService.restoreFromSync();
    expect(restored).toBe(false);
    expect((await StatsService.getStats()).totalGenerations).toBe(1);
  });

  it('清空统计时本地与 sync 备份一起清', async () => {
    const { StatsService } = await load();

    await StatsService.recordGeneration({
      videoId: 'BV1', modelId: 'm1', isReflectionEnabled: false, isSuccess: true
    });
    await StatsService.clearStats();

    expect(store['app_statistics']).toBeUndefined();
    expect(store['app_statistics_backup_v1']).toBeUndefined();
    expect(await StatsService.restoreFromSync()).toBe(false);
  });
});
