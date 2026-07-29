/* ════════════════════════════
   SERVER CONFIG
════════════════════════════ */
const SERVER_URL = 'https://chalkpad-attendance.onrender.com';

async function postToServer(entry) {
  const teacherId = (localStorage.getItem('haziriTeacherId') || 'default').trim().toLowerCase();
  const payload   = { ...entry, teacherId };

  // Use direct extension messaging if available
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SAVE_SESSION', entry: payload }, (response) => {
        if (response && response.success) {
          console.log('[Popup] Saved to server directly');
          resolve({ success: true });
        } else {
          console.warn('[Popup] Direct save failed:', response?.error);
          resolve({ success: false, error: response?.error });
        }
      });
    });
  }

  // Fallback to relay through content script (legacy)
  window.parent.postMessage({ type: 'RELAY_TO_SERVER', entry: payload }, '*');
  return { success: true }; // Assume success for relay
}



/* ════════════════════════════
   TEACHER ID
════════════════════════════ */
function showTeacherEdit() {
  document.getElementById('teacherDisplayWrap').style.display = 'none';
  const wrap  = document.getElementById('teacherEditWrap');
  const input = document.getElementById('teacherIdInput');
  wrap.style.display = 'flex';
  if (input) input.focus();
}
function hideTeacherEdit() {
  document.getElementById('teacherDisplayWrap').style.display = 'flex';
  document.getElementById('teacherEditWrap').style.display = 'none';
}

function loadTeacherId() {
  const saved        = localStorage.getItem('haziriTeacherId') || '';
  const savedDisplay = localStorage.getItem('haziriTeacherIdDisplay') || saved;
  const input        = document.getElementById('teacherIdInput');
  if (input && savedDisplay) input.value = savedDisplay;
  updateTeacherBadge(savedDisplay);
}
function saveTeacherIdFromInput() {
  const input = document.getElementById('teacherIdInput');
  if (!input) return;
  const original = input.value.trim();
  const lower    = original.toLowerCase();
  if (!lower) { alert('Teacher ID cannot be empty.'); return; }
  localStorage.setItem('haziriTeacherId', lower);          // store lowercase
  localStorage.setItem('haziriTeacherIdDisplay', original); // store display
  updateTeacherBadge(original);
  document.getElementById('teacherSaveBtn').textContent = 'Saved ✓';
  setTimeout(() => { document.getElementById('teacherSaveBtn').textContent = 'Save'; hideTeacherEdit(); }, 1200);
}
function updateTeacherBadge(id) {
  const badge = document.getElementById('teacherBadge');
  if (badge) badge.textContent = id ? id : 'Not set';
}

/* ════════════════════════════
   TAB NAVIGATION
════════════════════════════ */
const TABS = ['attendance', 'formula', 'sheet', 'history', 'autosync'];

function showTab(id) {
  TABS.forEach(t => {
    const panel = document.getElementById('tab-' + t);
    const btn   = document.querySelector('[data-tab="' + t + '"]');
    if (!panel) return;
    if (t === id) {
      panel.style.display = t === 'history' ? 'flex' : 'block';
      panel.classList.remove('tab-exit');
      void panel.offsetWidth;
      panel.classList.add('tab-enter');
      
      // Auto focus relevant inputs
      if (id === 'attendance') {
        const stateInput = document.getElementById('state-input');
        if (stateInput && stateInput.style.display !== 'none') {
          document.getElementById('attendanceInput').focus();
        }
      }
    } else {
      panel.style.display = 'none';
      panel.classList.remove('tab-enter');
    }
    if (btn) btn.classList.toggle('active', t === id);
  });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => showTab(btn.dataset.tab);
});

/* ════════════════════════════
   ATTENDANCE STATES
════════════════════════════ */
const STATES = ['state-input', 'state-running', 'state-done', 'state-already'];

function showState(id) {
  STATES.forEach(s => {
    const el = document.getElementById(s);
    if (!el) return;
    if (s === id) {
      el.style.display = 'block';
      el.classList.remove('state-exit');
      void el.offsetWidth;
      el.classList.add('state-enter');
    } else {
      el.style.display = 'none';
      el.classList.remove('state-enter', 'state-exit');
    }
  });
}

function closePopup() {
  window.parent.postMessage({ type: 'CANCEL_ATTENDANCE' }, '*');
}

document.getElementById('cancelBtn').onclick       = closePopup;
document.getElementById('cancelBtn2').onclick      = closePopup;
document.getElementById('closeBtn').onclick        = () => window.parent.postMessage({ type: 'CLOSE_POPUP' }, '*');

const handleSubmit = async (options = {}) => {
  const btn = document.getElementById('submitBtn');
  const originalText = btn.textContent;
  const shouldSubmit = document.getElementById('submitToChalkpadCb')?.checked !== false;

  if (_pendingHistoryEntry) {
    // Show loading state
    btn.disabled = true;
    btn.textContent = 'Saving...';

    _pendingHistoryEntry.submittedAt = new Date().toISOString();
    saveHistoryEntry(_pendingHistoryEntry);
    await markSessionAsCompletedInHistory(_pendingHistoryEntry.config);
    
    try {
      const res = await postToServer(_pendingHistoryEntry);
      if (!res.success) {
        console.warn('[Attendance] Server save error:', res.error);
        // We'll proceed to submit anyway but log it
      }
    } catch (err) {
      console.error('[Attendance] Server post failed:', err);
    }
    
    _pendingHistoryEntry = null;
    
    // Quick success feedback
    btn.textContent = 'Saved ✓';
    await new Promise(r => setTimeout(r, 600));
  }

  const activeBatch = await new Promise(resolve => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['activeBatch'], res => resolve(res.activeBatch || null));
    } else {
      resolve(null);
    }
  });

  const isBatch = Boolean(options.keepPopupOpen || (activeBatch && activeBatch.isActive));

  if (shouldSubmit) {
    window.parent.postMessage({ 
      type: 'SUBMIT_ATTENDANCE', 
      keepPopupOpen: isBatch 
    }, '*');
  } else {
    window.parent.postMessage({ type: 'CLOSE_POPUP' }, '*');
  }
  
  // Restore button just in case
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = originalText;
  }, 1000);
};

document.getElementById('submitBtn').onclick = handleSubmit;

// Allow Enter to trigger Submit on Done state (if no input is focused)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const doneState = document.getElementById('state-done');
    if (doneState && doneState.style.display !== 'none') {
      // Avoid if an input is focused (though there aren't any on done state)
      if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        handleSubmit();
      }
    }
  }
});
document.getElementById('alreadyCloseBtn').onclick = () => showState('state-input');

document.getElementById('proceedBtn').onclick = () => {
  const teacherId = (localStorage.getItem('haziriTeacherId') || '').trim();
  const input     = document.getElementById('attendanceInput').value.trim();
  const errorEl   = document.getElementById('error');

  if (!teacherId) {
    errorEl.textContent = 'Please set your Teacher ID in the header first.';
    showTeacherEdit();
    return;
  }
  if (!input) { errorEl.textContent = 'Please paste a config.'; return; }
  if (!input.startsWith('{') || !input.endsWith('}')) {
    errorEl.textContent = 'Config must be a { ... } object.'; return;
  }
  errorEl.textContent = '';
  showState('state-running');
  window.parent.postMessage({ type: 'RUN_ATTENDANCE', raw: input }, '*');
};

document.getElementById('attendanceInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('proceedBtn').click();
  }
});

/* ════════════════════════════
   FORMULA — SETTINGS PERSISTENCE
════════════════════════════ */
async function loadSettings() {
  try {
    // Try session storage first (as requested: retain until browser shut)
    let saved = {};
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      const data = await chrome.storage.session.get('attendanceSettings');
      saved = data.attendanceSettings || {};
    }
    
    // Fallback/Legacy: check localStorage if session is empty
    if (Object.keys(saved).length === 0) {
      saved = JSON.parse(localStorage.getItem('attendanceSettings') || '{}');
    }

    if (saved.startCol)           document.getElementById('startCol').value           = saved.startCol;
    if (saved.rowStart)           document.getElementById('rowStart').value           = saved.rowStart;
    if (saved.rowEnd)             document.getElementById('rowEnd').value             = saved.rowEnd;
    if (saved.settingsClass)      document.getElementById('settingsClass').value      = saved.settingsClass;
    if (saved.settingsSubject)    document.getElementById('settingsSubject').value    = saved.settingsSubject;
    if (saved.settingsGroup)      document.getElementById('settingsGroup').value      = saved.settingsGroup;
    if (saved.settingsTimeTable)  document.getElementById('settingsTimeTable').value  = saved.settingsTimeTable;
    if (saved.settingsPeriodSlot) document.getElementById('settingsPeriodSlot').value = saved.settingsPeriodSlot;
  } catch(_) {}
}

function saveSettings() {
  const sc  = document.getElementById('startCol').value.trim().toUpperCase();
  const rs  = document.getElementById('rowStart').value.trim() || '5';
  const re  = document.getElementById('rowEnd').value.trim();
  const cls = document.getElementById('settingsClass').value.trim();
  const sub = document.getElementById('settingsSubject').value.trim();
  const grp = document.getElementById('settingsGroup').value.trim();
  const tt  = document.getElementById('settingsTimeTable').value.trim();
  const ps  = document.getElementById('settingsPeriodSlot').value.trim();

  const settings = { 
    startCol: sc, rowStart: rs, rowEnd: re,
    settingsClass: cls, settingsSubject: sub, settingsGroup: grp,
    settingsTimeTable: tt, settingsPeriodSlot: ps 
  };

  try {
    // Save to session storage (persists until browser shut)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.set({ 'attendanceSettings': settings });
    }
    // Also keep in localStorage for now to ensure continuity, 
    // but the session storage will take precedence on next load.
    localStorage.setItem('attendanceSettings', JSON.stringify(settings));
  } catch(_) {}
}

// Attach auto-save listeners to formula fields (attendanceInput excluded as requested)
['startCol', 'rowStart', 'rowEnd', 'settingsClass', 
 'settingsSubject', 'settingsGroup', 'settingsTimeTable', 'settingsPeriodSlot'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', saveSettings);
});

loadSettings();
loadTeacherId();

// Auto focus attendance input on load
const mainInput = document.getElementById('attendanceInput');
if (mainInput) mainInput.focus();

document.getElementById('generateBtn').onclick = () => {
  const sc  = document.getElementById('startCol').value.trim().toUpperCase();
  const rs  = document.getElementById('rowStart').value.trim() || '5';
  const re  = document.getElementById('rowEnd').value.trim();
  const cls = document.getElementById('settingsClass').value.trim();
  const sub = document.getElementById('settingsSubject').value.trim();
  const grp = document.getElementById('settingsGroup').value.trim();
  const tt  = document.getElementById('settingsTimeTable').value.trim();
  const ps  = document.getElementById('settingsPeriodSlot').value.trim();

  if (!sc || !re || !cls || !sub || !grp) { alert('Please fill in all fields.'); return; }

  // Loading state
  const btn     = document.getElementById('generateBtn');
  const btnText = document.getElementById('generateBtnText');
  const spinner = document.getElementById('generateBtnSpinner');
  btn.disabled = true;
  btnText.style.display = 'none';
  spinner.style.display = 'inline-block';

  setTimeout(() => {
    saveSettings();

    const ttPart = tt ? `timeTable:""${tt}"",` : '';
    const psPart = ps ? `periodSlot:""${ps}"",` : '';

    const formula =
`=LET(
  thisCol,     COLUMNS($${sc}$1:${sc}$1),
  thisDate,    ${sc}$1,
  thisColData, CHOOSECOLS($${sc}$${rs}:$ZZ$${re}, thisCol),
  nRows,       ROWS($${sc}$${rs}:$${sc}$${re}),
  nCols,       COLUMNS($${sc}$1:$ZZ$1),
  samePattern, MAKEARRAY(1, nCols, LAMBDA(r,c,
                 SUMPRODUCT(EXACT(
                   TRIM(CHOOSECOLS($${sc}$${rs}:$ZZ$${re}, c)),
                   TRIM(thisColData)
                 )*1) = nRows
               )),
  "{info:{${ttPart}${psPart}period:["&
  TEXTJOIN(",",TRUE,
    IFERROR(
      FILTER(
        IFERROR(REGEXEXTRACT($${sc}$3:$ZZ$3,"[0-9]+$"),""),
        ($${sc}$1:$ZZ$1=thisDate) * samePattern
      ),
      IFERROR(REGEXEXTRACT(CHOOSECOLS($${sc}$3:$ZZ$3,thisCol),"[0-9]+$"),"")
    )
  )&
  "],date:"""&TEXT(thisDate,"dd/mm/yyyy")&
  """,class:""${cls}"",subject:""${sub}"",group:""${grp}""},absentees:["&
  TEXTJOIN(",",TRUE,
    IFERROR(FILTER($B$${rs}:$B$${re}, CHOOSECOLS($${sc}$${rs}:$ZZ$${re},thisCol)="A"),"")
  )&
  "],presents:["&
  TEXTJOIN(",",TRUE,
    IFERROR(FILTER($B$${rs}:$B$${re}, CHOOSECOLS($${sc}$${rs}:$ZZ$${re},thisCol)="P"),"")
  )&
  "]}"
)`;

    document.getElementById('formulaOutput').value = formula;

    // Restore button
    btn.disabled = false;
    btnText.style.display = 'inline';
    spinner.style.display = 'none';

    // Open modal
    const modal = document.getElementById('formulaModal');
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('modal-enter');
  }, 500);
};

// Close modal
document.getElementById('formulaModalClose').onclick = closeFormulaModal;
document.getElementById('formulaModal').onclick = (e) => {
  if (e.target === e.currentTarget) closeFormulaModal();
};
function closeFormulaModal() {
  const modal = document.getElementById('formulaModal');
  modal.classList.remove('modal-enter');
  modal.classList.add('modal-exit');
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('modal-exit');
  }, 180);
}

// Copy button inside modal
document.getElementById('copyBtn').onclick = () => {
  const ta = document.getElementById('formulaOutput');
  ta.select();
  document.execCommand('copy');
  const txt = document.getElementById('copyBtnText');
  txt.textContent = 'Copied!';
  setTimeout(() => { txt.textContent = 'Copy Formula'; }, 2000);
};


/* ════════════════════════════
   MESSAGES FROM content.js
════════════════════════════ */
let _pendingHistoryEntry = null;

// Persistent Hands-free Batch Execution Queue Engine (saved in chrome.storage.local)
async function startBatchExecution(selectedSessions) {
  const activeBatch = {
    queue: selectedSessions,
    index: 0,
    isActive: true,
    timestamp: Date.now()
  };

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await new Promise(r => chrome.storage.local.set({ activeBatch }, r));
  }

  executeCurrentBatchItem(activeBatch);
}

async function executeCurrentBatchItem(batchData) {
  if (!batchData || !batchData.isActive || batchData.index >= batchData.queue.length) {
    const count = batchData && batchData.queue ? batchData.queue.length : 0;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await new Promise(r => chrome.storage.local.remove('activeBatch', r));
    }
    const btn = document.getElementById('markSelectedBatchBtn');
    if (btn) btn.disabled = false;

    if (count > 0) {
      const banner = document.getElementById('batchSuccessBanner');
      const countEl = document.getElementById('batchSuccessCount');
      if (banner && countEl) {
        countEl.textContent = count;
        banner.style.display = 'block';
      }
    }
    showState('state-input');
    return;
  }

  const session = batchData.queue[batchData.index];
  const statusMsg = document.getElementById('syncStatusMsg');
  if (statusMsg) {
    statusMsg.style.display = 'block';
    statusMsg.style.color = 'var(--violet)';
    statusMsg.textContent = `🚀 Handsfree Batch (${batchData.index + 1}/${batchData.queue.length}): Marking ${session.date} (Group ${session.group})...`;
  }

  const inputEl = document.getElementById('attendanceInput');
  if (inputEl) inputEl.value = JSON.stringify(session.raw);
  showTab('attendance');
  const proceedBtn = document.getElementById('proceedBtn');
  if (proceedBtn) proceedBtn.click();
}

async function checkAndResumeActiveBatch() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['activeBatch'], res => {
      const activeBatch = res.activeBatch;
      if (!activeBatch || !activeBatch.isActive) return;

      const elapsed = Date.now() - (activeBatch.timestamp || 0);
      // Only resume if the submission page refresh occurred within the last 40 seconds
      if (elapsed < 40000 && activeBatch.index < activeBatch.queue.length) {
        console.log('[Haziri] Resuming active batch at index:', activeBatch.index);
        setTimeout(() => executeCurrentBatchItem(activeBatch), 800);
      } else {
        // Stale or old batch left behind — remove it!
        console.log('[Haziri] Wiping stale activeBatch from storage.');
        chrome.storage.local.remove('activeBatch');
      }
    });
  }
}

window.addEventListener('message', async (event) => {
  if (event.data.type === 'COMPLETED') {
    const config      = event.data.config;
    const periods     = (config?.info?.period || []).join(', ');
    const absentRolls = event.data.absentRolls || [];
    const absentText  = absentRolls.length > 0 ? absentRolls.join(', ') : 'none';
    const total       = event.data.totalStudents;

    document.getElementById('doneClass').textContent     = config?.info?.class   || '-';
    document.getElementById('doneSubject').textContent   = config?.info?.subject || '-';
    document.getElementById('doneGroup').textContent     = config?.info?.group   || '-';
    document.getElementById('doneDate').textContent      = config?.info?.date    || '-';
    document.getElementById('donePeriods').textContent   = periods  || '-';
    document.getElementById('doneTotal').textContent     = total ?? '-';
    document.getElementById('donePresent').textContent   = event.data.presentCount ?? '-';
    document.getElementById('doneAbsentees').textContent = absentText;

    if (total === -1) { showState('state-already'); return; }

    document.getElementById('v-class').textContent     = config?.info?.class   || '-';
    document.getElementById('v-subject').textContent   = config?.info?.subject || '-';
    document.getElementById('v-group').textContent     = config?.info?.group   || '-';
    document.getElementById('v-date').textContent      = config?.info?.date    || '-';
    document.getElementById('v-periods').textContent   = periods  || '-';
    document.getElementById('v-total').textContent     = total ?? '-';
    document.getElementById('v-present').textContent   = event.data.presentCount ?? '-';
    document.getElementById('v-absentees').textContent = absentText;

    // Cache for saving to history
    _pendingHistoryEntry = {
      config,
      totalStudents: total,
      presentCount:  event.data.presentCount,
      absentRolls,
      allStudents:   event.data.allStudents || [],
      submittedAt: null
    };

    // Check if running inside active batch
    const activeBatch = await new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['activeBatch'], res => resolve(res.activeBatch || null));
      } else {
        resolve(null);
      }
    });

    if (activeBatch && activeBatch.isActive && (Date.now() - (activeBatch.timestamp || 0) < 40000)) {
      // In hands-free batch mode: Auto submit session and increment batch index in storage
      setTimeout(async () => {
        await handleSubmit({ keepPopupOpen: true });
        
        activeBatch.index++;
        activeBatch.timestamp = Date.now();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await new Promise(r => chrome.storage.local.set({ activeBatch }, r));
        }

        // If batch finished, execute finish check
        if (activeBatch.index >= activeBatch.queue.length) {
          setTimeout(() => executeCurrentBatchItem(activeBatch), 1000);
        }
      }, 400);
      return;
    }

    showState('state-done');

    // Render unmatched students (if any)
    const unmatchedSection = document.getElementById('unmatchedSection');
    const unmatchedList = document.getElementById('unmatchedList');
    const unmatchedStudents = event.data.unmatchedStudents || [];

    if (unmatchedStudents.length > 0) {
      unmatchedSection.style.display = 'block';
      unmatchedList.innerHTML = '';
      unmatchedStudents.forEach(student => {
        const row = document.createElement('div');
        row.className = 'unmatched-row';
        row.innerHTML = `
          <div class="unmatched-info">
            <span class="unmatched-name">${student.name || 'Unknown Name'}</span>
            <span class="unmatched-roll">${student.roll}</span>
          </div>
          <div class="unmatched-actions">
            <button class="unmatched-btn unmatched-btn-p ${!student.isAbsent ? 'active' : ''}" data-index="${student.index}" data-status="P">Present</button>
            <button class="unmatched-btn unmatched-btn-a ${student.isAbsent ? 'active' : ''}" data-index="${student.index}" data-status="A">Absent</button>
          </div>
        `;

        row.querySelectorAll('.unmatched-btn').forEach(btn => {
          btn.onclick = () => {
            const index = btn.dataset.index;
            const status = btn.dataset.status;
            window.parent.postMessage({ type: 'UPDATE_STUDENT', index: parseInt(index, 10), status }, '*');
          };
        });

        unmatchedList.appendChild(row);
      });
    } else {
      unmatchedSection.style.display = 'none';
      unmatchedList.innerHTML = '';
    }

    // Render extra students (if any)
    const extraSection = document.getElementById('extraSection');
    const extraList = document.getElementById('extraList');
    const extraSheetStudents = event.data.extraSheetStudents || [];

    if (extraSheetStudents.length > 0) {
      extraSection.style.display = 'block';
      extraList.innerHTML = '';
      extraSheetStudents.forEach(student => {
        const row = document.createElement('div');
        row.className = 'extra-row';
        const statusClass = student.status === 'A' ? 'extra-status-a' : 'extra-status-p';
        const statusLabel = student.status === 'A' ? 'Absent' : 'Present';
        row.innerHTML = `
          <div class="extra-info">
            <span class="extra-roll">${student.roll}</span>
            <span class="extra-status ${statusClass}">${statusLabel} in sheet</span>
          </div>
        `;
        extraList.appendChild(row);
      });
    } else {
      extraSection.style.display = 'none';
      extraList.innerHTML = '';
    }

    showState('state-done');

  } else if (event.data.type === 'PARSE_ERROR') {
    showState('state-input');
    document.getElementById('error').textContent = 'Invalid config format. Please check and try again.';

  } else if (event.data.type === 'SUBMITTED') {
    window.parent.postMessage({ type: 'CLOSE_POPUP' }, '*');
  }
});

/* ════════════════════════════
   HISTORY — fetches from server (same as mobile app)
════════════════════════════ */

// Keep saveHistoryEntry for local backup only — server is source of truth
function saveHistoryEntry(entry) {
  try {
    const history = JSON.parse(localStorage.getItem('attendanceHistory') || '[]');
    history.unshift(entry);
    if (history.length > 50) history.length = 50;
    localStorage.setItem('attendanceHistory', JSON.stringify(history));
  } catch(_) {}
}

async function markSessionAsCompletedInHistory(config) {
  if (!config || !config.info) return;
  const dateStr = config.info.date;
  const periods = Array.isArray(config.info.period) ? config.info.period.join(',') : config.info.period;
  const grp = config.info.group;
  
  if (!dateStr || !periods || !grp) return;

  function normalizeDate(dStr) {
    if (!dStr) return '';
    const parts = dStr.split(/[\/-]/);
    if (parts.length === 3) {
      let d = parts[0].padStart(2, '0');
      let m = parts[1].padStart(2, '0');
      let y = parts[2];
      if (y.length === 2) y = '20' + y;
      if (d.length === 4) return `${d}-${m}-${y.padStart(2, '0')}`;
      return `${y}-${m}-${d}`;
    }
    return dStr;
  }

  const sig = `${normalizeDate(dateStr)}_${periods}_${grp}`;

  const markedHistory = await new Promise(resolve => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['markedHistory'], res => resolve(res.markedHistory || {}));
    } else {
      resolve({});
    }
  });

  markedHistory[grp] = markedHistory[grp] || { markedSigs: [] };
  if (!markedHistory[grp].markedSigs.includes(sig)) {
    markedHistory[grp].markedSigs.push(sig);
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await new Promise(r => chrome.storage.local.set({ markedHistory: markedHistory }, r));
  }
  console.log('[Haziri] Session recorded in markedHistory:', sig);
}

function formatRelativeTime(isoString) {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 7)   return `${days}d ago`;
    return new Date(isoString).toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
  } catch(_) { return ''; }
}

// Cache fetched sessions so search works instantly
let _cachedSessions = [];

async function fetchHistoryFromServer() {
  const teacherId = (localStorage.getItem('haziriTeacherId') || 'default').trim();
  const res = await fetch(`${SERVER_URL}/api/sessions?limit=200&teacherId=${encodeURIComponent(teacherId)}`);
  const data = await res.json();
  return data.sessions || [];
}

function groupByDate(sessions) {
  const groups = {};
  sessions.forEach(s => {
    const date = s.date || 'Unknown Date';
    if (!groups[date]) groups[date] = [];
    groups[date].push(s);
  });
  return groups;
}

function renderCards(sessions, q) {
  const list      = document.getElementById('histList');
  const empty     = document.getElementById('histEmpty');
  const noResults = document.getElementById('histNoResults');
  const noMsg     = document.getElementById('histNoResultsMsg');
  const count     = document.getElementById('histCount');

  count.textContent = `${_cachedSessions.length} session${_cachedSessions.length !== 1 ? 's' : ''}`;

  if (_cachedSessions.length === 0) {
    empty.style.display = 'flex';
    noResults.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  if (sessions.length === 0) {
    noResults.style.display = 'flex';
    noMsg.textContent = `No sessions match "${q}".`;
    list.innerHTML = '';
    return;
  }
  noResults.style.display = 'none';

  const groups = groupByDate(sessions);
  let html = '';

  Object.entries(groups).forEach(([date, entries]) => {
    html += `<div class="hist-date-group"><div class="hist-date-header">${date}</div>`;
    entries.forEach(s => {
      const periods     = (s.periods || []).join(', ') || '—';
      const group       = s.group   || '—';
      const subj        = s.subject || '—';
      const rel         = formatRelativeTime(s.submittedAt);
      const present     = s.presentCount ?? 0;
      const absent      = (s.absentRolls || []).length;
      const absentRolls = s.absentRolls || [];
      const absentText  = absentRolls.length > 0 ? absentRolls.join(' · ') : null;

      const hl = (str) => {
        if (!q) return str;
        const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
        return str.replace(re, '<mark class="hist-hl">$1</mark>');
      };

      html += `<div class="hist-card ${absentText ? 'hist-card-expandable' : ''}">
        <div class="hist-card-top">
          <div class="hist-card-left">
            <span class="hist-group">${hl(group)}</span>
            <span class="hist-periods">Period ${periods}</span>
          </div>
          <div class="hist-top-right">
            <span class="hist-time">${rel}</span>
            ${absentText ? `<svg class="hist-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>` : ''}
          </div>
        </div>
        <div class="hist-subj">${hl(subj)}</div>
        <div class="hist-stats">
          <span class="hist-stat stat-total">${s.totalStudents ?? '—'} total</span>
          <span class="hist-stat stat-present">✓ ${present} present</span>
          <span class="hist-stat ${absent > 0 ? 'hist-absent-has' : 'hist-absent-none'}">✗ ${absent} absent</span>
        </div>
        ${absentText ? `<div class="hist-absent-panel"><span class="hist-absent-label">Absent</span><span class="hist-absent-rolls">${absentText}</span></div>` : ''}
      </div>`;
    });
    html += `</div>`;
  });

  list.innerHTML = html;

  list.onclick = (e) => {
    const card = e.target.closest('.hist-card-expandable');
    if (card) card.classList.toggle('hist-card-open');
  };
}

function filterAndRender(q) {
  const query = (q || '').trim().toLowerCase();
  const filtered = query
    ? _cachedSessions.filter(s =>
        (s.group   || '').toLowerCase().includes(query) ||
        (s.subject || '').toLowerCase().includes(query) ||
        (s.date    || '').toLowerCase().includes(query)
      )
    : _cachedSessions;
  renderCards(filtered, query);
}

async function renderHistory(query) {
  const list = document.getElementById('histList');
  list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px;">Loading…</div>';
  try {
    _cachedSessions = await fetchHistoryFromServer();
    filterAndRender(query || '');
  } catch(err) {
    list.innerHTML = `<div style="padding:24px;text-align:center;color:var(--red);font-size:12px;">Could not load sessions.<br>${err.message}</div>`;
  }
}

// Open history tab → fetch from server
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    showTab(btn.dataset.tab);
    if (btn.dataset.tab === 'history') {
      renderHistory(document.getElementById('histSearch').value);
    }
  };
});

// Search — filter cached data locally (no extra fetch)
document.getElementById('histSearch').addEventListener('input', function () {
  const val = this.value;
  document.getElementById('histSearchClear').style.display = val ? 'flex' : 'none';
  filterAndRender(val);
});

// Clear search
document.getElementById('histSearchClear').onclick = () => {
  const input = document.getElementById('histSearch');
  input.value = '';
  document.getElementById('histSearchClear').style.display = 'none';
  input.focus();
  filterAndRender('');
};

// Teacher ID save
const teacherSaveBtnEl = document.getElementById('teacherSaveBtn');
if (teacherSaveBtnEl) teacherSaveBtnEl.onclick = saveTeacherIdFromInput;

// Template download
const templateBtn = document.getElementById('templateDownloadBtn');
if (templateBtn) templateBtn.onclick = downloadTemplate;

const teacherDisplayEl = document.getElementById('teacherDisplayWrap');
if (teacherDisplayEl) teacherDisplayEl.onclick = showTeacherEdit;

const teacherInputEl = document.getElementById('teacherIdInput');
if (teacherInputEl) teacherInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveTeacherIdFromInput();
  if (e.key === 'Escape') hideTeacherEdit();
});

// Refresh history from server
document.getElementById('histClearBtn').onclick = () => {
  document.getElementById('histSearch').value = '';
  document.getElementById('histSearchClear').style.display = 'none';
  renderHistory('');
};

/* ════════════════════════════
   AUTO SYNC MODULE
════════════════════════════ */
let autoSyncMappings = [
  { tabName: 'G8', groupName: 'P25AIML-G8' }
];
let currentFetchedPendingSessions = [];

function loadAutoSyncSettings() {
  const masterUrlInput = document.getElementById('masterSheetUrlInput');
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['masterSheetUrl', 'autoSyncMappings'], (res) => {
      if (res.masterSheetUrl && masterUrlInput) {
        masterUrlInput.value = res.masterSheetUrl;
      }
      if (res.autoSyncMappings && Array.isArray(res.autoSyncMappings)) {
        autoSyncMappings = res.autoSyncMappings;
      }
      renderTabMappingsList();
    });
  } else {
    const savedUrl = localStorage.getItem('haziriMasterSheetUrl');
    const savedMap = localStorage.getItem('haziriAutoSyncMappings');
    if (savedUrl && masterUrlInput) masterUrlInput.value = savedUrl;
    if (savedMap) {
      try { autoSyncMappings = JSON.parse(savedMap); } catch(e){}
    }
    renderTabMappingsList();
  }
}

function saveAutoSyncSettings() {
  const masterUrlInput = document.getElementById('masterSheetUrlInput');
  const url = masterUrlInput ? masterUrlInput.value.trim() : '';

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ masterSheetUrl: url, autoSyncMappings: autoSyncMappings }, () => {
      const btn = document.getElementById('saveSheetUrlBtn');
      if (btn) {
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save'; }, 1200);
      }
    });
  } else {
    localStorage.setItem('haziriMasterSheetUrl', url);
    localStorage.setItem('haziriAutoSyncMappings', JSON.stringify(autoSyncMappings));
    const btn = document.getElementById('saveSheetUrlBtn');
    if (btn) {
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save'; }, 1200);
    }
  }
}

function renderTabMappingsList() {
  const container = document.getElementById('tabMappingsList');
  if (!container) return;

  if (!autoSyncMappings || autoSyncMappings.length === 0) {
    container.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">No tab mappings. Click "+ Add Tab" to add one.</div>`;
    return;
  }

  container.innerHTML = autoSyncMappings.map((map, idx) => `
    <div style="display:flex; gap:6px; align-items:center;">
      <input type="text" class="autosync-input" style="flex:1; font-size:11px; padding:4px 6px;"
        placeholder="Sheet Tab (e.g. G8)" value="${map.tabName || ''}" data-idx="${idx}" data-field="tabName">
      <input type="text" class="autosync-input" style="flex:1; font-size:11px; padding:4px 6px;"
        placeholder="Group (e.g. P25AIML-G8)" value="${map.groupName || ''}" data-idx="${idx}" data-field="groupName">
      <button class="remove-tab-map-btn btn btn-flat" data-idx="${idx}" style="padding:2px 6px; font-size:11px; color:var(--red);">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('input').forEach(input => {
    input.oninput = function() {
      const idx = parseInt(this.dataset.idx, 10);
      const field = this.dataset.field;
      if (autoSyncMappings[idx]) {
        autoSyncMappings[idx][field] = this.value;
        saveAutoSyncSettings();
      }
    };
  });

  container.querySelectorAll('.remove-tab-map-btn').forEach(btn => {
    btn.onclick = function() {
      const idx = parseInt(this.dataset.idx, 10);
      autoSyncMappings.splice(idx, 1);
      saveAutoSyncSettings();
      renderTabMappingsList();
    };
  });

  attachAutoSyncKeyNavigation();
}

function attachAutoSyncKeyNavigation() {
  const masterUrlInput = document.getElementById('masterSheetUrlInput');
  const mappingInputs  = Array.from(document.querySelectorAll('#tabMappingsList input'));

  if (masterUrlInput) {
    masterUrlInput.onkeydown = function(e) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        const firstMappingInput = document.querySelector('#tabMappingsList input');
        if (firstMappingInput) firstMappingInput.focus();
      }
    };
  }

  mappingInputs.forEach(input => {
    input.onkeydown = function(e) {
      const idx = parseInt(this.dataset.idx, 10);
      const field = this.dataset.field;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextInput = document.querySelector(`#tabMappingsList input[data-idx="${idx + 1}"][data-field="${field}"]`);
        if (nextInput) {
          nextInput.focus();
        } else {
          autoSyncMappings.push({ tabName: '', groupName: '' });
          saveAutoSyncSettings();
          renderTabMappingsList();
          setTimeout(() => {
            const newlyCreatedInput = document.querySelector(`#tabMappingsList input[data-idx="${idx + 1}"][data-field="${field}"]`);
            if (newlyCreatedInput) newlyCreatedInput.focus();
          }, 50);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (field === 'tabName') {
          const rightInput = document.querySelector(`#tabMappingsList input[data-idx="${idx}"][data-field="groupName"]`);
          if (rightInput) rightInput.focus();
        } else {
          const nextInput = document.querySelector(`#tabMappingsList input[data-idx="${idx + 1}"][data-field="tabName"]`);
          if (nextInput) {
            nextInput.focus();
          } else {
            autoSyncMappings.push({ tabName: '', groupName: '' });
            saveAutoSyncSettings();
            renderTabMappingsList();
            setTimeout(() => {
              const newlyCreatedInput = document.querySelector(`#tabMappingsList input[data-idx="${idx + 1}"][data-field="tabName"]`);
              if (newlyCreatedInput) newlyCreatedInput.focus();
            }, 50);
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (idx === 0) {
          if (masterUrlInput) masterUrlInput.focus();
        } else {
          const prevInput = document.querySelector(`#tabMappingsList input[data-idx="${idx - 1}"][data-field="${field}"]`);
          if (prevInput) prevInput.focus();
        }
      } else if (e.key === 'ArrowRight' && field === 'tabName') {
        if (this.selectionStart === this.value.length) {
          e.preventDefault();
          const rightInput = document.querySelector(`#tabMappingsList input[data-idx="${idx}"][data-field="groupName"]`);
          if (rightInput) rightInput.focus();
        }
      } else if (e.key === 'ArrowLeft' && field === 'groupName') {
        if (this.selectionStart === 0) {
          e.preventDefault();
          const leftInput = document.querySelector(`#tabMappingsList input[data-idx="${idx}"][data-field="tabName"]`);
          if (leftInput) leftInput.focus();
        }
      }
    };
  });
}

function updatePendingSelectionSummary() {
  const toolbar = document.getElementById('pendingToolbar');
  const countEl = document.getElementById('pendingSelectionCount');
  const batchBtn = document.getElementById('markSelectedBatchBtn');
  const selectAllCheck = document.getElementById('selectAllPendingCheck');

  const checkboxes = document.querySelectorAll('.pending-card-check-item');
  const validCheckboxes = Array.from(checkboxes).filter(c => !c.disabled);
  const checkedItems = Array.from(checkboxes).filter(c => c.checked && !c.disabled);

  if (selectAllCheck) {
    selectAllCheck.checked = validCheckboxes.length > 0 && checkedItems.length === validCheckboxes.length;
  }

  if (countEl) {
    let totalAbs = 0;
    checkedItems.forEach(cb => {
      const idx = parseInt(cb.dataset.idx, 10);
      if (currentFetchedPendingSessions[idx]) {
        totalAbs += (currentFetchedPendingSessions[idx].absenteeCount || 0);
      }
    });
    countEl.textContent = `${checkedItems.length} selected (${totalAbs} Absentees)`;
  }

  if (batchBtn) {
    batchBtn.style.display = checkedItems.length > 0 ? 'flex' : 'none';
    batchBtn.innerHTML = `⚡ Mark ${checkedItems.length} Selected Session${checkedItems.length > 1 ? 's' : ''} in Batch`;
  }
}

async function fetchAndRenderPendingSessions() {
  const statusMsg = document.getElementById('syncStatusMsg');
  const emptyMsg  = document.getElementById('pendingQueueEmpty');
  const listEl    = document.getElementById('pendingQueueList');
  const fetchBtn  = document.getElementById('syncFetchBtn');
  const toolbar   = document.getElementById('pendingToolbar');
  const batchBtn  = document.getElementById('markSelectedBatchBtn');
  const masterUrlInput = document.getElementById('masterSheetUrlInput');

  const sheetUrl = masterUrlInput ? masterUrlInput.value.trim() : '';
  if (!sheetUrl) {
    alert('Please enter a Google Sheet URL first.');
    return;
  }

  if (statusMsg) {
    statusMsg.style.display = 'block';
    statusMsg.style.color = 'var(--text-muted)';
    statusMsg.textContent = 'Scanning Google Sheet tabs...';
  }
  if (fetchBtn) fetchBtn.disabled = true;

  try {
    const markedHistory = await new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['markedHistory'], res => resolve(res.markedHistory || {}));
      } else {
        resolve({});
      }
    });

    const pending = await SheetSync.fetchPendingSessions(sheetUrl, autoSyncMappings, markedHistory);
    currentFetchedPendingSessions = pending || [];

    if (fetchBtn) fetchBtn.disabled = false;

    if (!pending || pending.length === 0) {
      if (statusMsg) statusMsg.textContent = '✓ All sessions up to date!';
      if (emptyMsg) {
        emptyMsg.style.display = 'block';
        emptyMsg.innerHTML = '🎉 All sessions in Google Sheet are already marked!';
      }
      if (listEl) listEl.innerHTML = '';
      if (toolbar) toolbar.style.display = 'none';
      if (batchBtn) batchBtn.style.display = 'none';
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    if (statusMsg) statusMsg.textContent = `Found ${pending.length} pending session(s) ready to mark:`;
    if (toolbar) toolbar.style.display = 'flex';

    if (listEl) {
      listEl.innerHTML = pending.map((item, idx) => {
        if (item.error) {
          return `
            <div style="padding:8px 10px; border-radius:var(--radius); background:rgba(220,38,38,0.08); border:1px solid rgba(220,38,38,0.25); color:var(--red); font-size:11px;">
              ⚠️ Error in tab <strong>"${item.targetTab}"</strong>: ${item.errorMessage}
            </div>
          `;
        }

        const dateStr = item.date || item.normalizedDate;
        const periodsStr = Array.isArray(item.period) ? item.period.join(', ') : item.period;
        const groupStr = item.group || item.mappedGroupName;

        const warningHtml = item.hasMismatch ? `
          <div style="margin-top:4px; font-size:10px; font-weight:700; color:var(--red); background:#fef2f2; border:1px solid rgba(220,38,38,0.25); padding:3px 6px; border-radius:4px; display:flex; align-items:center; gap:4px;">
            <span>⚠️ Attendance Error: Sheet has ${item.totalStudentsInTab} students, but column has ${item.recordedTotal} recorded (${item.presentCount} P + ${item.absenteeCount} A). ${Math.abs(item.missingCount)} un-marked in sheet! (Excluded from batch)</span>
          </div>
        ` : '';

        return `
          <div class="pending-card" style="${item.hasMismatch ? 'border-color:rgba(220,38,38,0.3); background:#fff5f5; opacity:0.85;' : ''}">
            <input type="checkbox" class="pending-card-check pending-card-check-item" data-idx="${idx}" ${item.hasMismatch ? 'disabled title="Disabled due to attendance mismatch in sheet"' : 'checked'}>
            <div class="pending-card-info">
              <div class="pending-card-title">
                📅 ${dateStr} &nbsp;•&nbsp; Period [${periodsStr}]
              </div>
              <div class="pending-card-sub">
                Group: <strong>${groupStr}</strong> &nbsp;•&nbsp; Absentees: <span class="pending-badge-absent">${item.absenteeCount}</span>
              </div>
              ${warningHtml}
            </div>
          </div>
        `;
      }).join('');

      // Wire checkboxes
      listEl.querySelectorAll('.pending-card-check-item').forEach(cb => {
        cb.onchange = updatePendingSelectionSummary;
      });

      updatePendingSelectionSummary();
    }

  } catch (err) {
    if (fetchBtn) fetchBtn.disabled = false;
    if (statusMsg) {
      statusMsg.style.display = 'block';
      statusMsg.style.color = 'var(--red)';
      statusMsg.textContent = 'Error: ' + err.message;
    }
  }
}

// Select All Toggle Handler
const selectAllCheck = document.getElementById('selectAllPendingCheck');
if (selectAllCheck) {
  selectAllCheck.onchange = function() {
    const isChecked = this.checked;
    document.querySelectorAll('.pending-card-check-item').forEach(cb => {
      if (!cb.disabled) {
        cb.checked = isChecked;
      }
    });
    updatePendingSelectionSummary();
  };
}

// Batch Execute Selected Sessions Button Handler
const markSelectedBatchBtn = document.getElementById('markSelectedBatchBtn');
if (markSelectedBatchBtn) {
  markSelectedBatchBtn.onclick = async function() {
    const checkedBoxes = Array.from(document.querySelectorAll('.pending-card-check-item')).filter(cb => cb.checked);
    if (checkedBoxes.length === 0) {
      alert('Please select at least one pending session.');
      return;
    }

    const selectedSessions = checkedBoxes.map(cb => currentFetchedPendingSessions[parseInt(cb.dataset.idx, 10)]).filter(Boolean);

    markSelectedBatchBtn.disabled = true;

    const modal = document.getElementById('pendingModal');
    if (modal) modal.style.display = 'none';

    startBatchExecution(selectedSessions);
  };
}

// Pending Sessions Modal Controls
const findPendingBtn = document.getElementById('findPendingSessionsBtn');
if (findPendingBtn) {
  findPendingBtn.onclick = function() {
    const modal = document.getElementById('pendingModal');
    if (modal) modal.style.display = 'flex';
    fetchAndRenderPendingSessions();
  };
}

const pendingCloseBtn = document.getElementById('pendingModalClose');
if (pendingCloseBtn) {
  pendingCloseBtn.onclick = function() {
    const modal = document.getElementById('pendingModal');
    if (modal) modal.style.display = 'none';
  };
}

const pendingRefreshBtn = document.getElementById('pendingModalRefreshBtn');
if (pendingRefreshBtn) {
  pendingRefreshBtn.onclick = function() {
    fetchAndRenderPendingSessions();
  };
}

// Auto Sync Event Listeners
const saveSheetUrlBtn = document.getElementById('saveSheetUrlBtn');
if (saveSheetUrlBtn) saveSheetUrlBtn.onclick = saveAutoSyncSettings;

const addTabMappingBtn = document.getElementById('addTabMappingBtn');
if (addTabMappingBtn) {
  addTabMappingBtn.onclick = function() {
    autoSyncMappings.push({ tabName: '', groupName: '' });
    saveAutoSyncSettings();
    renderTabMappingsList();
  };
}

const syncFetchBtn = document.getElementById('syncFetchBtn');
if (syncFetchBtn) syncFetchBtn.onclick = fetchAndRenderPendingSessions;

const clearMarkedMemoryBtn = document.getElementById('clearMarkedMemoryBtn');
if (clearMarkedMemoryBtn) {
  clearMarkedMemoryBtn.onclick = async function() {
    if (confirm('Are you sure you want to reset marked sessions memory? This will make all sheet sessions fetchable again.')) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await new Promise(r => chrome.storage.local.set({ markedHistory: {} }, r));
      }
      localStorage.removeItem('haziriMarkedHistory');
      alert('✓ Marked sessions memory has been reset! You can now re-fetch pending sessions.');
    }
  };
}

// Load settings and resume active batch on startup
loadAutoSyncSettings();
checkAndResumeActiveBatch();


