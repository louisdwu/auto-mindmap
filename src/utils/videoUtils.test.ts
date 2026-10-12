import { describe, it, expect } from 'vitest';
import { VideoUtils } from './videoUtils';

describe('VideoUtils Timestamp Utilities', () => {
  it('formatSecondsToTimestamp formats seconds correctly', () => {
    expect(VideoUtils.formatSecondsToTimestamp(0)).toBe('00:00');
    expect(VideoUtils.formatSecondsToTimestamp(5)).toBe('00:05');
    expect(VideoUtils.formatSecondsToTimestamp(65)).toBe('01:05');
    expect(VideoUtils.formatSecondsToTimestamp(83.4)).toBe('01:23');
    expect(VideoUtils.formatSecondsToTimestamp(3665)).toBe('01:01:05');
  });

  it('parseTimestampToSeconds parses mm:ss and hh:mm:ss correctly', () => {
    expect(VideoUtils.parseTimestampToSeconds('00:00')).toBe(0);
    expect(VideoUtils.parseTimestampToSeconds('01:05')).toBe(65);
    expect(VideoUtils.parseTimestampToSeconds('01:23')).toBe(83);
    expect(VideoUtils.parseTimestampToSeconds('01:01:05')).toBe(3665);
    expect(VideoUtils.parseTimestampToSeconds('invalid')).toBeNull();
  });
});
