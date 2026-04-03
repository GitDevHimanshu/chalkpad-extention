/* ════════════════════════════
   SERVER CONFIG
════════════════════════════ */
const SERVER_URL = 'https://chalkpad-attendance.onrender.com';

function postToServer(entry) {
  const teacherId = (localStorage.getItem('haziriTeacherId') || 'default').trim().toLowerCase();
  window.parent.postMessage({ type: 'RELAY_TO_SERVER', entry: { ...entry, teacherId } }, '*');
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
const TABS = ['attendance', 'formula', 'sheet', 'history'];

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

const handleSubmit = () => {
  if (_pendingHistoryEntry) {
    _pendingHistoryEntry.submittedAt = new Date().toISOString();
    saveHistoryEntry(_pendingHistoryEntry);
    postToServer(_pendingHistoryEntry);   // also save to MongoDB
    _pendingHistoryEntry = null;
  }
  window.parent.postMessage({ type: 'SUBMIT_ATTENDANCE' }, '*');
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
  const input   = document.getElementById('attendanceInput').value.trim();
  const errorEl = document.getElementById('error');
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
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('attendanceSettings') || '{}');
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
    try {
      localStorage.setItem('attendanceSettings', JSON.stringify(
        { startCol: sc, rowStart: rs, rowEnd: re,
          settingsClass: cls, settingsSubject: sub, settingsGroup: grp,
          settingsTimeTable: tt, settingsPeriodSlot: ps }
      ));
    } catch(_) {}

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

window.addEventListener('message', (event) => {
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

    // Cache for saving to history when user actually presses Submit
    _pendingHistoryEntry = {
      config,
      totalStudents: total,
      presentCount:  event.data.presentCount,
      absentRolls,
      allStudents:   event.data.allStudents || [],
      submittedAt: null
    };

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
