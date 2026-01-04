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

})();