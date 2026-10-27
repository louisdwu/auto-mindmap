import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/subtitleService', () => ({
  SubtitleService: {
    downloadChineseSubtitle: vi.fn(),
    runAsrFlow: vi.fn()
  }
}));

vi.mock('../services/llmService', () => ({
  LLMService: {
    validateConfig: vi.fn(() => ({ valid: true })),
    generateMindmap: vi.fn()
  }
}));

vi.mock('../services/storageService', () => ({
  StorageService: {
    getConfig: vi.fn(),
    getLLMConfigs: vi.fn(),
    getSubtitleCache: vi.fn(),
    getAsrCache: vi.fn(),
    saveSubtitleCache: vi.fn(async () => {}),
    getPhase1Cache: vi.fn(async () => null),
    savePhase1Cache: vi.fn(async () => {}),
    deletePhase1Cache: vi.fn(async () => {}),
    saveMindmap: vi.fn(async () => {})
  }
}));

vi.mock('../services/fileService', () => ({
  FileService: {
    hasCacheDirectory: vi.fn(() => false),
    saveSubtitleFile: vi.fn(async () => {}),
    saveMindmapFile: vi.fn(async () => {}),
    generateSubtitleFileName: vi.fn(() => 'subtitle.txt'),
    generateMindmapFileName: vi.fn(() => 'mindmap.md'),
    generateInitialMindmapFileName: vi.fn(() => 'initial.md')
  }
}));

vi.mock('../services/loggerService', () => ({
  LoggerService: {
    info: vi.fn(async () => {}),
    warn: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
    debug: vi.fn(async () => {})
  }
}));

vi.mock('../services/statsService', () => ({
  StatsService: {
    recordGeneration: vi.fn(async () => {})
  }
}));

import { TaskManager } from './taskManager';
import { SubtitleService } from '../services/subtitleService';
import { StorageService } from '../services/storageService';
import { DEFAULT_CONFIG } from '../types/config';

type Store = Record<string, any>;

function createChrome(store: Store) {
  return {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          if (keys == null) return JSON.parse(JSON.stringify(store));
          if (typeof keys === 'string') return keys in store ? { [keys]: JSON.parse(JSON.stringify(store[keys])) } : {};
          const out: Store = {};
          for (const key of keys) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
          return out;
        }),
        set: vi.fn(async (items: Store) => {
          for (const [key, value] of Object.entries(items)) store[key] = JSON.parse(JSON.stringify(value));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete store[key];
        })
      }
    },
    tabs: {
      sendMessage: vi.fn(async () => ({})),
      query: vi.fn(async () => [])
    },
    runtime: {
      sendMessage: vi.fn(async () => ({})),
      getPlatformInfo: vi.fn(async () => ({}))
    }
  };
}

let store: Store;

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
  (globalThis as any).chrome = createChrome(store);

  vi.mocked(StorageService.getConfig).mockResolvedValue({
    ...DEFAULT_CONFIG,
    settings: { ...DEFAULT_CONFIG.settings, concurrencyLimit: 1, enableReflection: false }
  });
  vi.mocked(StorageService.getLLMConfigs).mockResolvedValue([]);
  vi.mocked(StorageService.getSubtitleCache).mockResolvedValue(null);
  vi.mocked(StorageService.getAsrCache).mockResolvedValue(null);
});

function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve();
      } catch (e) {
        return reject(e);
      }
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('TaskManager 调度与持久化', () => {
  it('并发上限内的任务才会真正开始执行', async () => {
    const calls: string[] = [];
    let releaseFirst: (() => void) | null = null;
    vi.mocked(SubtitleService.downloadChineseSubtitle).mockImplementation(async (url: string) => {
      calls.push(url);
      if (calls.length === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return { videoUrl: url, videoTitle: 't', subtitleText: '[00:01] hello' };
    });

    const manager = new TaskManager();
    await manager.createDownloadTask('https://www.bilibili.com/video/BV1xx?p=1', 1, false, true);
    await manager.createDownloadTask('https://www.bilibili.com/video/BV2xx?p=1', 1, false, true);

    await waitFor(() => calls.length === 1);
    expect(calls).toHaveLength(1);

    releaseFirst!();
    await waitFor(() => calls.length === 2);
  });

  it('任务持久化不包含字幕原文，但字幕会写入缓存', async () => {
    const longText = '[00:01] ' + '很长的字幕内容'.repeat(100);
    const manager = new TaskManager();
    await manager.createMindmapTask('https://www.bilibili.com/video/BV3xx', longText, 'title', 1);

    expect(StorageService.saveSubtitleCache).toHaveBeenCalledWith('BV3xx', longText);
    const serialized = JSON.stringify(store.active_tasks || []);
    expect(serialized).not.toContain('很长的字幕内容');
  });

  it('按分 P 匹配当前任务，P2 不会命中 P1', async () => {
    vi.mocked(SubtitleService.downloadChineseSubtitle).mockImplementation(async (url: string) => {
      await new Promise(() => {});
      return { videoUrl: url, videoTitle: 't', subtitleText: '[00:01] x' };
    });

    const manager = new TaskManager();
    await manager.createDownloadTask('https://www.bilibili.com/video/BV4xx?p=1', 1, false, true);
    await waitFor(() => !!manager.getCurrentTask('https://www.bilibili.com/video/BV4xx?p=1'));

    expect(manager.getCurrentTask('https://www.bilibili.com/video/BV4xx?p=2')).toBeUndefined();
    expect(manager.getCurrentTask('https://www.bilibili.com/video/BV4xx?p=1')).toBeDefined();
  });

  it('恢复时把中断的 running 任务标记为失败', async () => {
    store.active_tasks = [{
      id: 't1',
      type: 'download_subtitle',
      status: 'running',
      data: { videoUrl: 'https://www.bilibili.com/video/BV5xx', subtitleOnly: true },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tabId: 1
    }];

    const manager = new TaskManager();
    await waitFor(() => manager.getTask('t1')?.status === 'failed');
    expect(manager.getTask('t1')?.error).toContain('后台服务中断');
  });
});
