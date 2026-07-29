/**
 * bypassAlerts.js - Injected into MAIN world via manifest.json
 * Overrides blocking native alert and confirm dialogs on Chalkpad pages.
 */
(function() {
  // Override native browser alert and confirm so they don't block JavaScript execution
  window.alert = function(msg) {
    console.log('[Haziri] Intercepted alert:', msg);
    return true;
  };

  window.confirm = function(msg) {
    console.log('[Haziri] Intercepted confirm:', msg);
    return true;
  };
})();
