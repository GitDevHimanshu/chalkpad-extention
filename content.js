(function () {

  function createPopupFrame() {
    let frame = document.getElementById("attendancePopupFrame");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = "attendancePopupFrame";
      frame.src = chrome.runtime.getURL("popup.html");
      document.body.appendChild(frame);
    }
    return frame;
  }

  if (!document.getElementById("attendanceFloatingBtn")) {
    const btn = document.createElement("button");
    btn.id = "attendanceFloatingBtn";
    document.body.appendChild(btn);

    btn.onclick = () => {
      const existing = document.getElementById("attendancePopupFrame");
      if (existing) {
        cancelled = true;
        existing.remove();
      } else {
        createPopupFrame();
      }
    };
  }

  // Auto-reopen popup frame after submission page reload if batch is actively running
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['activeBatch'], (res) => {
      const activeBatch = res.activeBatch;
      if (activeBatch && activeBatch.isActive && activeBatch.index < activeBatch.queue.length) {
        const elapsed = Date.now() - (activeBatch.timestamp || 0);
        if (elapsed < 60000) {
          console.log('[Haziri Content] Active batch detected on page reload. Auto-opening popup frame for session', activeBatch.index + 1);
          createPopupFrame();
        }
      }
    });
  }



  let cancelled = false;
  let currentConfig = null;
  let currentAbsentees = [];
  let currentPresents = [];

  function removePopup() {
    document.getElementById("attendancePopupFrame")?.remove();
  }

  function sendCompletedData() {
    const boxes = document.getElementsByClassName("selectbox_med");
    const totalStudents = boxes.length - 1;

    let absentRolls = [];
    let presentCount = 0;
    let allStudents = [];
    let unmatchedStudents = [];

    const absenteeSet = new Set(currentAbsentees);
    const presentSet = new Set(currentPresents);
    const portalRolls = new Set();

    for (let i = 1; i < boxes.length; i++) {
      const parent = boxes[i].parentElement;
      const sib1 = parent ? parent.previousElementSibling : null;
      const sib2 = sib1 ? sib1.previousElementSibling : null;
      if (!sib2) continue;

      const roll = sib2.innerText.trim();
      portalRolls.add(roll);
      const nameCell = sib1;
      const name = nameCell ? nameCell.innerText.trim() : '';
      const isAbsent = boxes[i].value.endsWith("|2");

      allStudents.push({ roll, name, status: isAbsent ? 'A' : 'P' });

      if (!absenteeSet.has(roll) && !presentSet.has(roll)) {
        unmatchedStudents.push({
          roll,
          name,
          index: i,
          isAbsent
        });
      }

      if (isAbsent) {
        absentRolls.push(roll);
      } else {
        presentCount++;
      }
    }

    const extraSheetStudents = [];
    currentAbsentees.forEach(roll => {
      if (!portalRolls.has(roll)) {
        extraSheetStudents.push({ roll, status: 'A' });
      }
    });
    currentPresents.forEach(roll => {
      if (!portalRolls.has(roll)) {
        extraSheetStudents.push({ roll, status: 'P' });
      }
    });

    const frame = document.getElementById("attendancePopupFrame");
    if (frame) frame.contentWindow.postMessage({
      type: "COMPLETED",
      config: currentConfig,
      totalStudents,
      presentCount,
      absentRolls,
      allStudents,
      unmatchedStudents,
      extraSheetStudents
    }, "*");
  }

  window.addEventListener("message", (event) => {
    // Safety check for cross-origin messages
    if (!event.data || typeof event.data !== 'object') return;

    const type = event.data.type;

    if (type === "CANCEL_ATTENDANCE" || type === "CLOSE_POPUP") {
      cancelled = true;
      removePopup();
      return;
    }

    // Relay server save from popup iframe → background service worker
    if (type === 'RELAY_TO_SERVER') {
      console.log('[Attendance] Relaying save request to background...');
      chrome.runtime.sendMessage({ type: 'SAVE_SESSION', entry: event.data.entry }, (data) => {
        if (data && data.success) console.log('[Attendance] Saved to server, id:', data.id);
        else console.warn('[Attendance] Server save failed:', data && data.error);
      });
      return;
    }

    if (type === "UPDATE_STUDENT") {
      const { index, status } = event.data;
      const boxes = document.getElementsByClassName("selectbox_med");
      if (boxes[index]) {
        const parts = boxes[index].value.split('|');
        boxes[index].value = `${parts[0]}|${status === 'A' ? '2' : '1'}`;
        boxes[index].dispatchEvent(new Event("change", { bubbles: true }));
        sendCompletedData();
      }
      return;
    }


  function findSubmitButton() {
    // Priority 1: Exact class and onclick attribute matching initData
    let btn = document.querySelector('input.submitBtn[onclick*="initData"]');
    if (btn) return btn;

    // Priority 2: Any element with class submitBtn and onclick containing initData
    btn = document.querySelector('.submitBtn[onclick*="initData"], [onclick*="initData"]');
    if (btn) return btn;

    // Priority 3: Any input/button with submitBtn class (excluding fetch button #submitAttendance)
    const submitBtns = [...document.querySelectorAll('.submitBtn')];
    btn = submitBtns.find(b => b.id !== 'submitAttendance' && b.id !== 'attendanceFloatingBtn');
    if (btn) return btn;

    // Priority 4: Look for save/submit buttons by value, text, name, src or onclick
    const allBtns = [...document.querySelectorAll('input[type="button"], input[type="image"], input[type="submit"], button')];
    btn = allBtns.find(b => {
      if (b.id === 'submitAttendance' || b.id === 'attendanceFloatingBtn') return false;
      const onclickStr = (b.getAttribute('onclick') || '').toLowerCase();
      const valueStr = (b.value || b.textContent || '').toLowerCase();
      const nameStr = (b.name || b.id || '').toLowerCase();
      const srcStr = (b.src || '').toLowerCase();
      return onclickStr.includes('initdata') || onclickStr.includes('save') || onclickStr.includes('submit') || onclickStr.includes('insert') ||
             valueStr.includes('save') || valueStr.includes('submit') || nameStr.includes('save') || nameStr.includes('submit') ||
             srcStr.includes('save') || srcStr.includes('submit');
    });

    return btn;
  }

    if (type === "SUBMIT_ATTENDANCE") {
      const submitBtn = findSubmitButton();
      const frame = document.getElementById("attendancePopupFrame");

      if (submitBtn) {
        console.log("[Haziri Content] Executing submission click on:", submitBtn);

        try {
          if (typeof submitBtn.onclick === 'function') {
            submitBtn.onclick();
          }
        } catch (e) {
          console.warn("[Haziri Content] Error calling submitBtn.onclick():", e);
        }

        submitBtn.click();

        // Fallback: If submitBtn belongs to a form, submit after short delay if click didn't trigger navigation
        if (submitBtn.form) {
          setTimeout(() => {
            try {
              if (typeof submitBtn.form.onsubmit === 'function') {
                submitBtn.form.onsubmit();
              }
              submitBtn.form.submit();
            } catch (e) {
              console.warn("[Haziri Content] Error calling submitBtn.form.submit():", e);
            }
          }, 300);
        }

        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: "SUBMIT_SUCCESS" }, "*");
        }

        if (!event.data?.keepPopupOpen) {
          setTimeout(removePopup, 500);
        }
      } else {
        console.error("[Haziri Content] Submit button not found on Chalkpad page.");
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({
            type: "SUBMIT_ERROR",
            error: "Submit button not found on Chalkpad page. Please make sure student list is loaded."
          }, "*");
        }
        if (!event.data?.keepPopupOpen) {
          removePopup();
        }
      }
      return;
    }

    if (type !== "RUN_ATTENDANCE") return;

    cancelled = false;

    let raw = event.data.raw;
    raw = raw.trim().replace(/\r?\n/g, "");

    let config;
    try {
      config = JSON.parse(raw);
    } catch (_) {
      try {
        const tmp = raw
          .replace(/([\{,\s])([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":')
          .replace(/'([^']*)'/g, '"$1"')
          .replace(/,\s*([}\]])/g, '$1');
        config = JSON.parse(tmp);
      } catch (_2) {
        try {
          config = eval("(" + raw + ")");
        } catch (e) {
          const frame = document.getElementById("attendancePopupFrame");
          if (frame) frame.contentWindow.postMessage({ type: "PARSE_ERROR" }, "*");
          return;
        }
      }
    }

    if (!document.getElementById("submitAttendance")) {
      alert("Please open Chalkpad > Academics > Mark Attendance page first.");
      return;
    }

    runAttendance(config);
  });


  function runAttendance(config) {
    const periodArray    = config?.info?.period     || [];
    const dateValue      = config?.info?.date       || "";
    const classText      = config?.info?.class      || "";
    const subjectText    = config?.info?.subject    || "";
    const groupText      = config?.info?.group      || "";
    const timeTableText  = config?.info?.timeTable  || "";
    const periodSlotText = config?.info?.periodSlot || "";
    currentConfig = config;
    currentAbsentees = (config?.absentees || []).map(String);
    currentPresents = (config?.presents || []).map(String);
    const absentees      = currentAbsentees;
    const presents       = currentPresents;
    const normalize      = s => s.replace(/\s+/g, ' ').trim();

    function step(fn, delay) {
      setTimeout(() => { if (!cancelled) fn(); }, delay);
    }

    // Find a radio input by matching label.radio text with resilient fuzzy matching
    function findRadioByLabel(groupSelector, text) {
      if (!text) return null;
      const labels = [...document.querySelectorAll(`${groupSelector} label.radio`)];
      if (labels.length === 0) return null;

      const targetNorm = normalize(text);
      const targetClean = text.replace(/[\s\(\)\-\:_]/g, '').toLowerCase();

      // 1. Exact normalized match
      let lbl = labels.find(l => normalize(l.textContent) === targetNorm);

      // 2. Cleaned character match (ignoring spaces, hyphens, parens)
      if (!lbl && targetClean) {
        lbl = labels.find(l => {
          const clean = l.textContent.replace(/[\s\(\)\-\:_]/g, '').toLowerCase();
          return clean === targetClean || clean.includes(targetClean) || targetClean.includes(clean);
        });
      }

      // 3. Fallback: Substring match
      if (!lbl) {
        lbl = labels.find(l => l.textContent.toLowerCase().includes(text.toLowerCase()) || text.toLowerCase().includes(l.textContent.toLowerCase().trim()));
      }

      // 4. Fallback: If only 1 radio option exists, use it
      if (!lbl && labels.length === 1) {
        lbl = labels[0];
      }

      if (!lbl) return null;
      return lbl.querySelector('input[type="radio"]');
    }

    // STEP 1 — Time Table (session): only act if value provided
    if (timeTableText) {
      const toggle = document.querySelector("#timeTablelLabelId + .btn-group .dropdown-toggle");
      if (toggle) toggle.click();
      step(() => {
        const r = findRadioByLabel('#timeTablelLabelId + .btn-group', timeTableText);
        if (r) r.click();
      }, 500);
    }

    // STEP 2 — Period Slot (semester): only act if value provided, then proceed to selectPeriods
    let slotRetries = 0;
    const waitSecond = setInterval(() => {
      if (cancelled) { clearInterval(waitSecond); return; }
      slotRetries++;

      const btn2 = document.querySelector("#periodSlotId + .btn-group .dropdown-toggle");
      
      // If no period slot text provided, no button found, or timed out after 8 retries (~3.2s)
      if (!periodSlotText || !btn2 || slotRetries > 8) {
        clearInterval(waitSecond);
        step(selectPeriods, 700);
        return;
      }

      btn2.click();
      setTimeout(() => {
        if (cancelled) return;
        const r = findRadioByLabel('#periodSlotId + .btn-group', periodSlotText);
        if (r) {
          r.click();
          clearInterval(waitSecond);
          step(selectPeriods, 700);
        } else if (slotRetries >= 5) {
          // If custom matching failed 5 times, select first available option as fallback
          const firstRadio = document.querySelector('#periodSlotId + .btn-group label.radio input[type="radio"]');
          if (firstRadio) firstRadio.click();
          clearInterval(waitSecond);
          step(selectPeriods, 700);
        }
      }, 400);
    }, 400);

    function selectPeriods() {
      const sel = document.getElementById("periodId");
      if (!sel) return;

      const toggle = document.querySelector("#periodId + .btn-group .dropdown-toggle");
      if (toggle) toggle.click();

      step(() => {
        const alreadyChecked = document.querySelectorAll(
          '#periodId + .btn-group input[type="checkbox"]:checked:not([value="multiselect-all"])'
        );
        alreadyChecked.forEach(cb => cb.click());

        step(() => {
          periodArray.forEach(slot => {
            const labels = [...document.querySelectorAll('#periodId + .btn-group label.checkbox')];
            const targetLabel = labels.find(l => {
              const text = l.textContent.trim();
              return text.startsWith(slot + " (") || text === String(slot);
            });

            if (targetLabel) {
              const cb = targetLabel.querySelector('input[type="checkbox"]');
              if (cb) {
                if (!cb.checked) cb.click();
                const realVal = cb.value;
                const o = sel.querySelector(`option[value="${realVal}"]`);
                if (o) o.selected = true;
              }
            }
          });
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          step(setDate, 500);
        }, 500);
      }, 400);
    }

    function setDate() {
      const di = document.getElementById("txtFromDate");
      if (!di) return;
      di.removeAttribute("readonly");
      di.value = dateValue;
      di.dispatchEvent(new Event("change", { bubbles: true }));
      step(selectClass, 500);
    }

    function selectClass() {
      if (!classText) { step(selectSubject, 0); return; }
      const sel = document.getElementById("classId");
      document.querySelector("#classId + .btn-group .dropdown-toggle")?.click();
      step(() => {
        const r = findRadioByLabel('#classId + .btn-group', classText);
        if (r) {
          r.click();
          if (sel) { sel.value = r.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
        }
        step(selectSubject, 700);
      }, 400);
    }

    function selectSubject() {
      if (!subjectText) { step(selectGroup, 0); return; }
      const sel = document.getElementById("subjectId");
      document.querySelector("#subjectId + .btn-group .dropdown-toggle")?.click();
      step(() => {
        const r = findRadioByLabel('#subjectId + .btn-group', subjectText);
        if (r) {
          r.click();
          if (sel) { sel.value = r.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
        }
        step(selectGroup, 700);
      }, 400);
    }

    function selectGroup() {
      if (!groupText) { step(showStudentList, 0); return; }
      const sel = document.getElementById("groupId");
      document.querySelector("#groupId + .btn-group .dropdown-toggle")?.click();
      step(() => {
        const r = findRadioByLabel('#groupId + .btn-group', groupText);
        if (r) {
          r.click();
          if (sel) { sel.value = r.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
        }
        step(showStudentList, 2000);
      }, 400);
    }

    function showStudentList() {
      const btn = document.getElementById("submitAttendance");
      if (btn) { btn.click(); step(markAbsentees, 2000); }
    }

    function markAbsentees() {
      const boxes = document.getElementsByClassName("selectbox_med");

      if (absentees.length > 0 || presents.length > 0) {
        const absenteeSet = new Set(absentees);
        const presentSet = new Set(presents);
        for (let i = 1; i < boxes.length; i++) {
          const parent = boxes[i]?.parentElement;
          const sib1 = parent ? parent.previousElementSibling : null;
          const sib2 = sib1 ? sib1.previousElementSibling : null;
          if (!sib2) continue;

          const roll = sib2.innerText ? sib2.innerText.trim() : '';
          if (!roll) continue;

          if (absenteeSet.has(roll)) {
            const parts = boxes[i].value.split('|');
            boxes[i].value = `${parts[0]}|2`;
            boxes[i].dispatchEvent(new Event("change", { bubbles: true }));
          } else if (presentSet.has(roll)) {
            const parts = boxes[i].value.split('|');
            boxes[i].value = `${parts[0]}|1`;
            boxes[i].dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }

      sendCompletedData();
    }
  }

})();
