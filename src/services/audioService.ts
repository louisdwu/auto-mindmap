import { md5 } from '../utils/crypto';

export interface WbiKeys {
  img_key: string;
  sub_key: string;
}

export class AudioService {
  private static mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
  ];

  /**
   * 获取最新的 WBI keys
   */
  public static async getWbiKeys(): Promise<WbiKeys> {
    const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      credentials: 'include'
    });
    const { data: { wbi_img: { img_url, sub_url } } } = await res.json();
    return {
      img_key: img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.')),
      sub_key: sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'))
    };
  }

  /**
   * 为参数生成 WBI 签名
   */
  public static async encWbi(params: Record<string, any>, { img_key, sub_key }: WbiKeys): Promise<string> {
    const mixin_key = this.mixinKeyEncTab
      .map(n => (img_key + sub_key)[n])
      .join('')
      .slice(0, 32);
    
    const curr_params: Record<string, any> = { ...params, wts: Math.floor(Date.now() / 1000) };
    const query = Object.keys(curr_params)
      .sort()
      .map(key => {
        const value = curr_params[key].toString().replace(/[!'()*]/g, '');
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join('&');
    
    const w_rid = md5(query + mixin_key);
    return query + '&w_rid=' + w_rid;
  }

  /**
   * 获取视频音频流 URL
   */
  static async getAudioUrl(bvid: string, cid: number): Promise<string> {
    const keys = await this.getWbiKeys();
    const params = {
      bvid,
      cid,
      fnval: 16, // DASH 格式
    };
    
    const signedQuery = await this.encWbi(params, keys);
    const url = `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`;
    
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    
    if (data.code !== 0) {
      throw new Error(data.message || '获取视频地址失败');
    }
    
    const audioList = data.data?.dash?.audio;
    if (!audioList || audioList.length === 0) {
      throw new Error('未找到音频流');
    }
    
    // 返回最高质量的音频地址
    return audioList[0].baseUrl || audioList[0].base_url;
  }

  /**
   * 下载音频内容为 Blob
   */
  static async downloadAudioBlob(url: string): Promise<Blob> {
    const res = await fetch(url, {
      headers: {
        'Referer': 'https://www.bilibili.com',
        'User-Agent': navigator.userAgent
      }
    });
    if (!res.ok) {
      throw new Error(`下载音频失败: ${res.statusText}`);
    }
    return await res.blob();
  }
}
