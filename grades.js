// Grade management: item definitions, calculation, validation and storage in the Grades tab.

const { str } = require('./dashboard');

const GRADE_COLUMNS = [
  'Term', 'Section', 'StudentID', 'attendance_override',
  'quiz_1', 'quiz_2', 'quiz_3', 'quiz_4',
  'conversation_1', 'conversation_2', 'conversation_3', 'conversation_4', 'conversation_5', 'conversation_6',
  'midterm_score', 'final_score', 'speexx_score', 'pretest', 'posttest', 'UpdatedAt'
];
const COL_LETTER = i => String.fromCharCode(65 + i); // up to column T

const QUIZ = ['quiz_1', 'quiz_2', 'quiz_3', 'quiz_4'];
const CONV = ['conversation_1', 'conversation_2', 'conversation_3', 'conversation_4', 'conversation_5', 'conversation_6'];
const COMPLETION = ['pretest', 'posttest'];

// Editable fields and their labels. Max for exams comes from Settings.
function fieldDefs(cfg) {
  return [
    { key: 'attendance_override', label: 'เข้าเรียน', short: 'เข้าเรียน', max: 10, type: 'number' },
    ...QUIZ.map((k, i) => ({ key: k, label: `Quiz ${i + 1}`, short: `Q${i + 1}`, max: 15, type: 'number' })),
    ...CONV.map((k, i) => ({ key: k, label: `Conversation ${i + 1}`, short: `C${i + 1}`, max: 5, type: 'number' })),
    { key: 'midterm_score', label: 'สอบกลางภาค', short: 'กลางภาค', max: cfg.midtermMax, type: 'number' },
    { key: 'final_score', label: 'สอบปลายภาค', short: 'ปลายภาค', max: cfg.finalMax, type: 'number' },
    { key: 'speexx_score', label: 'Speexx', short: 'Speexx', max: cfg.speexxMax, type: 'number' },
    { key: 'pretest', label: 'Pre-test', short: 'Pre', type: 'completion' },
    { key: 'posttest', label: 'Post-test', short: 'Post', type: 'completion' }
  ];
}

// Items a teacher can open to students (attendance_override shows as the attendance score).
function visibleItemDefs(cfg) {
  return [
    { key: 'attendance', label: 'คะแนนเข้าเรียน (10)' },
    ...QUIZ.map((k, i) => ({ key: k, label: `Quiz ${i + 1} (15)` })),
    ...CONV.map((k, i) => ({ key: k, label: `Conversation ${i + 1} (5)` })),
    { key: 'midterm_score', label: `สอบกลางภาค (${cfg.midtermMax})` },
    { key: 'final_score', label: `สอบปลายภาค (${cfg.finalMax})` },
    { key: 'speexx_score', label: `Speexx (${cfg.speexxMax})` },
    { key: 'pretest', label: 'Pre-test' },
    { key: 'posttest', label: 'Post-test' },
    { key: 'total', label: 'คะแนนรวม (100)' }
  ];
}

function positiveNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function gradeConfig(model) {
  const raw = model.settings.raw || {};
  const listed = str(raw.grade_sections)
    ? str(raw.grade_sections).split(',').map(s => s.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean)
    : null;
  const sections = model.sections.filter(s =>
    listed ? listed.includes(s.replace(/\s+/g, ' ').toLowerCase()) : /gen eng/i.test(s));
  return {
    term: str(raw.term) || '2/2569',
    sections,
    midtermMax: positiveNumber(raw.midterm_max, 60),
    finalMax: positiveNumber(raw.final_max, 60),
    speexxMax: positiveNumber(raw.speexx_max, 10),
    visible: new Set(str(raw.grades_visible).split(',').map(s => s.trim()).filter(Boolean))
  };
}

// ---------------- Validation ----------------

const DONE = ['done', 'ทำ', 'ทำแล้ว', '1', 'true', 'yes', 'y', '✓', 'x'];
const NOT_DONE = ['not_done', 'ไม่ทำ', 'ไม่ได้ทำ', '0', 'false', 'no', 'n', '-'];

// Returns { value } with '' for blank, or { error }.
function validateValue(def, input) {
  const s = str(input);
  if (def.type === 'completion') {
    const k = s.toLowerCase();
    if (k === '') return { value: '' };
    if (DONE.includes(k)) return { value: 'done' };
    if (NOT_DONE.includes(k)) return { value: 'not_done' };
    return { error: `${def.label}: ใช้ได้เฉพาะ ทำแล้ว / ไม่ได้ทำ` };
  }
  if (s === '') return { value: '' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: `${def.label}: ต้องเป็นตัวเลขไม่ติดลบ` };
  const n = Number(s);
  if (n > def.max) return { error: `${def.label}: เกินคะแนนเต็ม ${def.max}` };
  return { value: n };
}

// ---------------- Calculation ----------------

function isBlank(v) {
  return v === '' || v == null;
}

function sumRecorded(rec, keys) {
  return keys.reduce((a, k) => a + (isBlank(rec[k]) ? 0 : Number(rec[k])), 0);
}

// attendanceReport: studentReport() from the dashboard model.
function computeGrade(rec, attendanceReport, cfg) {
  const held = attendanceReport ? attendanceReport.held : 0;
  const autoAttendance = held > 0
    ? Math.max(0, 10 * (held - attendanceReport.totalAbsent) / held)
    : null;
  const override = isBlank(rec.attendance_override) ? null : Number(rec.attendance_override);
  const attendance = override != null ? override : autoAttendance;

  const w = {
    attendance: attendance == null ? 0 : attendance,
    quiz: sumRecorded(rec, QUIZ) / 60 * 15,
    conversation: sumRecorded(rec, CONV) / 30 * 15,
    midterm: isBlank(rec.midterm_score) ? 0 : Number(rec.midterm_score) / cfg.midtermMax * 20,
    final: isBlank(rec.final_score) ? 0 : Number(rec.final_score) / cfg.finalMax * 20,
    speexx: isBlank(rec.speexx_score) ? 0 : Number(rec.speexx_score) / cfg.speexxMax * 10,
    pretest: rec.pretest === 'done' ? 5 : 0,
    posttest: rec.posttest === 'done' ? 5 : 0
  };
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const coursework = w.attendance + w.quiz + w.conversation + w.speexx + w.pretest + w.posttest;

  const missing = [];
  if (attendance == null) missing.push('attendance');
  [...QUIZ, ...CONV, 'midterm_score', 'final_score', 'speexx_score', ...COMPLETION]
    .forEach(k => { if (isBlank(rec[k])) missing.push(k); });

  // Three columns for the university system, each rounded to 2 decimals.
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const uni = { coursework: round2(coursework), midterm: round2(w.midterm), final: round2(w.final) };
  uni.total = round2(uni.coursework + uni.midterm + uni.final);

  return {
    attendance, autoAttendance, override, weighted: w, total, coursework, uni,
    missing, complete: missing.length === 0
  };
}

// ---------------- Storage ----------------

function createGradeStore(getSheetsClient, spreadsheetId, dataSource) {
  let cache = null;
  let cacheAt = 0;
  let queue = Promise.resolve();

  async function readRows(sheets) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId, range: 'Grades!A:T', valueRenderOption: 'UNFORMATTED_VALUE'
    });
    return res.data.values || [];
  }

  function toRecords(rows) {
    const map = {};
    rows.slice(1).forEach((r, i) => {
      const rec = { _row: i + 2 };
      GRADE_COLUMNS.forEach((c, j) => { rec[c] = r[j] == null ? '' : r[j]; });
      rec.StudentID = str(rec.StudentID);
      map[`${str(rec.Term)}|${str(rec.Section)}|${rec.StudentID}`] = rec;
    });
    return map;
  }

  async function load(force) {
    if (!force && cache && Date.now() - cacheAt < 60 * 1000) return cache;
    await dataSource.ensure();
    const sheets = await getSheetsClient();
    cache = toRecords(await readRows(sheets));
    cacheAt = Date.now();
    return cache;
  }

  function get(records, term, section, id) {
    return records[`${term}|${section}|${id}`] || { Term: term, Section: section, StudentID: id };
  }

  // changes: [{ studentId, field, value }] already validated. Saves are serialised so
  // two requests cannot create duplicate rows for the same student.
  function save(term, section, changes, editor) {
    const run = queue.then(async () => {
      await dataSource.ensure();
      const sheets = await getSheetsClient();
      const records = toRecords(await readRows(sheets));
      const now = new Date().toISOString();
      const updates = [];
      const appends = [];
      const history = [];
      const touched = {};

      changes.forEach(ch => {
        const key = `${term}|${section}|${ch.studentId}`;
        const rec = touched[key] || records[key] || { Term: term, Section: section, StudentID: ch.studentId };
        const old = rec[ch.field] == null ? '' : rec[ch.field];
        if (String(old) === String(ch.value)) return;
        rec[ch.field] = ch.value;
        rec.UpdatedAt = now;
        touched[key] = rec;
        history.push([now, editor, term, section, ch.studentId, ch.field, String(old), String(ch.value)]);
      });

      Object.values(touched).forEach(rec => {
        const row = GRADE_COLUMNS.map(c => (rec[c] == null ? '' : rec[c]));
        if (rec._row) updates.push({ range: `Grades!A${rec._row}:${COL_LETTER(GRADE_COLUMNS.length - 1)}${rec._row}`, values: [row] });
        else appends.push(row);
      });

      if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId, requestBody: { valueInputOption: 'RAW', data: updates }
        });
      }
      if (appends.length) {
        await sheets.spreadsheets.values.append({
          spreadsheetId, range: 'Grades!A:T', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
          requestBody: { values: appends }
        });
      }
      if (history.length) {
        await sheets.spreadsheets.values.append({
          spreadsheetId, range: 'GradeHistory!A:H', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
          requestBody: { values: history }
        });
      }
      cache = null;
      return { changed: history.length };
    });
    queue = run.catch(() => {});
    return run;
  }

  return { load, get, save };
}

// ---------------- Section view ----------------

function sectionGrades(model, records, store, cfg, section) {
  const students = model.students.filter(s => s.section === section).sort((a, b) => a.id.localeCompare(b.id));
  const rows = students.map(st => {
    const rec = store.get(records, cfg.term, section, st.id);
    return { student: st, rec, calc: computeGrade(rec, model.studentReport(st), cfg) };
  });
  const totals = rows.map(r => r.total = r.calc.total);
  const completeRows = rows.filter(r => r.calc.complete);
  const itemKeys = ['attendance', ...QUIZ, ...CONV, 'midterm_score', 'final_score', 'speexx_score', ...COMPLETION];
  const itemCompletion = {};
  itemKeys.forEach(k => { itemCompletion[k] = rows.filter(r => !r.calc.missing.includes(k)).length; });
  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    section, rows,
    summary: {
      enrolled: rows.length,
      complete: completeRows.length,
      missing: rows.length - completeRows.length,
      average: avg(totals),
      highest: totals.length ? Math.max(...totals) : null,
      lowest: totals.length ? Math.min(...totals) : null,
      completeAverage: avg(completeRows.map(r => r.calc.total))
    },
    itemCompletion
  };
}

module.exports = {
  GRADE_COLUMNS, QUIZ, CONV, fieldDefs, visibleItemDefs, gradeConfig, validateValue, computeGrade,
  createGradeStore, sectionGrades, isBlank
};
