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
