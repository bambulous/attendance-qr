// HTML rendering for the student and teacher dashboards.

const { thaiDate, fmtTime } = require('./dashboard');

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STATUS = {
  present: { label: 'มา', short: '✓', cls: 'st-present' },
  late: { label: 'สาย', short: 'ส', cls: 'st-late' },
  activity: { label: 'กิจกรรม', short: 'ก', cls: 'st-activity' },
  absent: { label: 'ขาด', short: '✗', cls: 'st-absent' },
  pending: { label: 'รอสแกน', short: '·', cls: 'st-pending' }
};

const LOCK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function layout(title, body, opts = {}) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f0f2f5; color: #1f2937;
           min-height: 100vh; padding: 24px 16px; }
    .wrap { max-width: ${opts.wide ? '1200px' : '520px'}; margin: 0 auto; }
    .card { background: white; border-radius: 16px; padding: 28px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            margin-bottom: 20px; }
    h1 { color: #1e3a5f; font-size: 1.4rem; margin-bottom: 6px; }
    h2 { color: #1e3a5f; font-size: 1.1rem; margin-bottom: 14px; }
    .muted { color: #6b7280; font-size: 0.88rem; }
    label { display: block; font-size: 0.9rem; color: #555; margin-bottom: 6px; font-weight: 600; }
    input, select { width: 100%; padding: 12px 14px; border: 1.5px solid #e5e7eb; border-radius: 10px;
                    font-size: 1rem; font-family: inherit; margin-bottom: 16px; outline: none; background: white; }
    input:focus, select:focus { border-color: #3b82f6; }
    .btn { display: inline-block; padding: 12px 18px; background: #3b82f6; color: white; border: none;
           border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; font-family: inherit;
           text-decoration: none; text-align: center; }
    .btn:hover { background: #2563eb; }
    .btn.full { width: 100%; }
    .btn.ghost { background: #eef2f7; color: #1e3a5f; }
    .btn.ghost:hover { background: #e2e8f0; }
    .btn.small { padding: 8px 12px; font-size: 0.88rem; }
    .error-banner { background: #fef2f2; color: #dc2626; border-radius: 8px; padding: 10px 14px;
                    margin-bottom: 16px; font-size: 0.9rem; }
    .info-banner { background: #eff6ff; color: #1d4ed8; border-radius: 8px; padding: 10px 14px;
                   margin-bottom: 16px; font-size: 0.9rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; margin: 16px 0; }
    .stat { background: #f9fafb; border-radius: 10px; padding: 12px; text-align: center; }
    .stat .n { font-size: 1.5rem; font-weight: 700; color: #1e3a5f; }
    .stat .l { font-size: 0.8rem; color: #6b7280; margin-top: 2px; }
    .stat.highlight { background: #fef2f2; }
    .stat.highlight .n { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #eef0f3; text-align: left; white-space: nowrap; }
    th { color: #6b7280; font-weight: 600; font-size: 0.82rem; background: #fafbfc; position: sticky; top: 0; }
    td.num, th.num { text-align: center; }
    .scroll { overflow-x: auto; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.82rem; font-weight: 600; }
    .st-present { background: #dcfce7; color: #15803d; }
    .st-late { background: #fef3c7; color: #b45309; }
    .st-activity { background: #dbeafe; color: #1d4ed8; }
    .st-absent { background: #fee2e2; color: #b91c1c; }
    .st-pending { background: #f3f4f6; color: #6b7280; }
    .cell { display: inline-block; width: 26px; height: 26px; line-height: 26px; border-radius: 6px;
            text-align: center; font-weight: 700; font-size: 0.85rem; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 4px; }
    .tab { padding: 8px 14px; border-radius: 999px; background: #eef2f7; color: #1e3a5f; text-decoration: none;
           font-size: 0.9rem; }
    .tab.active { background: #1e3a5f; color: white; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.82rem; color: #6b7280; margin-top: 10px; }
    .lock { position: fixed; right: 14px; bottom: 14px; color: #9ca3af; opacity: 0.5; padding: 8px;
            border-radius: 50%; display: flex; }
    .lock:hover { opacity: 1; color: #1e3a5f; background: white; }
    .sticky-col { position: sticky; left: 0; background: white; z-index: 1; }
  </style>
</head>
<body>
  <div class="wrap">
${body}
  </div>
  ${opts.lock ? `<a class="lock" href="/teacher" title="Teacher Dashboard" aria-label="Teacher Dashboard">${LOCK_SVG}</a>` : ''}
</body>
</html>`;
}

function badge(status) {
  const s = STATUS[status];
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

function statsBlock(r) {
  return `<div class="stats">
      <div class="stat"><div class="n">${r.held}</div><div class="l">คาบที่เรียนแล้ว</div></div>
      <div class="stat"><div class="n">${r.counts.present}</div><div class="l">มาตรงเวลา</div></div>
      <div class="stat"><div class="n">${r.counts.late}</div><div class="l">มาสาย</div></div>
      <div class="stat"><div class="n">${r.counts.activity}</div><div class="l">ร่วมกิจกรรม</div></div>
      <div class="stat"><div class="n">${r.counts.absent}</div><div class="l">ขาดเรียน</div></div>
      <div class="stat highlight"><div class="n">${r.totalAbsent}</div><div class="l">ขาดรวม (สาย 2 = ขาด 1)</div></div>
    </div>`;
}

// ---------------- Student ----------------

function renderMyLogin({ error, closed, studentId } = {}) {
  const body = closed
    ? `<div class="card">
      <h1>ตรวจสอบการเข้าเรียน</h1>
      <div class="info-banner" style="margin-top:16px">ระบบยังไม่เปิดให้ตรวจสอบข้อมูล กรุณารอประกาศจากอาจารย์</div>
    </div>`
    : `<div class="card">
      <h1>ตรวจสอบการเข้าเรียน</h1>
      <p class="muted" style="margin-bottom:20px">กรอกรหัสนักศึกษาและรหัสผ่านที่อาจารย์แจ้ง</p>
      ${error ? `<div class="error-banner">${esc(error)}</div>` : ''}
      <form method="POST" action="/my">
        <label for="studentId">รหัสนักศึกษา</label>
        <input type="text" id="studentId" name="studentId" required inputmode="numeric" autocomplete="off"
               value="${esc(studentId)}">
        <label for="password">รหัสผ่าน</label>
        <input type="password" id="password" name="password" required autocomplete="off">
        <button type="submit" class="btn full">ดูข้อมูล</button>
      </form>
    </div>`;
  return layout('ตรวจสอบการเข้าเรียน', body, { lock: true });
}

function gradeCard(grades) {
  if (!grades || !grades.items.length) return '';
  const rows = grades.items.map(i => `<tr><td>${esc(i.label)}</td><td class="num"><strong>${esc(i.value)}</strong></td></tr>`).join('');
  return `<div class="card">
      <h2>คะแนน</h2>
      <div class="scroll"><table><tbody>${rows}</tbody></table></div>
      <p class="muted" style="margin-top:12px">แสดงเฉพาะคะแนนที่อาจารย์เปิดให้ดู "-" หมายถึงยังไม่ได้บันทึก</p>
    </div>`;
}

function renderMyReport(report, model, grades) {
  const st = report.student;
  const rows = report.rows.slice().reverse().map(r => `
          <tr>
            <td>${esc(thaiDate(r.session.date))}${r.session.note ? ` <span class="muted">(${esc(r.session.note)})</span>` : ''}</td>
            <td>${r.scan ? fmtTime(r.scan.minutes) : '-'}</td>
            <td>${badge(r.status)}</td>
          </tr>`).join('');
  const body = `<div class="card">
      <h1>${esc(st.name || st.id)}</h1>
      <p class="muted">รหัส ${esc(st.id)} · ${esc(st.section)}</p>
      ${statsBlock(report)}
      <p class="muted">เข้าเรียน ${report.percent == null ? '-' : report.percent + '%'} · สาย ${report.counts.late} ครั้ง คิดเป็นขาด ${report.lateAsAbsent} ครั้ง</p>
    </div>
    <div class="card">
      <h2>ประวัติรายคาบ</h2>
      ${report.rows.length ? `<div class="scroll"><table>
        <thead><tr><th>วันที่</th><th>เวลาสแกน</th><th>สถานะ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<p class="muted">ยังไม่มีคาบเรียน</p>'}
      <p class="muted" style="margin-top:14px">ข้อมูลอัปเดตทุก 1 นาที หากข้อมูลไม่ถูกต้อง กรุณาติดต่ออาจารย์</p>
    </div>
    ${gradeCard(grades)}
    <a class="btn ghost full" href="/my">ค้นหาใหม่</a>`;
  return layout(`การเข้าเรียน ${st.id}`, body, { lock: true });
}

// ---------------- Teacher ----------------

function renderTeacherLogin({ error, notConfigured } = {}) {
  const body = `<div class="card">
      <h1>Teacher Dashboard</h1>
      <p class="muted" style="margin-bottom:20px">สำหรับอาจารย์เท่านั้น</p>
      ${notConfigured ? '<div class="error-banner">ยังไม่ได้ตั้งค่า TEACHER_PASSWORD ใน Render</div>' : ''}
      ${error ? `<div class="error-banner">${esc(error)}</div>` : ''}
      <form method="POST" action="/teacher/login">
        <label for="password">รหัสผ่าน</label>
        <input type="password" id="password" name="password" required autofocus autocomplete="current-password">
        <button type="submit" class="btn full">เข้าสู่ระบบ</button>
      </form>
    </div>`;
  return layout('Teacher Dashboard', body);
}

function rosterImportCard(model, section) {
  const options = model.sections.map(s =>
    `<option value="${esc(s)}"${s === section ? ' selected' : ''}>${esc(s)}</option>`).join('');
  return `<div class="card">
      <h2>นำเข้ารายชื่อนักศึกษา</h2>
      <p class="muted" style="margin-bottom:14px">อัปโหลดไฟล์ใบรายชื่อจากระบบทะเบียน (.xls, .xlsx หรือ .csv)
        ระบบจะแทนที่รายชื่อเดิมของกลุ่มที่เลือกในแท็บ Roster</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;align-items:end">
        <div><label for="rosterSection">กลุ่มเรียน</label>
          <select id="rosterSection">${options}</select></div>
        <div><label for="rosterFile">ไฟล์</label>
          <input type="file" id="rosterFile" accept=".xls,.xlsx,.csv"></div>
        <div style="margin-bottom:16px"><button type="button" class="btn full" id="rosterPreviewBtn">ตรวจสอบไฟล์</button></div>
      </div>
      <div id="rosterResult"></div>
    </div>
    <script>
    (function () {
      const btn = document.getElementById('rosterPreviewBtn');
      const out = document.getElementById('rosterResult');
      const escHtml = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      btn.addEventListener('click', async () => {
        const file = document.getElementById('rosterFile').files[0];
        const section = document.getElementById('rosterSection').value;
        if (!file) { out.innerHTML = '<div class="error-banner">กรุณาเลือกไฟล์</div>'; return; }
        btn.disabled = true; btn.textContent = 'กำลังอ่านไฟล์...';
        try {
          const res = await fetch('/teacher/roster/preview?section=' + encodeURIComponent(section), {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file
          });
          const data = await res.json();
          if (!res.ok) { out.innerHTML = '<div class="error-banner">' + escHtml(data.error) + '</div>'; return; }
          const rows = data.students.map((s, i) =>
            '<tr><td class="num">' + (i + 1) + '</td><td>' + escHtml(s.id) + '</td><td>' + escHtml(s.name) + '</td></tr>').join('');
          out.innerHTML =
            (data.warning ? '<div class="error-banner">' + escHtml(data.warning) + '</div>' : '') +
            '<div class="info-banner">พบนักศึกษา ' + data.students.length + ' คน สำหรับ <strong>' + escHtml(section) +
            '</strong> (รายชื่อเดิมของกลุ่มนี้ ' + data.existing + ' คน จะถูกแทนที่)</div>' +
            '<div class="scroll" style="max-height:320px;overflow-y:auto;margin-bottom:14px"><table>' +
            '<thead><tr><th class="num">#</th><th>รหัส</th><th>ชื่อ-นามสกุล</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<form method="POST" action="/teacher/roster/confirm"><input type="hidden" name="token" value="' + escHtml(data.token) + '">' +
            '<button type="submit" class="btn">ยืนยันบันทึกลงแท็บ Roster</button></form>';
        } catch (err) {
          out.innerHTML = '<div class="error-banner">อัปโหลดไม่สำเร็จ: ' + escHtml(err.message) + '</div>';
        } finally {
          btn.disabled = false; btn.textContent = 'ตรวจสอบไฟล์';
        }
      });
    })();
    </script>`;
}

function renderTeacherDashboard(model, sectionName, flash) {
  const section = model.sections.includes(sectionName) ? sectionName : model.sections[0];
  const tabs = model.sections.map(s =>
    `<a class="tab${s === section ? ' active' : ''}" href="/teacher?section=${encodeURIComponent(s)}">${esc(s)}</a>`
  ).join('');

  let content = '<div class="card"><p class="muted">ยังไม่มีกลุ่มเรียนในแท็บ Schedule</p></div>';
  if (section) {
    const rep = model.sectionReport(section);
    const done = rep.sessions.filter(s => s.state === 'done').length;
    const avg = rep.reports.filter(r => r.percent != null);
    const avgPct = avg.length ? Math.round(avg.reduce((a, r) => a + r.percent, 0) / avg.length) : null;

    const daily = rep.daily.slice().reverse().map(d => `
          <tr>
            <td>${esc(thaiDate(d.session.date))} ${d.session.note ? `<span class="muted">(${esc(d.session.note)})</span>` : ''}
                ${d.session.state === 'ongoing' ? '<span class="badge st-pending">กำลังเรียน</span>' : ''}</td>
            <td class="num">${d.counts.present}</td>
            <td class="num">${d.counts.late}</td>
            <td class="num">${d.counts.activity}</td>
            <td class="num">${d.session.state === 'done' ? d.counts.absent : d.counts.pending}</td>
            <td class="num">${rep.students.length}</td>
          </tr>`).join('');

    const head = rep.sessions.map(s => {
      const d = new Date(s.date + 'T00:00:00Z');
      return `<th class="num" title="${esc(thaiDate(s.date))}">${d.getUTCDate()}/${d.getUTCMonth() + 1}</th>`;
    }).join('');
    const matrix = rep.reports.map(r => `
          <tr>
            <td class="sticky-col">${esc(r.student.id)}</td>
            <td>${esc(r.student.name)}</td>
            ${r.rows.map(x => `<td class="num"><span class="cell ${STATUS[x.status].cls}" title="${esc(thaiDate(x.session.date))} ${STATUS[x.status].label}${x.scan ? ' ' + fmtTime(x.scan.minutes) : ''}${x.note ? ' · ' + esc(x.note) : ''}">${STATUS[x.status].short}</span></td>`).join('')}
            <td class="num">${r.counts.present}</td>
            <td class="num">${r.counts.late}</td>
            <td class="num">${r.counts.activity}</td>
            <td class="num">${r.counts.absent}</td>
            <td class="num"><strong>${r.totalAbsent}</strong></td>
            <td class="num">${r.percent == null ? '-' : r.percent + '%'}</td>
          </tr>`).join('');

    content = `<div class="card">
      <div class="toolbar">
        <h2 style="margin:0">${esc(section)}</h2>
        <a class="btn small" href="/teacher/export.csv?section=${encodeURIComponent(section)}">ดาวน์โหลด Excel (CSV)</a>
      </div>
      <div class="stats">
        <div class="stat"><div class="n">${rep.students.length}</div><div class="l">นักศึกษาในรายชื่อ</div></div>
        <div class="stat"><div class="n">${done}</div><div class="l">คาบที่เรียนแล้ว</div></div>
        <div class="stat"><div class="n">${avgPct == null ? '-' : avgPct + '%'}</div><div class="l">เข้าเรียนเฉลี่ย</div></div>
      </div>
      ${rep.students.length ? '' : '<div class="info-banner">ยังไม่มีรายชื่อนักศึกษาของกลุ่มนี้ในแท็บ Roster ระบบจึงนับขาดเรียนไม่ได้</div>'}
    </div>

    <div class="card">
      <h2>สรุปรายวัน</h2>
      ${rep.daily.length ? `<div class="scroll"><table>
        <thead><tr><th>วันที่</th><th class="num">มา</th><th class="num">สาย</th><th class="num">กิจกรรม</th><th class="num">ขาด</th><th class="num">ทั้งหมด</th></tr></thead>
        <tbody>${daily}</tbody>
      </table></div>` : '<p class="muted">ยังไม่มีคาบเรียน</p>'}
    </div>

    <div class="card">
      <h2>รายบุคคล</h2>
      ${rep.reports.length ? `<div class="scroll"><table>
        <thead><tr><th class="sticky-col">รหัส</th><th>ชื่อ-นามสกุล</th>${head}
          <th class="num">มา</th><th class="num">สาย</th><th class="num">กิจกรรม</th><th class="num">ขาด</th><th class="num">ขาดรวม</th><th class="num">%</th></tr></thead>
        <tbody>${matrix}</tbody>
      </table></div>
      <div class="legend">
        ${Object.values(STATUS).map(s => `<span><span class="cell ${s.cls}">${s.short}</span> ${s.label}</span>`).join('')}
        <span>ขาดรวม = ขาด + (สาย ÷ 2 ปัดลง)</span>
      </div>` : '<p class="muted">ไม่มีข้อมูล</p>'}
    </div>`;
  }

  const errors = model.errors.slice().reverse().map(e => `
          <tr>
            <td>${esc(thaiDate(e.date))} ${fmtTime(e.minutes)}</td>
            <td>${esc(e.id)}</td>
            <td>${esc(e.name)}</td>
            <td>${esc(e.section)}</td>
            <td>${esc(e.email)}</td>
            <td>${esc(e.reason)}</td>
            <td class="num">${e.row}</td>
          </tr>`).join('');

  const body = `<div class="card">
      ${teacherNav('attendance')}
      <div class="toolbar">
        <div>
          <h1>Teacher Dashboard</h1>
          <p class="muted">อัปเดต ${esc(new Date(model.loadedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }))} ·
            หน้านักศึกษา: <strong>${model.settings.studentDashboardOn ? 'เปิด' : 'ปิด'}</strong> (แก้ในแท็บ Settings)</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn ghost small" href="/teacher?section=${encodeURIComponent(section || '')}&refresh=1">รีเฟรชข้อมูล</a>
          <a class="btn ghost small" href="/teacher.html" target="_blank">เปิด QR Code</a>
          <a class="btn ghost small" href="/teacher/logout">ออกจากระบบ</a>
        </div>
      </div>
      <div class="tabs">${tabs}</div>
    </div>
    ${flash ? `<div class="${flash.ok ? 'info-banner' : 'error-banner'}">${esc(flash.message)}</div>` : ''}
    ${content}
    ${model.sections.length ? rosterImportCard(model, section) : ''}
    <div class="card">
      <h2>รอตรวจสอบ (${model.errors.length})</h2>
      <p class="muted" style="margin-bottom:12px">การสแกนที่ระบบนับให้ไม่ได้ แก้ได้โดยเพิ่มรหัสในแท็บ Roster หรือบันทึกในแท็บ Adjustment</p>
      ${model.errors.length ? `<div class="scroll"><table>
        <thead><tr><th>วันเวลา</th><th>รหัส</th><th>ชื่อ</th><th>กลุ่มเรียน</th><th>อีเมล</th><th>สาเหตุ</th><th class="num">แถวใน Sheet</th></tr></thead>
        <tbody>${errors}</tbody>
      </table></div>` : '<p class="muted">ไม่มีรายการ</p>'}
    </div>`;
  return layout('Teacher Dashboard', body, { wide: true });
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function renderSectionCsv(model, section) {
  const rep = model.sectionReport(section);
  const header = ['Section', 'StudentID', 'Name',
    ...rep.sessions.map(s => s.date),
    'มา', 'สาย', 'กิจกรรม', 'ขาด', 'สายคิดเป็นขาด', 'ขาดรวม', 'เข้าเรียน %'];
  const lines = [header];
  rep.reports.forEach(r => {
    lines.push([
      section, r.student.id, r.student.name,
      ...r.rows.map(x => STATUS[x.status].label + (x.scan ? ` ${fmtTime(x.scan.minutes)}` : '')),
      r.counts.present, r.counts.late, r.counts.activity, r.counts.absent,
      r.lateAsAbsent, r.totalAbsent, r.percent == null ? '' : r.percent
    ]);
  });
  // BOM so Excel reads Thai text as UTF-8.
  return '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n');
}

function renderDataError(message) {
  return layout('เกิดข้อผิดพลาด', `<div class="card">
      <h1>โหลดข้อมูลไม่สำเร็จ</h1>
      <div class="error-banner" style="margin-top:16px">${esc(message)}</div>
      <a class="btn ghost" href="javascript:location.reload()">ลองใหม่</a>
    </div>`);
}

function teacherNav(active) {
  const item = (key, href, label) =>
    `<a class="tab${active === key ? ' active' : ''}" href="${href}">${label}</a>`;
  return `<div class="tabs" style="margin:0 0 12px">${item('attendance', '/teacher', 'เช็คชื่อ')}${item('grades', '/teacher/grades', 'คะแนน')}</div>`;
}

module.exports = {
  layout, teacherNav, STATUS, renderMyLogin, renderMyReport, renderTeacherLogin, renderTeacherDashboard, renderSectionCsv, renderDataError, esc
};
