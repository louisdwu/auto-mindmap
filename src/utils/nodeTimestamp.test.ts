import { describe, expect, it } from 'vitest';
import { splitNodeTimestamp, TIMESTAMP_BADGE_EXTRA_WIDTH } from './nodeTimestamp';

describe('splitNodeTimestamp', () => {
  it('剥离末尾时间戳（带空格）', () => {
    expect(splitNodeTimestamp('疯狂购买GPU和内存 [00:10]')).toEqual({
      title: '疯狂购买GPU和内存',
      timestamp: '00:10'
    });
  });

  it('剥离紧贴末尾的时间戳，支持时分秒', () => {
    expect(splitNodeTimestamp('财报速览[01:02:03]')).toEqual({
      title: '财报速览',
      timestamp: '01:02:03'
    });
  });

  it('支持开头时间戳', () => {
    expect(splitNodeTimestamp('[00:10] 开场介绍')).toEqual({
      title: '开场介绍',
      timestamp: '00:10'
    });
  });

  it('支持全角括号', () => {
    expect(splitNodeTimestamp('现金流【00:30】')).toEqual({ title: '现金流', timestamp: '00:30' });
    expect(splitNodeTimestamp('（00:30）现金流')).toEqual({ title: '现金流', timestamp: '00:30' });
  });

  it('正文中间的括号数字不误判为时间戳', () => {
    const text = '屏幕比例(16:9)与16:10对比';
    expect(splitNodeTimestamp(text)).toEqual({ title: text, timestamp: null });
  });

  it('纯时间戳节点标题为空字符串', () => {
    expect(splitNodeTimestamp('[00:00]')).toEqual({ title: '', timestamp: '00:00' });
  });

  it('无时间戳与空文本原样返回', () => {
    expect(splitNodeTimestamp('疯狂购买GPU和内存')).toEqual({ title: '疯狂购买GPU和内存', timestamp: null });
    expect(splitNodeTimestamp('')).toEqual({ title: '', timestamp: null });
    expect(splitNodeTimestamp(null)).toEqual({ title: '', timestamp: null });
  });

  it('徽章额外宽度为正常数', () => {
    expect(TIMESTAMP_BADGE_EXTRA_WIDTH).toBeGreaterThan(0);
  });
});
