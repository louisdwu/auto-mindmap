import { describe, expect, it } from 'vitest';
import { getCacheId, isSameMedia, parseMediaRef } from './media';

describe('parseMediaRef', () => {
  it('解析 B 站普通视频并默认 P1', () => {
    const ref = parseMediaRef('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.999');
    expect(ref).toEqual({
      platform: 'bilibili',
      videoId: 'BV1xx411c7mD',
      page: 1,
      key: 'bilibili:BV1xx411c7mD:p1',
      cacheId: 'BV1xx411c7mD'
    });
  });

  it('解析 B 站分 P：key 与 cacheId 必须区分不同 P', () => {
    const ref = parseMediaRef('https://www.bilibili.com/video/BV1xx411c7mD?p=2');
    expect(ref?.page).toBe(2);
    expect(ref?.key).toBe('bilibili:BV1xx411c7mD:p2');
    expect(ref?.cacheId).toBe('BV1xx411c7mD_p2');
  });

  it('非法 p 参数回退到 P1', () => {
    expect(parseMediaRef('https://www.bilibili.com/video/BV1xx411c7mD?p=abc')?.page).toBe(1);
    expect(parseMediaRef('https://www.bilibili.com/video/BV1xx411c7mD?p=0')?.page).toBe(1);
    expect(parseMediaRef('https://www.bilibili.com/video/BV1xx411c7mD?p=-3')?.page).toBe(1);
  });

  it('解析 B 站 av 号与 bvid 查询参数', () => {
    expect(parseMediaRef('https://www.bilibili.com/video/av170001')?.videoId).toBe('av170001');
    expect(parseMediaRef('https://www.bilibili.com/video?bvid=BV1xx411c7mD')?.videoId).toBe('BV1xx411c7mD');
    expect(parseMediaRef('https://www.bilibili.com/video?aid=170001')?.videoId).toBe('av170001');
  });

  it('解析 YouTube watch / 短链 / shorts / embed', () => {
    const expected = {
      platform: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      page: 1,
      key: 'youtube:dQw4w9WgXcQ',
      cacheId: 'dQw4w9WgXcQ'
    };
    expect(parseMediaRef('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1')).toEqual(expected);
    expect(parseMediaRef('https://youtu.be/dQw4w9WgXcQ?t=12')?.key).toBe(expected.key);
    expect(parseMediaRef('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.key).toBe(expected.key);
    expect(parseMediaRef('https://www.youtube.com/embed/dQw4w9WgXcQ')?.key).toBe(expected.key);
  });

  it('非视频页面返回 null', () => {
    expect(parseMediaRef('https://www.bilibili.com/')).toBeNull();
    expect(parseMediaRef('https://www.youtube.com/feed/subscriptions')).toBeNull();
    expect(parseMediaRef('not a url')).toBeNull();
    expect(parseMediaRef('')).toBeNull();
    expect(parseMediaRef(null)).toBeNull();
  });
});

describe('isSameMedia', () => {
  it('同一分 P 的不同 URL 形态视为同一视频', () => {
    expect(isSameMedia(
      'https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=10',
      'https://www.bilibili.com/video/BV1xx411c7mD/?p=2&spm=1'
    )).toBe(true);
  });

  it('同一 BV 的不同分 P 必须视为不同视频', () => {
    expect(isSameMedia(
      'https://www.bilibili.com/video/BV1xx411c7mD?p=1',
      'https://www.bilibili.com/video/BV1xx411c7mD?p=2'
    )).toBe(false);
  });

  it('无法解析时回退到原字符串比较', () => {
    expect(isSameMedia('about:blank', 'about:blank')).toBe(true);
    expect(isSameMedia('about:blank', 'about:blank#x')).toBe(false);
  });
});

describe('getCacheId', () => {
  it('P1 保持裸 ID，兼容旧缓存', () => {
    expect(getCacheId('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('BV1xx411c7mD');
  });

  it('P2 使用独立缓存键', () => {
    expect(getCacheId('https://www.bilibili.com/video/BV1xx411c7mD?p=2')).toBe('BV1xx411c7mD_p2');
  });

  it('无法解析时返回裁剪后的 URL，而不是 null 以外的不稳定值', () => {
    expect(getCacheId('https://example.com/watch/1')).toBe('https://example.com/watch/1');
    expect(getCacheId('')).toBeNull();
  });
});
