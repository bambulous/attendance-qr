// Attendance dashboard: reads Google Sheets tabs and computes per-session status.
//
// Tabs (created automatically if missing):
//   Sheet1      check-in log written by the QR system (A:H, H = ISO timestamp)
//   Roster      Section | StudentID | Name
//   Schedule    Section | Day | Start | End | LateAfter
//   Calendar    Date | Section | Type | Start | End | LateAfter | Note
//   Adjustment  Date | Section | StudentID | Status | Note
//   Settings    Key | Value

const XLSX = require('xlsx');

const LOG_SHEET = 'Sheet1';
const CACHE_MS = 60 * 1000;
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

const TAB_DEFAULTS = {
  Roster: [
    ['Section', 'StudentID', 'Name']
  ],
  Schedule: [
    ['Section', 'Day', 'Start', 'End', 'LateAfter'],
    ['Sec 1 สนทนาภาษาอังกฤษเพื่องานบริการ', 'อังคาร', '13:00', '17:00', '13:45'],
    ['Sec 9 Gen Eng', 'พุธ', '09:00', '12:00', '09:45'],
    ['Sec 10 Gen Eng', 'พุธ', '13:00', '16:00', '13:45'],
    ['Sec 20 Gen Eng', 'พุธ', '18:00', '21:00', '18:45'],
    ['Sec 14 Gen Eng', 'พฤหัสบดี', '09:00', '12:00', '09:45']
  ],
  Calendar: [
    ['Date', 'Section', 'Type', 'Start', 'End', 'LateAfter', 'Note'],
    ['2026-12-07', '', 'หยุด', '', '', '', 'วันหยุด'],
    ['2026-12-10', '', 'หยุด', '', '', '', 'วันหยุด'],
    ['2026-12-31', '', 'หยุด', '', '', '', 'วันหยุด'],
    ['2027-01-01', '', 'หยุด', '', '', '', 'วันหยุด'],
    ['2027-01-04', '', 'สอบ', '', '', '', 'สอบกลางภาค'],
    ['2027-01-05', '', 'สอบ', '', '', '', 'สอบกลางภาค'],
    ['2027-01-06', '', 'สอบ', '', '', '', 'สอบกลางภาค'],
    ['2027-01-07', '', 'สอบ', '', '', '', 'สอบกลางภาค'],
    ['2027-01-08', '', 'สอบ', '', '', '', 'สอบกลางภาค'],
    ['2027-02-22', '', 'หยุด', '', '', '', 'วันหยุด'],
    ['2027-03-08', '', 'สอบ', '', '', '', 'สอบปลายภาค'],
    ['2027-03-09', '', 'สอบ', '', '', '', 'สอบปลายภาค'],
    ['2027-03-10', '', 'สอบ', '', '', '', 'สอบปลายภาค'],
    ['2027-03-11', '', 'สอบ', '', '', '', 'สอบปลายภาค'],
    ['2027-03-12', '', 'สอบ', '', '', '', 'สอบปลายภาค']
  ],
  Adjustment: [
    ['Date', 'Section', 'StudentID', 'Status', 'Note', 'SourceRow']
  ],
  Settings: [
    ['Key', 'Value', 'Description'],
    ['student_dashboard', 'off', 'on = เปิดให้นักศึกษาดูข้อมูล, off = ปิด'],
    ['semester_start', '2026-11-16', 'วันแรกของสัปดาห์ที่ 1 (YYYY-MM-DD)'],
    ['semester_end', '2027-03-05', 'วันสุดท้ายของสัปดาห์ที่ 15 (YYYY-MM-DD)'],
    ['scan_open_minutes_before', '30', 'รับการสแกนก่อนเวลาเริ่มเรียนกี่นาที'],
    ['term', '2/2569', 'ภาคการศึกษาที่ใช้บันทึกคะแนน'],
    ['grade_sections', 'Sec 9 Gen Eng, Sec 10 Gen Eng, Sec 14 Gen Eng, Sec 20 Gen Eng', 'กลุ่มเรียนที่ใช้ระบบคะแนน (คั่นด้วย ,)'],
    ['midterm_max', '60', 'คะแนนเต็มสอบกลางภาค (คะแนนดิบ)'],
    ['final_max', '60', 'คะแนนเต็มสอบปลายภาค (คะแนนดิบ)'],
    ['speexx_max', '10', 'คะแนนเต็ม Speexx (คะแนนดิบ)'],
    ['grades_visible', '', 'คะแนนที่เปิดให้นักศึกษาดู (ตั้งค่าจากหน้าคะแนนในเว็บ)']
  ],
  Grades: [
    ['Term', 'Section', 'StudentID', 'attendance_override',
      'quiz_1', 'quiz_2', 'quiz_3', 'quiz_4',
      'conversation_1', 'conversation_2', 'conversation_3', 'conversation_4', 'conversation_5', 'conversation_6',
      'midterm_score', 'final_score', 'speexx_score', 'pretest', 'posttest', 'UpdatedAt']
  ],
  GradeHistory: [
    ['Timestamp', 'Editor', 'Term', 'Section', 'StudentID', 'Field', 'OldValue', 'NewValue']
  ]
};

const CANCEL_TYPES = ['หยุด', 'สอบ', 'งดสอน', 'holiday', 'exam', 'cancel'];
const MAKEUP_TYPES = ['สอนชดเชย', 'ชดเชย', 'makeup', 'extra'];

const DAY_NAMES = {
  'อาทิตย์': 0, 'อา': 0, 'sun': 0, 'sunday': 0,
  'จันทร์': 1, 'จ': 1, 'mon': 1, 'monday': 1,
  'อังคาร': 2, 'อ': 2, 'tue': 2, 'tuesday': 2,
  'พุธ': 3, 'พ': 3, 'wed': 3, 'wednesday': 3,
  'พฤหัสบดี': 4, 'พฤหัส': 4, 'พฤ': 4, 'thu': 4, 'thursday': 4,
  'ศุกร์': 5, 'ศ': 5, 'fri': 5, 'friday': 5,
  'เสาร์': 6, 'ส': 6, 'sat': 6, 'saturday': 6
};

// ---------------- Parsing helpers ----------------

function str(v) {
  return v == null ? '' : String(v).trim();
}

function normId(v) {
  return str(v).replace(/[\s-]/g, '');
}

function normSection(v) {
  return str(v).replace(/\s+/g, ' ').toLowerCase();
}

// Returns 'YYYY-MM-DD' or null. Accepts serial numbers, ISO, d/m/yyyy (CE or BE).
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = str(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    let y = +m[3];
    if (y > 2400) y -= 543;
    return ymd(y, +m[2], +m[1]);
  }
  return null;
}

function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Returns minutes since midnight or null. Accepts day fractions and 'HH:MM[:SS]'.
function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round((v % 1) * 1440);
  const m = /^(\d{1,2})[:.](\d{2})/.exec(str(v));
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

function fmtTime(min) {
  if (min == null) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// Bangkok wall-clock parts for a Date / ms value.
function bkk(ms) {
  const d = new Date(ms + BKK_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    seconds: d.getUTCSeconds()
  };
}

function weekday(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function thaiDate(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('th-TH', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: '2-digit'
  });
}

function parseDay(v) {
  const k = str(v).toLowerCase().replace(/\.$/, '');
  return Object.prototype.hasOwnProperty.call(DAY_NAMES, k) ? DAY_NAMES[k] : null;
}

function normStatus(v) {
  const s = str(v).toLowerCase();
  if (['กิจกรรม', 'activity', 'ร่วมกิจกรรม', 'กิจกรรมมหาวิทยาลัย'].includes(s)) return 'activity';
  if (['มา', 'present', 'มาเรียน', 'ตรงเวลา'].includes(s)) return 'present';
  if (['สาย', 'late', 'มาสาย'].includes(s)) return 'late';
  if (['ขาด', 'absent', 'ขาดเรียน'].includes(s)) return 'absent';
  return null;
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ---------------- Sheets access ----------------

function createDataSource(getSheetsClient, spreadsheetId) {
  let cache = null;
  let cacheAt = 0;
  let ensured = false;

  async function ensureTabs(sheets) {
    if (ensured) return;
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    const existing = new Set(meta.data.sheets.map(s => s.properties.title));
    const missing = Object.keys(TAB_DEFAULTS).filter(t => !existing.has(t));
    if (missing.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: missing.map(title => ({
            addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } }
          }))
        }
      });
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: missing.map(t => ({ range: `${t}!A1`, values: TAB_DEFAULTS[t] }))
        }
      });
    }
    // Add Settings keys introduced after the tab was first created.
    const keyRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Settings!A:A' });
    const keys = new Set((keyRes.data.values || []).map(r => str(r[0]).toLowerCase()));
    const missingKeys = TAB_DEFAULTS.Settings.slice(1).filter(r => !keys.has(r[0]));
    if (missingKeys.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Settings!A:C',
        valueInputOption: 'RAW',
        requestBody: { values: missingKeys }
      });
    }
    ensured = true;
  }

  async function updateSetting(key, value) {
    const sheets = await getSheetsClient();
    await ensureTabs(sheets);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Settings!A:A' });
    const idx = (res.data.values || []).findIndex(r => str(r[0]).toLowerCase() === key);
    if (idx < 0) throw new Error(`Setting ${key} not found`);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Settings!B${idx + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] }
    });
    cache = null;
  }

  async function load(force) {
    if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
    const sheets = await getSheetsClient();
    await ensureTabs(sheets);
    const ranges = [`${LOG_SHEET}!A:H`, 'Roster!A:C', 'Schedule!A:E', 'Calendar!A:G', 'Adjustment!A:F', 'Settings!A:B'];
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    });
    const [log, roster, schedule, calendar, adjustment, settings] =
      res.data.valueRanges.map(r => r.values || []);
    cache = buildModel({ log, roster, schedule, calendar, adjustment, settings }, Date.now());
    cacheAt = Date.now();
    return cache;
  }

  // Replace all Roster rows of one section with new students.
  async function replaceRoster(section, newStudents) {
    const sheets = await getSheetsClient();
    await ensureTabs(sheets);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Roster!A2:C' });
    const target = normSection(section);
    const kept = (res.data.values || []).filter(r => str(r[1]) && normSection(r[0]) !== target);
    const rows = kept.concat(newStudents.map(st => [section, st.id, st.name]));
    rows.sort((a, b) => str(a[0]).localeCompare(str(b[0])) || str(a[1]).localeCompare(str(b[1])));
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Roster!A2:C' });
    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Roster!A2',
        valueInputOption: 'RAW',
        requestBody: { values: rows }
      });
    }
    cache = null;
    return { total: rows.length, removed: (res.data.values || []).length - kept.length };
  }

  // Adds one Adjustment row. sourceRow links it to the Sheet1 scan it fixes.
  async function appendAdjustment(row) {
    const sheets = await getSheetsClient();
    await ensureTabs(sheets);
    const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Adjustment!F1' });
    if (!head.data.values || !str(head.data.values[0] && head.data.values[0][0])) {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: 'Adjustment!F1', valueInputOption: 'RAW', requestBody: { values: [['SourceRow']] }
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: 'Adjustment!A:F', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
    cache = null;
  }

  return {
    load, replaceRoster, updateSetting, appendAdjustment,
    invalidate: () => { cache = null; },
    ensure: async () => ensureTabs(await getSheetsClient())
  };
}

// ---------------- Roster file import ----------------

const ID_PATTERN = /^\d{8,13}$/;
const NAME_PATTERN = /[\u0E00-\u0E7Fa-zA-Z]/;

// Minimal RTF to plain text. The registration office exports class lists as RTF
// files named .doc (Thai text in code page 874). Cells become tabs, rows become newlines.
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict',
  'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'object']);

function rtfToText(buffer) {
  const src = buffer.toString('latin1');
  const cpMatch = /\\ansicpg(\d+)/.exec(src);
  const decoder = new TextDecoder(`windows-${cpMatch ? cpMatch[1] : '874'}`);
  let out = '';
  let bytes = [];
  const flush = () => { if (bytes.length) { out += decoder.decode(Buffer.from(bytes)); bytes = []; } };
  const emit = t => { flush(); out += t; };
  const stack = [];
  let skip = false;
  let uc = 1;
  let skipChars = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      stack.push({ skip, uc });
      if (src[i + 1] === '\\' && src[i + 2] === '*') skip = true;
      continue;
    }
    if (ch === '}') { const st = stack.pop() || { skip: false, uc: 1 }; skip = st.skip; uc = st.uc; continue; }
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === "'") {
        const hex = src.substr(i + 2, 2);
        i += 3;
        if (skipChars > 0) { skipChars--; continue; }
        if (!skip) bytes.push(parseInt(hex, 16));
        continue;
      }
      if (next === '\\' || next === '{' || next === '}') { i++; if (!skip) bytes.push(next.charCodeAt(0)); continue; }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40));
      if (!m) { i++; continue; }
      i += m[0].length;
      const word = m[1];
      if (RTF_SKIP.has(word)) { skip = true; continue; }
      if (skip) continue;
      if (word === 'uc') uc = Number(m[2] || 1);
      else if (word === 'u') { emit(String.fromCharCode((Number(m[2]) + 65536) % 65536)); skipChars = uc; }
      else if (word === 'par' || word === 'row' || word === 'line') emit('\n');
      else if (word === 'cell' || word === 'tab') emit('\t');
      continue;
    }
    if (ch === '\r' || ch === '\n') continue;
    if (skip) continue;
    if (skipChars > 0) { skipChars--; continue; }
    bytes.push(ch.charCodeAt(0));
  }
  flush();
  return out;
}

function rowsFromBuffer(buffer) {
  if (buffer.slice(0, 5).toString('latin1') === '{\\rtf') {
    return rtfToText(buffer).split('\n').map(line => line.split('\t'));
  }
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames.flatMap(name =>
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }));
}

// Reads a registration-office class list (.doc RTF, .xls, .xlsx, .csv).
// Finds rows that contain a student ID and takes the next text cell as the name.
function parseRosterFile(buffer) {
  const students = [];
  const seen = new Set();
  let text = '';
  rowsFromBuffer(buffer).forEach(row => {
      text += ' ' + row.join(' ');
      for (let i = 0; i < row.length; i++) {
        const id = normId(row[i]);
        if (!ID_PATTERN.test(id)) continue;
        const nameCell = row.slice(i + 1).map(str).find(v => NAME_PATTERN.test(v));
        if (nameCell && !seen.has(id)) {
          seen.add(id);
          students.push({ id, name: nameCell.replace(/\s+/g, ' ') });
        }
        break;
      }
  });
  const m = /\bSect?(?:ion)?\.?\s*(\d+)\b/i.exec(text) || /กลุ่มที่\s*(\d+)/.exec(text);
  return { students, sectionNumber: m ? m[1] : null };
}

function sectionNumberOf(section) {
  const m = /^Sec(?:t|tion)?\.?\s*(\d+)\b/i.exec(str(section));
  return m ? m[1] : null;
}

// ---------------- Model ----------------

function buildModel(raw, nowMs) {
  const settings = {};
  raw.settings.slice(1).forEach(r => { if (str(r[0])) settings[str(r[0]).toLowerCase()] = r[1]; });
  const semStart = parseDate(settings.semester_start) || '2026-11-16';
  const semEnd = parseDate(settings.semester_end) || '2027-03-05';
  const openBefore = Number(settings.scan_open_minutes_before);
  const scanOpenBefore = Number.isFinite(openBefore) ? openBefore : 30;
  const studentDashboardOn = str(settings.student_dashboard).toLowerCase() === 'on';

  // Schedule
  const sections = [];
  const sectionByKey = {};
  const weekly = [];
  raw.schedule.slice(1).forEach(r => {
    const section = str(r[0]);
    const day = parseDay(r[1]);
    const start = parseTime(r[2]);
    const end = parseTime(r[3]);
    if (!section || day == null || start == null || end == null) return;
    const key = normSection(section);
    if (!sectionByKey[key]) { sectionByKey[key] = section; sections.push(section); }
    weekly.push({ section: sectionByKey[key], day, start, end, lateAfter: parseTime(r[4]) });
  });

  // Calendar exceptions
  const cancels = [];
  const makeups = [];
  raw.calendar.slice(1).forEach(r => {
    const date = parseDate(r[0]);
    const type = str(r[2]).toLowerCase();
    if (!date || !type) return;
    const secKey = normSection(r[1]);
    const section = secKey && secKey !== 'all' && secKey !== 'ทั้งหมด' ? (sectionByKey[secKey] || str(r[1])) : '';
    const note = str(r[6]);
    if (CANCEL_TYPES.includes(type)) cancels.push({ date, section, type: str(r[2]), note });
    else if (MAKEUP_TYPES.includes(type) && section) {
      makeups.push({ date, section, start: parseTime(r[3]), end: parseTime(r[4]), lateAfter: parseTime(r[5]), note, lateSet: str(r[5]) !== '' });
    }
  });

  const isCancelled = (date, section) =>
    cancels.some(c => c.date === date && (!c.section || c.section === section));

  // Sessions
  const now = bkk(nowMs);
  const sessions = [];
  for (let d = semStart; d <= semEnd; d = addDays(d, 1)) {
    const wd = weekday(d);
    weekly.forEach(w => {
      if (w.day === wd && !isCancelled(d, w.section)) {
        sessions.push({ date: d, section: w.section, start: w.start, end: w.end, lateAfter: w.lateAfter, note: '' });
      }
    });
  }
  makeups.forEach(m => {
    const base = weekly.find(w => w.section === m.section) || {};
    sessions.push({
      date: m.date,
      section: m.section,
      start: m.start != null ? m.start : base.start,
      end: m.end != null ? m.end : base.end,
      lateAfter: m.lateSet ? m.lateAfter : base.lateAfter,
      note: m.note || 'สอนชดเชย'
    });
  });
  sessions.forEach(s => {
    s.id = `${s.date}|${s.section}|${s.start}`;
    if (s.date < now.date || (s.date === now.date && now.minutes >= s.end)) s.state = 'done';
    else if (s.date === now.date && now.minutes >= s.start - scanOpenBefore) s.state = 'ongoing';
    else s.state = 'future';
  });
  sessions.sort((a, b) => (a.date + fmtTime(a.start)).localeCompare(b.date + fmtTime(b.start)));

  // Roster
  const students = [];
  const studentById = {};
  raw.roster.slice(1).forEach(r => {
    const id = normId(r[1]);
    if (!id || studentById[id]) return;
    const secKey = normSection(r[0]);
    const st = { id, name: str(r[2]), section: sectionByKey[secKey] || str(r[0]) };
    studentById[id] = st;
    students.push(st);
  });

  // Check-ins
  const errors = [];
  const firstScan = {}; // `${sessionId}|${studentId}` -> scan
  raw.log.forEach((r, i) => {
    const iso = str(r[7]);
    const ms = /^\d{4}-\d{2}-\d{2}T/.test(iso) ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return; // header or legacy rows without timestamp
    const t = bkk(ms);
    if (t.date < semStart) return;
    const id = normId(r[3]);
    const scan = {
      row: i + 1, date: t.date, minutes: t.minutes, seconds: t.seconds,
      id, name: str(r[2]), email: str(r[4]), formSection: str(r[6])
    };
    const st = studentById[id];
    const section = st ? st.section : (sectionByKey[normSection(scan.formSection)] || scan.formSection);
    scan.section = section;
    if (!st) {
      // Counted automatically once the student ID is added to Roster.
      errors.push({ ...scan, reason: 'รหัสนักศึกษาไม่อยู่ในรายชื่อ (Roster)' });
      return;
    }
    const session = sessions.find(s =>
      s.section === section && s.date === t.date &&
      t.minutes >= s.start - scanOpenBefore && t.minutes < s.end);
    if (!session) {
      const hasClass = sessions.some(s => s.section === section && s.date === t.date);
      errors.push({ ...scan, reason: hasClass ? 'สแกนนอกเวลาเรียน' : 'ไม่มีเรียนในวันนี้' });
      return;
    }
    const key = `${session.id}|${id}`;
    if (!firstScan[key] || ms < firstScan[key].ms) firstScan[key] = { ...scan, ms };
  });

  // Adjustments
  const adjust = {};
  const resolvedRows = new Set();
  raw.adjustment.slice(1).forEach(r => {
    const src = Number(r[5]);
    if (Number.isInteger(src) && src > 0) resolvedRows.add(src);
  });
  raw.adjustment.slice(1).forEach(r => {
    const date = parseDate(r[0]);
    const id = normId(r[2]);
    const status = normStatus(r[3]);
    if (!date || !id || !status) return;
    const st = studentById[id];
    const secKey = normSection(r[1]);
    const section = st ? st.section : (sectionByKey[secKey] || str(r[1]));
    const matches = sessions.filter(s => s.date === date && s.section === section);
    if (!matches.length) return;
    matches.forEach(s => { adjust[`${s.id}|${id}`] = { status, note: str(r[4]) }; });
  });

  // Scans already fixed through an Adjustment row are no longer listed for review.
  const openErrors = errors.filter(e => !resolvedRows.has(e.row));
  openErrors.forEach(e => { e.fix = suggestFix(e); });

  function defaultStatus(scan, section) {
    const s = sessions.find(x => x.section === section && x.date === scan.date);
    if (!s) return null;
    return s.lateAfter != null && scan.minutes > s.lateAfter ? 'สาย' : 'มา';
  }

  // Guess the intended student: email containing the ID, same name, or an ID that differs by a few digits.
  function suggestFix(e) {
    const inSection = students.filter(st => st.section === e.section);
    const candidates = (inSection.length ? inSection : students).slice().sort((a, b) => a.id.localeCompare(b.id));
    const bare = n => str(n).replace(/^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.)/, '').replace(/\s+/g, '');
    const emailDigits = (str(e.email).match(/\d{8,13}/) || [''])[0];
    let best = null;
    let bestScore = Infinity;
    candidates.forEach(st => {
      let score = Infinity;
      if (emailDigits && emailDigits === st.id) score = 0;
      else if (bare(st.name) && bare(st.name) === bare(e.name)) score = 1;
      else {
        const d = editDistance(st.id, e.id);
        if (d <= 3) score = 1 + d;
      }
      if (score < bestScore) { bestScore = score; best = st; }
    });
    return {
      candidates,
      suggestedId: best ? best.id : (studentById[e.id] ? e.id : ''),
      defaultStatus: best ? defaultStatus(e, best.section) : defaultStatus(e, e.section)
    };
  }

  function statusFor(session, studentId) {
    const key = `${session.id}|${studentId}`;
    const scan = firstScan[key];
    const adj = adjust[key];
    if (adj) return { status: adj.status, scan, note: adj.note || 'ปรับโดยอาจารย์' };
    if (scan) {
      const late = session.lateAfter != null && scan.minutes > session.lateAfter;
      return { status: late ? 'late' : 'present', scan };
    }
    if (session.state === 'done') return { status: 'absent' };
    return { status: 'pending' };
  }

  function studentReport(st) {
    const rows = sessions
      .filter(s => s.section === st.section && s.state !== 'future')
      .map(s => ({ session: s, ...statusFor(s, st.id) }));
    const c = { present: 0, late: 0, activity: 0, absent: 0, pending: 0 };
    rows.forEach(r => { c[r.status]++; });
    const held = c.present + c.late + c.activity + c.absent;
    const lateAsAbsent = Math.floor(c.late / 2);
    const totalAbsent = c.absent + lateAsAbsent;
    const attended = c.present + c.late + c.activity;
    return {
      student: st, rows, counts: c, held, lateAsAbsent, totalAbsent,
      percent: held ? Math.round((attended / held) * 100) : null
    };
  }

  function sectionReport(section) {
    const secSessions = sessions.filter(s => s.section === section && s.state !== 'future');
    const secStudents = students.filter(s => s.section === section)
      .sort((a, b) => a.id.localeCompare(b.id));
    const reports = secStudents.map(studentReport);
    const daily = secSessions.map(s => {
      const c = { present: 0, late: 0, activity: 0, absent: 0, pending: 0 };
      secStudents.forEach(st => { c[statusFor(s, st.id).status]++; });
      return { session: s, counts: c };
    });
    return { section, sessions: secSessions, students: secStudents, reports, daily };
  }

  return {
    sections, students, sessions, errors: openErrors, allErrors: errors, resolvedCount: errors.length - openErrors.length,
    studentById, defaultStatus,
    settings: { semStart, semEnd, scanOpenBefore, studentDashboardOn, raw: settings },
    studentReport, sectionReport, statusFor, loadedAt: nowMs
  };
}

module.exports = {
  str, createDataSource, parseRosterFile, sectionNumberOf, buildModel, thaiDate, fmtTime, normId, TAB_DEFAULTS, LOG_SHEET
};
