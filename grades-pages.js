// Grade entry page, exports and the student grade view.

const XLSX = require('xlsx');
const { layout, teacherNav, esc } = require('./dashboard-pages');
const { fieldDefs, visibleItemDefs, isBlank } = require('./grades');

const f2 = n => (n == null ? '' : (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2));

// Data the browser needs for one student row.
function rowPayload(r) {
  return {
    id: r.student.id,
    name: r.student.name,
    rec: r.rec,
    calc: {
      autoAttendance: r.calc.autoAttendance,
      attendance: r.calc.attendance,
      weighted: r.calc.weighted,
      total: r.calc.total,
      coursework: r.calc.coursework,
      uni: r.calc.uni,
      missing: r.calc.missing,
      complete: r.calc.complete
    }
  };
}

function renderGradesPage(model, cfg, view, flash) {
  const defs = fieldDefs(cfg);
  const sectionTabs = cfg.sections.map(s =>
    `<a class="tab${view && s === view.section ? ' active' : ''}" href="/teacher/grades?section=${encodeURIComponent(s)}">${esc(s)}</a>`
  ).join('');

  const header = `<div class="card">
      ${teacherNav('grades')}
      <div class="toolbar">
        <div>
          <h1>บันทึกคะแนน</h1>
          <p class="muted">ภาคการศึกษา ${esc(cfg.term)} · คะแนนเต็มดิบ: กลางภาค ${cfg.midtermMax}, ปลายภาค ${cfg.finalMax}, Speexx ${cfg.speexxMax} (แก้ในแท็บ Settings)</p>
        </div>
        ${view ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn small" href="/teacher/grades/export.xlsx?section=${encodeURIComponent(view.section)}">ดาวน์โหลด Excel</a>
          <a class="btn ghost small" href="/teacher/grades/export.csv?section=${encodeURIComponent(view.section)}">CSV</a>
          <a class="btn ghost small" href="/teacher/logout">ออกจากระบบ</a>
        </div>` : ''}
      </div>
      <div class="tabs">${sectionTabs}</div>
    </div>
    ${flash ? `<div class="${flash.ok ? 'info-banner' : 'error-banner'}">${esc(flash.message)}</div>` : ''}`;

  if (!view) {
    return layout('บันทึกคะแนน', header + '<div class="card"><p class="muted">ไม่มีกลุ่มเรียนที่ใช้ระบบคะแนน ตรวจสอบ grade_sections ในแท็บ Settings</p></div>', { wide: true });
  }

  const sm = view.summary;
  const itemLabel = { attendance: 'เข้าเรียน' };
  defs.forEach(d => { if (d.key !== 'attendance_override') itemLabel[d.key] = d.short; });
  const completion = Object.entries(view.itemCompletion).map(([k, n]) =>
    `<span class="chip${n === sm.enrolled ? ' full' : ''}">${esc(itemLabel[k] || k)} ${n}/${sm.enrolled}</span>`).join('');

  const summary = `<div class="card">
      <h2>${esc(view.section)}</h2>
      <div class="stats">
        <div class="stat"><div class="n">${sm.enrolled}</div><div class="l">นักศึกษา</div></div>
        <div class="stat"><div class="n">${sm.complete}</div><div class="l">กรอกครบ (ผลสุดท้าย)</div></div>
        <div class="stat highlight"><div class="n">${sm.missing}</div><div class="l">ยังไม่ครบ (ชั่วคราว)</div></div>
        <div class="stat"><div class="n">${sm.average == null ? '-' : f2(sm.average)}</div><div class="l">เฉลี่ยทั้งห้อง*</div></div>
        <div class="stat"><div class="n">${sm.highest == null ? '-' : f2(sm.highest)}</div><div class="l">สูงสุด*</div></div>
        <div class="stat"><div class="n">${sm.lowest == null ? '-' : f2(sm.lowest)}</div><div class="l">ต่ำสุด*</div></div>
      </div>
      <p class="muted" style="margin-bottom:10px">* คิดจากคะแนนที่บันทึกแล้ว รวมผลชั่วคราว
        ${sm.completeAverage == null ? '' : ` · เฉลี่ยเฉพาะผู้ที่กรอกครบ ${f2(sm.completeAverage)}`}</p>
      <div class="chips">${completion}</div>
    </div>`;

  const visibleDefs = visibleItemDefs(cfg);
  const visibility = `<div class="card">
      <h2>เปิดคะแนนให้นักศึกษาดู</h2>
      <p class="muted" style="margin-bottom:12px">ใช้กับทุกกลุ่มเรียน นักศึกษาเห็นในหน้า /my เมื่อหน้านักศึกษาเปิดอยู่
        (ตอนนี้: <strong>${model.settings.studentDashboardOn ? 'เปิด' : 'ปิด'}</strong>)</p>
      <form method="POST" action="/teacher/grades/visibility">
        <input type="hidden" name="section" value="${esc(view.section)}">
        <div class="checks">
          ${visibleDefs.map(d => `<label class="check"><input type="checkbox" name="items" value="${d.key}"${cfg.visible.has(d.key) ? ' checked' : ''}> ${esc(d.label)}</label>`).join('')}
        </div>
        <button type="submit" class="btn small" style="margin-top:12px">บันทึกการเปิดคะแนน</button>
      </form>
    </div>`;

  const head1 = defs.map(d => `<th class="num">${esc(d.short)}${d.max ? `<div class="mx">/${d.max}</div>` : ''}</th>`).join('');
  const table = `<div class="card">
      <div class="toolbar" style="margin-bottom:12px">
        <input type="search" id="gradeSearch" placeholder="ค้นหารหัสหรือชื่อ" style="max-width:280px;margin:0">
        <span id="saveStatus" class="save-status">บันทึกอัตโนมัติเมื่อออกจากช่อง</span>
      </div>
      <p class="muted" style="margin-bottom:10px">ช่องว่าง = ยังไม่ได้บันทึก (ต่างจาก 0) ·
        ช่องเข้าเรียนคำนวณจากการเช็คชื่อ (ตัวเลขสีเทา) พิมพ์ทับได้ ลบออกเพื่อกลับไปใช้ค่าอัตโนมัติ ·
        วางข้อมูลจาก Excel ได้โดยคลิกช่องแรกแล้วกด Ctrl+V</p>
      <div class="grid-wrap">
        <table class="grid" id="gradeGrid">
          <thead><tr>
            <th class="sc1">รหัส</th><th class="sc2">ชื่อ-นามสกุล</th>
            ${head1}
            <th class="num w">Quiz<div class="mx">/15</div></th>
            <th class="num w">Conv.<div class="mx">/15</div></th>
            <th class="num w uni">เก็บ<div class="mx">/60</div></th>
            <th class="num w uni">กลางภาค<div class="mx">/20</div></th>
            <th class="num w uni">ปลายภาค<div class="mx">/20</div></th>
            <th class="num w">รวม<div class="mx">/100</div></th>
            <th>สถานะ</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:10px">คอลัมน์สีฟ้า = 3 ช่องสำหรับกรอกเว็บมหาวิทยาลัย (ทศนิยม 2 ตำแหน่ง) · คลิกชื่อเพื่อดูรายละเอียด</p>
    </div>
    <div class="modal" id="detail" hidden><div class="modal-box" id="detailBox"></div></div>`;

  const style = `<style>
    .chips { display:flex; flex-wrap:wrap; gap:6px; }
    .chip { font-size:0.8rem; padding:3px 9px; border-radius:999px; background:#fef3c7; color:#92400e; }
    .chip.full { background:#dcfce7; color:#166534; }
    .checks { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:6px 14px; }
    .check { display:flex; align-items:center; gap:8px; font-weight:400; margin:0; font-size:0.9rem; color:#374151; }
    .check input { width:auto; margin:0; }
    .grid-wrap { overflow:auto; max-height:70vh; border:1px solid #eef0f3; border-radius:10px; }
    table.grid { border-collapse:separate; border-spacing:0; font-size:0.88rem; }
    table.grid th, table.grid td { padding:4px 6px; border-bottom:1px solid #eef0f3; background:white; }
    table.grid th { position:sticky; top:0; z-index:2; background:#fafbfc; text-align:center; }
    table.grid .mx { font-weight:400; font-size:0.72rem; color:#9ca3af; }
    .sc1, .sc2 { position:sticky; z-index:1; background:white; text-align:left !important; }
    .sc1 { left:0; min-width:120px; }
    .sc2 { left:120px; min-width:190px; border-right:2px solid #e5e7eb !important; }
    th.sc1, th.sc2 { z-index:3; background:#fafbfc; }
    .sc2 a { color:#1e3a5f; text-decoration:none; cursor:pointer; }
    .sc2 a:hover { text-decoration:underline; }
    table.grid input, table.grid select { width:62px; padding:5px 4px; margin:0; font-size:0.88rem; text-align:center;
      border:1px solid #e5e7eb; border-radius:6px; }
    table.grid select { width:92px; }
    table.grid input.bad, table.grid select.bad { border-color:#dc2626; background:#fef2f2; }
    table.grid input.dirty, table.grid select.dirty { border-color:#f59e0b; }
    table.grid input.saved, table.grid select.saved { border-color:#22c55e; }
    table.grid input::placeholder { color:#9ca3af; }
    td.w { text-align:right; font-variant-numeric:tabular-nums; color:#374151; min-width:62px; }
    td.uni { background:#eff6ff !important; font-weight:600; }
    th.uni { background:#dbeafe !important; }
    .save-status { font-size:0.88rem; color:#6b7280; }
    .save-status.ok { color:#15803d; } .save-status.err { color:#dc2626; } .save-status.busy { color:#b45309; }
    .modal { position:fixed; inset:0; background:rgba(15,23,42,0.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:20; }
    .modal[hidden] { display:none; }
    .modal-box { background:white; border-radius:16px; padding:24px; max-width:520px; width:100%; max-height:90vh; overflow:auto; }
  </style>`;

  const data = { section: view.section, defs, rows: view.rows.map(rowPayload) };
  const script = `<script>
  (function () {
    const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};
    const defs = DATA.defs;
    const byId = {};
    DATA.rows.forEach(r => { byId[r.id] = r; });
    const tbody = document.querySelector('#gradeGrid tbody');
    const statusEl = document.getElementById('saveStatus');
    const DONE = ['done','ทำ','ทำแล้ว','1','true','yes','y','✓','x'];
    const NOT_DONE = ['not_done','ไม่ทำ','ไม่ได้ทำ','0','false','no','n','-'];
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const f2 = n => (n == null ? '' : (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2));
    const blank = v => v === '' || v == null;

    function validate(def, raw) {
      const s = String(raw == null ? '' : raw).trim();
      if (def.type === 'completion') {
        const k = s.toLowerCase();
        if (k === '') return { value: '' };
        if (DONE.includes(k)) return { value: 'done' };
        if (NOT_DONE.includes(k)) return { value: 'not_done' };
        return { error: def.label + ': ใช้ได้เฉพาะ ทำแล้ว / ไม่ได้ทำ' };
      }
      if (s === '') return { value: '' };
      if (!/^\\d+(\\.\\d+)?$/.test(s)) return { error: def.label + ': ต้องเป็นตัวเลขไม่ติดลบ' };
      if (Number(s) > def.max) return { error: def.label + ': เกินคะแนนเต็ม ' + def.max };
      return { value: Number(s) };
    }

    function cellHtml(r, def) {
      const v = r.rec[def.key];
      if (def.type === 'completion') {
        return '<select data-id="' + esc(r.id) + '" data-field="' + def.key + '">' +
          '<option value=""' + (blank(v) ? ' selected' : '') + '>—</option>' +
          '<option value="done"' + (v === 'done' ? ' selected' : '') + '>ทำแล้ว</option>' +
          '<option value="not_done"' + (v === 'not_done' ? ' selected' : '') + '>ไม่ได้ทำ</option></select>';
      }
      const ph = def.key === 'attendance_override' && r.calc.autoAttendance != null ? f2(r.calc.autoAttendance) : '';
      return '<input inputmode="decimal" data-id="' + esc(r.id) + '" data-field="' + def.key + '" value="' + esc(blank(v) ? '' : v) + '" placeholder="' + ph + '">';
    }

    function calcHtml(r) {
      const c = r.calc, w = c.weighted;
      const status = c.complete ? '<span class="badge st-present">ครบ</span>'
        : '<span class="badge st-late" title="ยังไม่กรอก ' + c.missing.length + ' ช่อง">ชั่วคราว (' + c.missing.length + ')</span>';
      return '<td class="w">' + f2(w.quiz) + '</td><td class="w">' + f2(w.conversation) + '</td>' +
        '<td class="w uni">' + f2(c.uni.coursework) + '</td><td class="w uni">' + f2(c.uni.midterm) + '</td>' +
        '<td class="w uni">' + f2(c.uni.final) + '</td><td class="w"><strong>' + f2(c.total) + '</strong></td><td>' + status + '</td>';
    }

    function rowHtml(r) {
      return '<tr data-row="' + esc(r.id) + '"><td class="sc1">' + esc(r.id) + '</td>' +
        '<td class="sc2"><a data-detail="' + esc(r.id) + '">' + esc(r.name) + '</a></td>' +
        defs.map(d => '<td>' + cellHtml(r, d) + '</td>').join('') + calcHtml(r) + '</tr>';
    }

    tbody.innerHTML = DATA.rows.map(rowHtml).join('') ||
      '<tr><td colspan="30" class="muted" style="padding:16px">ยังไม่มีรายชื่อในแท็บ Roster</td></tr>';

    function refreshRow(id) {
      const tr = tbody.querySelector('tr[data-row="' + CSS.escape(id) + '"]');
      if (!tr) return;
      const cells = tr.children;
      const n = 2 + defs.length;
      while (tr.children.length > n) tr.removeChild(tr.lastChild);
      tr.insertAdjacentHTML('beforeend', calcHtml(byId[id]));
      const att = tr.querySelector('[data-field="attendance_override"]');
      if (att) att.placeholder = byId[id].calc.autoAttendance != null ? f2(byId[id].calc.autoAttendance) : '';
    }

    // ---- saving ----
    let pending = {};
    let timer = null;
    let inFlight = 0;
    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = 'save-status ' + (cls || ''); }

    function queue(el) {
      const def = defs.find(d => d.key === el.dataset.field);
      const res = validate(def, el.value);
      el.title = res.error || '';
      el.classList.toggle('bad', !!res.error);
      if (res.error) { setStatus(res.error + ' (ยังไม่บันทึก)', 'err'); return; }
      const r = byId[el.dataset.id];
      const old = blank(r.rec[def.key]) ? '' : r.rec[def.key];
      if (String(old) === String(res.value)) { el.classList.remove('dirty'); return; }
      el.classList.add('dirty'); el.classList.remove('saved');
      pending[el.dataset.id + '|' + def.key] = { studentId: el.dataset.id, field: def.key, value: res.value === '' ? '' : String(res.value) };
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    }

    async function flush() {
      const changes = Object.values(pending);
      if (!changes.length) return;
      pending = {};
      inFlight++;
      setStatus('กำลังบันทึก ' + changes.length + ' ช่อง...', 'busy');
      try {
        const res = await fetch('/teacher/grades/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: DATA.section, changes })
        });
        const data = await res.json().catch(() => ({ error: 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ' }));
        if (res.status === 401) { setStatus('หมดเวลาเข้าสู่ระบบ กรุณา login ใหม่ (ข้อมูลยังไม่บันทึก)', 'err'); return; }
        Object.entries(data.rows || {}).forEach(([id, row]) => { byId[id].rec = row.rec; byId[id].calc = row.calc; refreshRow(id); });
        const failed = new Set((data.errors || []).map(e => e.studentId + '|' + e.field));
        changes.forEach(ch => {
          const el = tbody.querySelector('[data-id="' + CSS.escape(ch.studentId) + '"][data-field="' + ch.field + '"]');
          if (!el) return;
          el.classList.remove('dirty');
          if (failed.has(ch.studentId + '|' + ch.field) || !res.ok) el.classList.add('bad');
          else { el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 1500); }
        });
        if (!res.ok || (data.errors && data.errors.length)) {
          setStatus('บันทึกไม่สำเร็จบางช่อง: ' + (data.error || data.errors.map(e => e.message).slice(0, 3).join(', ')), 'err');
        } else {
          const bad = tbody.querySelectorAll('.bad').length;
          if (bad) setStatus('บันทึกแล้ว · มี ' + bad + ' ช่องไม่ถูกต้อง (สีแดง) ยังไม่บันทึก', 'err');
          else setStatus('บันทึกแล้ว ' + new Date().toLocaleTimeString('th-TH'), 'ok');
        }
      } catch (err) {
        changes.forEach(ch => { pending[ch.studentId + '|' + ch.field] = ch; });
        setStatus('เชื่อมต่อไม่ได้ จะลองใหม่ใน 5 วินาที', 'err');
        clearTimeout(timer); timer = setTimeout(flush, 5000);
      } finally { inFlight--; }
    }

    tbody.addEventListener('change', e => { if (e.target.dataset.field) queue(e.target); });
    tbody.addEventListener('input', e => {
      const el = e.target;
      if (!el.dataset.field || el.tagName !== 'INPUT') return;
      const res = validate(defs.find(d => d.key === el.dataset.field), el.value);
      el.classList.toggle('bad', !!res.error);
      el.title = res.error || '';
    });
    tbody.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.dataset.field) return;
      e.preventDefault();
      const tr = e.target.closest('tr');
      let next = tr.nextElementSibling;
      while (next && next.hidden) next = next.nextElementSibling;
      const el = next && next.querySelector('[data-field="' + e.target.dataset.field + '"]');
      if (el) el.focus(); else e.target.blur();
    });

    // ---- paste from Excel / Google Sheets ----
    tbody.addEventListener('paste', e => {
      const start = e.target;
      if (!start.dataset || !start.dataset.field) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\\t\\n]/.test(text.trim())) return; // single value: normal paste
      e.preventDefault();
      const lines = text.replace(/\\r/g, '').replace(/\\n$/, '').split('\\n').map(l => l.split('\\t'));
      const rows = Array.from(tbody.querySelectorAll('tr[data-row]')).filter(tr => !tr.hidden);
      const rowIdx = rows.indexOf(start.closest('tr'));
      const colIdx = defs.findIndex(d => d.key === start.dataset.field);
      let bad = 0;
      lines.forEach((cols, i) => {
        const tr = rows[rowIdx + i];
        if (!tr) return;
        cols.forEach((val, j) => {
          const def = defs[colIdx + j];
          if (!def) return;
          const el = tr.querySelector('[data-field="' + def.key + '"]');
          const res = validate(def, val);
          if (el.tagName === 'SELECT') { if (!res.error) el.value = res.value; }
          else el.value = val.trim();
          if (res.error) { bad++; el.classList.add('bad'); el.title = res.error; return; }
          queue(el);
        });
      });
      if (bad) setStatus('วางข้อมูลแล้ว แต่มี ' + bad + ' ช่องไม่ถูกต้อง (ช่องสีแดงยังไม่บันทึก)', 'err');
    });

    // ---- search ----
    document.getElementById('gradeSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      tbody.querySelectorAll('tr[data-row]').forEach(tr => {
        const r = byId[tr.dataset.row];
        tr.hidden = q && !(r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
      });
    });

    // ---- detail ----
    const modal = document.getElementById('detail');
    tbody.addEventListener('click', e => {
      const a = e.target.closest('[data-detail]');
      if (!a) return;
      const r = byId[a.dataset.detail], c = r.calc, w = c.weighted;
      const raw = k => blank(r.rec[k]) ? '<span class="muted">ยังไม่บันทึก</span>' : esc(r.rec[k]);
      const sumRaw = keys => keys.map(k => blank(r.rec[k]) ? '–' : r.rec[k]).join(', ');
      const comp = k => r.rec[k] === 'done' ? 'ทำแล้ว' : r.rec[k] === 'not_done' ? 'ไม่ได้ทำ' : '<span class="muted">ยังไม่บันทึก</span>';
      const def = k => defs.find(d => d.key === k);
      const line = (label, rawText, weighted, max) =>
        '<tr><td>' + label + '</td><td>' + rawText + '</td><td class="num">' + f2(weighted) + ' / ' + max + '</td></tr>';
      const attRaw = c.attendance == null ? '<span class="muted">ยังไม่มีคาบเรียน</span>'
        : f2(c.attendance) + (blank(r.rec.attendance_override) ? ' (อัตโนมัติ)' : ' (แก้โดยอาจารย์ · อัตโนมัติ ' + f2(c.autoAttendance) + ')');
      document.getElementById('detailBox').innerHTML =
        '<h2>' + esc(r.name) + '</h2><p class="muted" style="margin-bottom:12px">รหัส ' + esc(r.id) + ' · ' +
        (c.complete ? 'กรอกครบแล้ว' : 'ผลชั่วคราว ยังไม่กรอก ' + c.missing.length + ' ช่อง') + '</p>' +
        '<table><thead><tr><th>รายการ</th><th>คะแนนดิบ</th><th class="num">ถ่วงน้ำหนัก</th></tr></thead><tbody>' +
        line('เข้าเรียน', attRaw, w.attendance, 10) +
        line('Quiz 1-4', sumRaw(['quiz_1','quiz_2','quiz_3','quiz_4']) + ' (เต็ม 15)', w.quiz, 15) +
        line('Conversation 1-6', sumRaw(['conversation_1','conversation_2','conversation_3','conversation_4','conversation_5','conversation_6']) + ' (เต็ม 5)', w.conversation, 15) +
        line('สอบกลางภาค', raw('midterm_score') + ' / ' + def('midterm_score').max, w.midterm, 20) +
        line('สอบปลายภาค', raw('final_score') + ' / ' + def('final_score').max, w.final, 20) +
        line('Speexx', raw('speexx_score') + ' / ' + def('speexx_score').max, w.speexx, 10) +
        line('Pre-test', comp('pretest'), w.pretest, 5) +
        line('Post-test', comp('posttest'), w.posttest, 5) +
        '<tr><td colspan="2"><strong>รวม</strong></td><td class="num"><strong>' + f2(c.total) + ' / 100</strong></td></tr>' +
        '</tbody></table>' +
        '<h2 style="margin-top:18px">สำหรับเว็บมหาวิทยาลัย</h2><table><tbody>' +
        '<tr><td>คะแนนเก็บ</td><td class="num">' + f2(c.uni.coursework) + ' / 60</td></tr>' +
        '<tr><td>สอบกลางภาค</td><td class="num">' + f2(c.uni.midterm) + ' / 20</td></tr>' +
        '<tr><td>สอบปลายภาค</td><td class="num">' + f2(c.uni.final) + ' / 20</td></tr></tbody></table>' +
        '<button class="btn ghost full" style="margin-top:16px" id="closeDetail">ปิด</button>';
      modal.hidden = false;
    });
    modal.addEventListener('click', e => { if (e.target === modal || e.target.id === 'closeDetail') modal.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.hidden = true; });

    window.addEventListener('beforeunload', e => {
      if (Object.keys(pending).length || inFlight) { e.preventDefault(); e.returnValue = ''; }
    });
  })();
  </script>`;

  return layout('บันทึกคะแนน', style + header + summary + table + visibility + script, { wide: true });
}

// ---------------- Export ----------------

function exportRows(view, cfg) {
  const defs = fieldDefs(cfg);
  const header = ['StudentID', 'Name',
    'เข้าเรียน (10)', 'Quiz 1 (15)', 'Quiz 2 (15)', 'Quiz 3 (15)', 'Quiz 4 (15)',
    'Conv 1 (5)', 'Conv 2 (5)', 'Conv 3 (5)', 'Conv 4 (5)', 'Conv 5 (5)', 'Conv 6 (5)',
    `กลางภาค (${cfg.midtermMax})`, `ปลายภาค (${cfg.finalMax})`, `Speexx (${cfg.speexxMax})`, 'Pre-test', 'Post-test',
    'W เข้าเรียน (10)', 'W Quiz (15)', 'W Conversation (15)', 'W กลางภาค (20)', 'W ปลายภาค (20)', 'W Speexx (10)',
    'W Pre-test (5)', 'W Post-test (5)',
    'คะแนนเก็บ (60)', 'สอบกลางภาค (20)', 'สอบปลายภาค (20)', 'รวม (100)', 'สถานะ', 'ยังไม่บันทึก'];
  const num = n => (n == null ? '' : Math.round((n + Number.EPSILON) * 100) / 100);
  const labels = { attendance: 'เข้าเรียน' };
  defs.forEach(d => { labels[d.key] = d.label; });
  const rows = view.rows.map(r => {
    const rec = r.rec, c = r.calc, w = c.weighted;
    const rawVal = k => (isBlank(rec[k]) ? '' : rec[k]);
    const comp = k => (rec[k] === 'done' ? 'ทำแล้ว' : rec[k] === 'not_done' ? 'ไม่ได้ทำ' : '');
    return [
      r.student.id, r.student.name,
      num(c.attendance),
      ...['quiz_1', 'quiz_2', 'quiz_3', 'quiz_4', 'conversation_1', 'conversation_2', 'conversation_3',
        'conversation_4', 'conversation_5', 'conversation_6', 'midterm_score', 'final_score', 'speexx_score'].map(rawVal),
      comp('pretest'), comp('posttest'),
      num(w.attendance), num(w.quiz), num(w.conversation), num(w.midterm), num(w.final), num(w.speexx),
      w.pretest, w.posttest,
      c.uni.coursework, c.uni.midterm, c.uni.final, num(c.total),
      c.complete ? 'ครบ' : 'ชั่วคราว',
      c.missing.map(k => labels[k] || k).join(', ')
    ];
  });
  return [header, ...rows];
}

function gradesXlsx(view, cfg) {
  const ws = XLSX.utils.aoa_to_sheet(exportRows(view, cfg));
  ws['!cols'] = [{ wch: 14 }, { wch: 28 }];
  ws['!freeze'] = { xSplit: 2, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, view.section.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function gradesCsv(view, cfg) {
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + exportRows(view, cfg).map(r => r.map(cell).join(',')).join('\r\n');
}

// ---------------- Student view ----------------

function studentGradeItems(rec, calc, cfg) {
  const items = [];
  const show = k => cfg.visible.has(k);
  const raw = (k, max) => (isBlank(rec[k]) ? '-' : `${rec[k]} / ${max}`);
  const comp = k => (rec[k] === 'done' ? 'ทำแล้ว' : rec[k] === 'not_done' ? 'ไม่ได้ทำ' : '-');
  if (show('attendance')) items.push({ label: 'คะแนนเข้าเรียน', value: calc.attendance == null ? '-' : `${f2(calc.attendance)} / 10` });
  ['quiz_1', 'quiz_2', 'quiz_3', 'quiz_4'].forEach((k, i) => { if (show(k)) items.push({ label: `Quiz ${i + 1}`, value: raw(k, 15) }); });
  ['conversation_1', 'conversation_2', 'conversation_3', 'conversation_4', 'conversation_5', 'conversation_6']
    .forEach((k, i) => { if (show(k)) items.push({ label: `Conversation ${i + 1}`, value: raw(k, 5) }); });
  if (show('midterm_score')) items.push({ label: 'สอบกลางภาค', value: raw('midterm_score', cfg.midtermMax) });
  if (show('final_score')) items.push({ label: 'สอบปลายภาค', value: raw('final_score', cfg.finalMax) });
  if (show('speexx_score')) items.push({ label: 'Speexx', value: raw('speexx_score', cfg.speexxMax) });
  if (show('pretest')) items.push({ label: 'Pre-test', value: comp('pretest') });
  if (show('posttest')) items.push({ label: 'Post-test', value: comp('posttest') });
  if (show('total')) items.push({ label: calc.complete ? 'คะแนนรวม' : 'คะแนนรวม (ชั่วคราว)', value: `${f2(calc.total)} / 100` });
  return items;
}

module.exports = { renderGradesPage, gradesXlsx, gradesCsv, studentGradeItems, rowPayload };
