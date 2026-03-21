(function () {

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
        const frame = document.createElement("iframe");
        frame.id = "attendancePopupFrame";
        frame.src = chrome.runtime.getURL("popup.html");
        document.body.appendChild(frame);
      }
    };
  }

  let cancelled = false;

  function removePopup() {
    document.getElementById("attendancePopupFrame")?.remove();
  }

  window.addEventListener("message", (event) => {
    const type = event.data.type;

    if (type === "CANCEL_ATTENDANCE" || type === "CLOSE_POPUP") {
      cancelled = true;
      removePopup();
      return;
    }
    // Relay server save from popup iframe → background service worker
    if (type === 'RELAY_TO_SERVER') {
      chrome.runtime.sendMessage({ type: 'SAVE_SESSION', entry: event.data.entry })
        .then(data => {
          if (data && data.success) console.log('[Attendance] Saved to server, id:', data.id);
          else console.warn('[Attendance] Server save failed:', data && data.error);
        })
        .catch(err => console.warn('[Attendance] Could not save to server:', err.message));
      return;
    }


    if (type === "SUBMIT_ATTENDANCE") {
      const submitBtn = document.querySelector('input.submitBtn[onclick*="initData"]');
      if (submitBtn) {
        submitBtn.click();
        setTimeout(removePopup, 500);
      } else {
        alert("Submit button not found on page.");
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
    const absentees      = (config?.absentees || []).map(String).sort();
    const normalize      = s => s.replace(/\s+/g, ' ').trim();

    function step(fn, delay) {
      setTimeout(() => { if (!cancelled) fn(); }, delay);
    }

    // Find a radio input by matching label.radio text — same pattern as selectClass/Subject/Group
    function findRadioByLabel(groupSelector, text) {
      const lbl = [...document.querySelectorAll(`${groupSelector} label.radio`)]
        .find(l => normalize(l.textContent) === normalize(text));
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
    const waitSecond = setInterval(() => {
      if (cancelled) { clearInterval(waitSecond); return; }
      const btn2 = document.querySelector("#periodSlotId + .btn-group .dropdown-toggle");
      if (btn2) {
        if (!periodSlotText) {
          clearInterval(waitSecond);
          step(selectPeriods, 700);
          return;
        }
        btn2.click();
        setTimeout(() => {
          if (cancelled) return;
          const r = findRadioByLabel('#periodSlotId + .btn-group', periodSlotText);
          if (r) { r.click(); clearInterval(waitSecond); step(selectPeriods, 700); }
        }, 400);
      }
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
            const v = 16 + slot;
            const o = sel.querySelector(`option[value="${v}"]`);
            if (o) o.selected = true;
            const cb = document.querySelector(`#periodId + .btn-group input[value="${v}"]`);
            if (cb && !cb.checked) cb.click();
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
        const lbl = [...document.querySelectorAll("#classId + .btn-group label.radio")]
          .find(l => normalize(l.textContent) === normalize(classText));
        if (lbl) {
          const r = lbl.querySelector('input[type="radio"]');
          if (r) r.click();
          if (sel) { sel.value = r.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
          step(selectSubject, 700);
        }
      }, 400);
    }

    function selectSubject() {
      if (!subjectText) { step(selectGroup, 0); return; }
      const sel = document.getElementById("subjectId");
      document.querySelector("#subjectId + .btn-group .dropdown-toggle")?.click();
      step(() => {
        const lbl = [...document.querySelectorAll("#subjectId + .btn-group label.radio")]
          .find(l => normalize(l.textContent) === normalize(subjectText));
        if (lbl) {
          const r = lbl.querySelector('input[type="radio"]');
          if (r) r.click();
          if (sel) { sel.value = r.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
          step(selectGroup, 700);
        }
      }, 400);
    }

    function selectGroup() {
      if (!groupText) { step(showStudentList, 0); return; }
      const sel = document.getElementById("groupId");
      document.querySelector("#groupId + .btn-group .dropdown-toggle")?.click();
      step(() => {
        const lbl = [...document.querySelectorAll("#groupId + .btn-group label.radio")]
          .find(l => normalize(l.textContent) === normalize(groupText));
        if (lbl) {
          const r = lbl.querySelector('input[type="radio"]');
          if (r) r.click();
          if (sel) { sel.value = r.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
          step(showStudentList, 2000);
        }
      }, 400);
    }

    function showStudentList() {
      const btn = document.getElementById("submitAttendance");
      if (btn) { btn.click(); step(markAbsentees, 2000); }
    }

    function markAbsentees() {
      const boxes = document.getElementsByClassName("selectbox_med");
      const totalStudents = boxes.length - 1;

      if (absentees.length > 0) {
        let j = 0;
        for (let i = 1; i < boxes.length; i++) {
          const roll = boxes[i].parentElement.previousElementSibling
            .previousElementSibling.innerText.trim();
          if (roll === absentees[j]) {
            const parts = boxes[i].value.split('|');
            boxes[i].value = `${parts[0]}|2`;
            boxes[i].dispatchEvent(new Event("change", { bubbles: true }));
            j++;
            if (j >= absentees.length) break;
          }
        }
      }

      let absentRolls = [];
      let presentCount = 0;
      let allStudents = [];

      for (let i = 1; i < boxes.length; i++) {
        const row  = boxes[i].parentElement.previousElementSibling.previousElementSibling;
        const roll = row.innerText.trim();
        // Name is usually the next sibling cell after roll
        const nameCell = row.nextElementSibling;
        const name = nameCell ? nameCell.innerText.trim() : '';
        const isAbsent = boxes[i].value.endsWith("|2");

        allStudents.push({ roll, name, status: isAbsent ? 'A' : 'P' });

        if (isAbsent) {
          absentRolls.push(roll);
        } else {
          presentCount++;
        }
      }

      const frame = document.getElementById("attendancePopupFrame");
      if (frame) frame.contentWindow.postMessage({
        type: "COMPLETED",
        config,
        totalStudents,
        presentCount,
        absentRolls,
        allStudents
      }, "*");
    }
  }

})();
