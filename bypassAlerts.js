/**
 * bypassAlerts.js - Injected into MAIN world via manifest.json
 * Overrides blocking native alert, confirm dialogs, and request lock popups on Chalkpad pages.
 */
(function() {
  // Override native browser alert and confirm
  window.alert = function(msg) {
    console.log('[Haziri Main World] Auto-dismissed alert:', msg);
    return true;
  };

  window.confirm = function(msg) {
    console.log('[Haziri Main World] Auto-dismissed confirm:', msg);
    return true;
  };

  // Continuously clear Chalkpad request locks and dismiss modal popups
  setInterval(() => {
    try {
      if (typeof window.isRequestInProgress !== 'undefined') {
        window.isRequestInProgress = false;
      }
      if (typeof window.requestInProgress !== 'undefined') {
        window.requestInProgress = false;
      }
      if (typeof window.busy !== 'undefined') {
        window.busy = false;
      }
    } catch(e) {}

    // Auto-click any confirmation or error popup buttons if present on page
    try {
      const closeBtns = document.querySelectorAll(
        '.dhtmlx_button input, .dhtmlx_popup_button, .dhx_popup_button, .modal .close, .toast-close, [onclick*="close"], [data-dismiss="modal"]'
      );
      closeBtns.forEach(btn => {
        if (btn && typeof btn.click === 'function') {
          btn.click();
        }
      });
    } catch(e) {}
  }, 350);
})();
