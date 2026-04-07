const SERVER_URL = 'https://chalkpad-attendance.onrender.com';

/**
 * Service Worker entry point for extension background tasks.
 * Handles incoming messages from content scripts and the popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Connectivity Check (Ping/Pong)
  if (message.type === 'PING') {
    sendResponse({ success: true, message: 'pong' });
    return true;
  }

  // 2. Save Session Data to MongoDB
  if (message.type === 'SAVE_SESSION') {
    const entry = message.entry || {};
    
    fetch(`${SERVER_URL}/api/session`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(entry)
    })
    .then(async response => {
      const isJson = response.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await response.json() : null;

      if (response.ok && data?.success) {
        console.log('[Haziri] Saved to server, id:', data.id, '| teacher:', entry.teacherId);
        sendResponse({ success: true, id: data.id });
      } else {
        const errorMsg = data?.error || data?.message || `HTTP ${response.status}`;
        console.warn('[Haziri] Server save failed:', errorMsg);
        sendResponse({ success: false, error: errorMsg });
      }
    })
    .catch(err => {
      console.warn('[Haziri] Could not reach server:', err.message);
      sendResponse({ success: false, error: 'Network error: ' + err.message });
    });

    return true; // Keep the message channel open for async response
  }
  
  // Return false for unhandled messages
  return false;
});
