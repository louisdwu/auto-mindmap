/**
 * 通知工具类
 */
export class NotificationUtils {
  /**
   * 播放“叮”的一声
   */
  /**
   * 播放“叮”的一声
   * @param volume 音量 (0-1)
   */
  static async playDing(volume: number = 0.8) {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = audioContext.currentTime;

      // 创建主音和泛音
      const createOscillator = (freq: number, gainValue: number, decay: number) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(gainValue, now + 0.002); // 极速起始
        gain.gain.exponentialRampToValueAtTime(0.001, now + decay); // 极速衰减

        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.start(now);
        osc.stop(now + decay + 0.01);
      };

      // 使用传入的音量作为增益基数
      // 主音：极短的高音
      createOscillator(2000, volume, 0.12);
      // 泛音：极短的更高频 (音量减半)
      createOscillator(3200, volume * 0.5, 0.08);

      // 结束后关闭 context
      setTimeout(() => {
        audioContext.close();
      }, 500);
    } catch (error) {
      console.warn('[NotificationUtils] 播放声音失败:', error);
    }
  }
}
