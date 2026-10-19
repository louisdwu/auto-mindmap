(function() {
  console.log('[YouTube Interceptor] Script loaded');

  // Hook fetch
  const originalFetch = window.fetch;
  window.fetch = async function(resource, init) {
    const response = await originalFetch(resource, init);
    
    try {
      const url = resource instanceof Request ? resource.url : resource;
      
      // Check if this is a subtitle request
      if (url && url.includes('timedtext')) {
        console.log('[YouTube Interceptor] Detected subtitle request:', url);
        
        // Clone response to read body without consuming it
        const clone = response.clone();
        const data = await clone.json();
        
        // Send data to content script
        window.postMessage({
          type: 'YOUTUBE_SUBTITLE_DATA',
          payload: {
            url: url,
            data: data
          }
        }, '*');
      }
    } catch (error) {
      console.error('[YouTube Interceptor] Error processing fetch:', error);
    }
    
    return response;
  };

  // Hook XMLHttpRequest
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;

  XHR.open = function(method, url) {
    this._url = url;
    return originalOpen.apply(this, arguments);
  };

  XHR.send = function(body) {
    this.addEventListener('load', function() {
      try {
        if (this._url && this._url.includes('timedtext')) {
          console.log('[YouTube Interceptor] Detected subtitle XHR:', this._url);
          
          let data;
          try {
            data = JSON.parse(this.responseText);
          } catch (e) {
            // Might be XML or other format, but usually JSON for YouTube API
            console.log('[YouTube Interceptor] Response is not JSON');
            return;
          }

          window.postMessage({
            type: 'YOUTUBE_SUBTITLE_DATA',
            payload: {
              url: this._url,
              data: data
            }
          }, '*');
        }
      } catch (error) {
        console.error('[YouTube Interceptor] Error processing XHR:', error);
      }
    });
    
    return originalSend.apply(this, arguments);
  };

  // ----------------------------------------------------------------------
  // 主动暴露 YouTube 播放器中的字幕轨道信息（captionTracks）
  // content script 处于隔离世界，无法直接读取 window.ytInitialPlayerResponse，
  // 这里在 main world 中读取并通过 postMessage 推送给 content script 缓存，
  // 以便用户手动点击悬浮球时能主动获取字幕（而不仅依赖视频播放时的 timedtext 拦截）
  // ----------------------------------------------------------------------
  function publishCaptionTracks() {
    try {
      var ypir = window.ytInitialPlayerResponse;
      var tracks = ypir && ypir.captions && ypir.captions.playerCaptionsTracklistRenderer
        && ypir.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (tracks && tracks.length > 0) {
        var title = (ypir.videoDetails && ypir.videoDetails.title) || '';
        window.postMessage({
          type: 'YOUTUBE_CAPTION_TRACKS',
          payload: { tracks: tracks, videoTitle: title }
        }, '*');
        console.log('[YouTube Interceptor] Published caption tracks:', tracks.length, title);
        return true;
      }
    } catch (e) {
      console.error('[YouTube Interceptor] publishCaptionTracks error:', e);
    }
    return false;
  }

  // ytInitialPlayerResponse 可能在本脚本注入前就已存在，也可能稍后才出现
  if (!publishCaptionTracks()) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (publishCaptionTracks() || tries > 30) {
        clearInterval(timer);
      }
    }, 300);
  }

})();