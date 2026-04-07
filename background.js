const SERVER_URL = 'https://chalkpad-attendance.onrender.com';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'SAVE_SESSION') return;

  const entry = message.entry || {};

  fetch(`${SERVER_URL}/api/session`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(entry)
  })
    .then(async r => {
      const isJson = r.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await r.json() : null;

      if (r.ok && data?.success) {
        console.log('[Haziri] Saved to server, id:', data.id, '| teacher:', entry.teacherId);
        sendResponse({ success: true, id: data.id });
      } else {
        const error = data?.error || data?.message || `HTTP ${r.status}`;
        console.warn('[Haziri] Server save failed:', error);
        sendResponse({ success: false, error });
      }
    })
    .catch(err => {
      console.warn('[Haziri] Could not reach server:', err.message);
      sendResponse({ success: false, error: 'Network error: ' + err.message });
    });

  return true; // Keep the message channel open for async response
});
