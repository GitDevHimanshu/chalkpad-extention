const SERVER_URL = 'https://chalkpad-attendance.onrender.com';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'SAVE_SESSION') return;

  const entry = message.entry || {};

  fetch(`${SERVER_URL}/api/session`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(entry)
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        console.log('[Haziri] Saved to server, id:', data.id, '| teacher:', entry.teacherId);
        sendResponse({ success: true, id: data.id });
      } else {
        console.warn('[Haziri] Server save failed:', data.error);
        sendResponse({ success: false, error: data.error });
      }
    })
    .catch(err => {
      console.warn('[Haziri] Could not reach server:', err.message);
      sendResponse({ success: false, error: err.message });
    });

  return true;
});
