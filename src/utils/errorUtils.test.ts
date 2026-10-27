import { describe, it, expect } from 'vitest';
import { ErrorUtils } from './errorUtils';

describe('ErrorUtils.parseError', () => {
  it('404「model route not found」要指向地址与模型名的排查路径', () => {
    const raw = 'HTTP 404: model route not found（地址 https://token.sensenova.cn/v1/chat/completions；模型 sensenova-6.8-flash-lite）';
    const msg = ErrorUtils.parseError(new Error(raw));

    expect(msg).toContain('HTTP 404');
    expect(msg).toContain('token.sensenova.cn'); // 给出正确的基址作为参照
    expect(msg).toContain('sensenova-6.8-flash-lite'); // 保留原始错误，便于定位
  });

  it('401/403 鉴权失败给出重新填密钥的指引', () => {
    const msg = ErrorUtils.parseError(new Error('HTTP 401: {"error":{"code":16,"message":"Forbidden"}}'));

    expect(msg).toContain('鉴权失败');
    expect(msg).toContain('测试连接');
  });

  it('Gemini 地区限制提示优先于通用鉴权提示', () => {
    const raw =
      'HTTP 403: 您的 IP 所在地区不在 Google Gemini 的服务范围内（如中国大陆）。请开启“全局代理”或在 API 地址处填写可用的“反向代理地址”。';

    expect(ErrorUtils.parseError(new Error(raw))).toBe(raw);
  });

  it('网络错误与超时仍按原有规则映射', () => {
    expect(ErrorUtils.parseError(new Error('Failed to fetch'))).toContain('网络错误');
    expect(ErrorUtils.parseError(new Error('AbortError'))).toContain('请求超时');
  });

  it('上下文超限仍能解析出具体 token 数', () => {
    const raw = "request (20000 tokens) exceeds the available context size (4096 tokens), try increasing it";
    const msg = ErrorUtils.parseError(new Error(raw));

    expect(msg).toContain('20000');
    expect(msg).toContain('4096');
  });

  it('未命中任何规则时原样返回，不吞掉原始信息', () => {
    expect(ErrorUtils.parseError(new Error('某个还没归类的错误'))).toBe('某个还没归类的错误');
  });
});
