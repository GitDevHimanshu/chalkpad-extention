/**
 * sheetSync.js - Standalone Google Sheets Auto-Sync & Pending Sessions Engine
 * Works directly with public Google Sheets to extract bottom-row attendance JSON configs.
 */

const SheetSync = (function () {

  /**
   * Extract Google Spreadsheet ID from a URL or raw ID string.
   */
  function extractSheetId(urlOrId) {
    if (!urlOrId) return null;
    const match = urlOrId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) return match[1];
    if (/^[a-zA-Z0-9-_]+$/.test(urlOrId.trim())) return urlOrId.trim();
    return null;
  }

  /**
   * Simple, resilient CSV parser handling quotes and escaped quotes.
   */
  function parseCSV(text) {
    const lines = [];
    let row = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        row.push(current.trim());
        if (row.some(cell => cell.length > 0)) {
          lines.push(row);
        }
        row = [];
        current = '';
      } else {
        current += char;
      }
    }
    if (current.length > 0 || row.length > 0) {
      row.push(current.trim());
      if (row.some(cell => cell.length > 0)) {
        lines.push(row);
      }
    }
    return lines;
  }

  /**
   * Safely parses JS object literal notation or JSON string into a JS object.
   */
  function safeParseJsonObject(str) {
    if (!str || typeof str !== 'string') return null;
    const trimmed = str.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

    // First try native JSON.parse
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // Fallback: JS Object literal parse via sanitized evaluation
      try {
        // Fix unquoted keys, e.g. {info:{ -> {"info":{
        const jsonified = trimmed
          .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
          .replace(/:\s*'([^']*)'/g, ':"$1"');
        return JSON.parse(jsonified);
      } catch (e2) {
        try {
          // Controlled evaluation for valid JS object string
          return (new Function('return ' + trimmed))();
        } catch (e3) {
          console.warn('[SheetSync] Failed to parse object:', trimmed.substring(0, 50), e3);
          return null;
        }
      }
    }
  }

  /**
   * Normalize date string to YYYY-MM-DD format for reliable comparison.
   * Accepts "13/07/2026", "13-07-2026", "2026-07-13", "13/7/2026".
   */
  function normalizeDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.trim().split(/[\/\-\.]/);
    if (parts.length !== 3) return dateStr.trim();

    let d, m, y;
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      y = parts[0];
      m = parts[1].padStart(2, '0');
      d = parts[2].padStart(2, '0');
    } else {
      // DD-MM-YYYY
      d = parts[0].padStart(2, '0');
      m = parts[1].padStart(2, '0');
      y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
    }
    return `${y}-${m}-${d}`;
  }

  /**
   * Fetches CSV for a specific sheet tab using GViz endpoint.
   */
  async function fetchTabCSV(sheetId, tabName) {
    let url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
    if (tabName && tabName.trim()) {
      url += `&sheet=${encodeURIComponent(tabName.trim())}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch sheet tab "${tabName || 'default'}": ${response.statusText}`);
    }
    const text = await response.text();
    return parseCSV(text);
  }

  /**
   * Scans rows from bottom to top to extract JSON config objects.
   */
  function scanBottomUpForConfigs(rows) {
    const configs = [];
    const seenSignatures = new Set();

    // Extract all valid student roll numbers present in this tab
    const allTabRolls = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const val = row[c] ? row[c].trim() : '';
        if (/^\d{10}$/.test(val) && !allTabRolls.includes(val)) {
          allTabRolls.push(val);
        }
      }
    }
    const totalStudentsInTab = allTabRolls.length;

    // Start scanning from bottom row upwards
    for (let r = rows.length - 1; r >= 0; r--) {
      const row = rows[r];
      let foundInRow = 0;

      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell && cell.includes('info') && (cell.includes('absentees') || cell.includes('period'))) {
          const parsed = safeParseJsonObject(cell);
          if (parsed && parsed.info && parsed.info.date) {
            const periods = Array.isArray(parsed.info.period) ? parsed.info.period.join(',') : parsed.info.period;
            const sig = `${normalizeDate(parsed.info.date)}_${periods}_${parsed.info.group || ''}`;
            
            let absentees = Array.isArray(parsed.absentees) ? [...parsed.absentees] : [];
            let presents  = Array.isArray(parsed.presents) ? [...parsed.presents] : [];

            const absenteeCount = absentees.length;
            const presentCount  = presents.length;
            const recordedTotal = absenteeCount + presentCount;
            const hasMismatch   = totalStudentsInTab > 0 && recordedTotal !== totalStudentsInTab;

            if (recordedTotal > 0 && !seenSignatures.has(sig)) {
              seenSignatures.add(sig);

              configs.push({
                raw: parsed,
                sig: sig,
                date: parsed.info.date,
                normalizedDate: normalizeDate(parsed.info.date),
                period: parsed.info.period,
                group: parsed.info.group || '',
                subject: parsed.info.subject || '',
                absenteeCount: absenteeCount,
                presentCount: presentCount,
                recordedTotal: recordedTotal,
                totalStudentsInTab: totalStudentsInTab,
                hasMismatch: hasMismatch,
                missingCount: totalStudentsInTab > 0 ? (totalStudentsInTab - recordedTotal) : 0
              });
              foundInRow++;
            }
          }
        }
      }

      if (foundInRow > 0 && configs.length >= 50) break;
    }

    // Sort configs: Error/mismatch cards pinned to TOP of list, followed by valid cards sorted date-wise
    configs.sort((a, b) => {
      const errA = a.error || a.hasMismatch ? 1 : 0;
      const errB = b.error || b.hasMismatch ? 1 : 0;
      if (errA !== errB) {
        return errB - errA; // Error cards on top!
      }
      if (a.normalizedDate !== b.normalizedDate) {
        return (a.normalizedDate || '').localeCompare(b.normalizedDate || '');
      }
      const pA = Array.isArray(a.period) ? a.period[0] : a.period;
      const pB = Array.isArray(b.period) ? b.period[0] : b.period;
      return (pA || 0) - (pB || 0);
    });

    return configs;
  }

  /**
   * Main function: Fetch all pending sessions across configured sheet tabs.
   * @param {string} sheetUrlOrId - Master Google Sheet URL
   * @param {Array<{tabName: string, groupName: string}>} mappings - Group to Tab mappings
   * @param {Object} markedHistory - Dictionary of marked session signatures or dates
   */
  async function fetchPendingSessions(sheetUrlOrId, mappings, markedHistory = {}) {
    const sheetId = extractSheetId(sheetUrlOrId);
    if (!sheetId) {
      throw new Error('Invalid Google Sheet URL or ID.');
    }

    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      throw new Error('No Group-to-Tab mappings configured.');
    }

    const allPending = [];

    for (const map of mappings) {
      const tabName = map.tabName ? map.tabName.trim() : '';
      const groupName = map.groupName ? map.groupName.trim() : tabName;

      try {
        const rows = await fetchTabCSV(sheetId, tabName);
        const configs = scanBottomUpForConfigs(rows);

        // Filter out sessions that are already marked
        for (const item of configs) {
          const itemSig = item.sig;
          const groupHistory = markedHistory[groupName] || markedHistory[item.group] || {};
          const isMarked = groupHistory.markedSigs && groupHistory.markedSigs.includes(itemSig);

          if (!isMarked) {
            allPending.push({
              ...item,
              targetTab: tabName,
              mappedGroupName: groupName
            });
          }
        }
      } catch (err) {
        console.error(`[SheetSync] Error fetching tab "${tabName}":`, err);
        allPending.push({
          error: true,
          targetTab: tabName,
          mappedGroupName: groupName,
          errorMessage: err.message
        });
      }
    }

    // Final master sort: Pinned Error/Mismatch cards FIRST, followed by valid cards sorted date-wise
    allPending.sort((a, b) => {
      const errA = (a.error || a.hasMismatch) ? 1 : 0;
      const errB = (b.error || b.hasMismatch) ? 1 : 0;
      if (errA !== errB) {
        return errB - errA; // Error cards pinned on top!
      }
      if (a.normalizedDate !== b.normalizedDate) {
        return (a.normalizedDate || '').localeCompare(b.normalizedDate || '');
      }
      const pA = Array.isArray(a.period) ? a.period[0] : a.period;
      const pB = Array.isArray(b.period) ? b.period[0] : b.period;
      return (pA || 0) - (pB || 0);
    });

    return allPending;
  }

  return {
    extractSheetId,
    parseCSV,
    safeParseJsonObject,
    normalizeDate,
    fetchTabCSV,
    scanBottomUpForConfigs,
    fetchPendingSessions
  };

})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetSync;
}
