require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const crypto = require('crypto');
const path = require('path');
const { createDataSource, normId, parseRosterFile, sectionNumberOf } = require('./dashboard');
const pages = require('./dashboard-pages');
const grades = require('./grades');
const gradePages = require('./grades-pages');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: BASE_URL.startsWith('https'),
    sameSite: 'lax'
  }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --------------- Token Management ---------------

const TOKEN_TTL_SECONDS = 120;
// Extra seconds a QR is still accepted after it changes (student scanned at the last moment).
const TOKEN_GRACE_SECONDS = 15;
// Time allowed between a valid scan and submitting the form (Google login + typing).
const CHECKIN_FORM_WINDOW_MS = 15 * 60 * 1000;
// Tokens are signed, so they stay valid across server restarts and redeploys
// as long as SESSION_SECRET is set.
const TOKEN_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const SECTIONS = [
  'Sec 1 สนทนาภาษาอังกฤษเพื่องานบริการ',
  'Sec 9 Gen Eng',
  'Sec 10 Gen Eng',
  'Sec 14 Gen Eng',
  'Sec 20 Gen Eng'
];

const THAI_NAME_PATTERN = /^[\u0E00-\u0E7F]+(?:\s+[\u0E00-\u0E7F]+)+$/;

function signWindow(windowIndex) {
  return crypto.createHmac('sha256', TOKEN_SECRET)
    .update(`qr-window:${windowIndex}`)
    .digest('hex')
    .slice(0, 32);
}

function currentWindow(now = Date.now()) {
  return Math.floor(now / (TOKEN_TTL_SECONDS * 1000));
}

function tokenForWindow(windowIndex) {
  return `${windowIndex}.${signWindow(windowIndex)}`;
}

function isTokenValid(token, now = Date.now()) {
  const match = /^(\d+)\.([0-9a-f]{32})$/.exec(token || '');
  if (!match) return false;
  const windowIndex = Number(match[1]);
  const expected = Buffer.from(signWindow(windowIndex));
  const given = Buffer.from(match[2]);
  if (!crypto.timingSafeEqual(expected, given)) return false;

  const nowWindow = currentWindow(now);
  if (windowIndex === nowWindow) return true;
  if (windowIndex === nowWindow - 1) {
    const secondsIntoWindow = (now % (TOKEN_TTL_SECONDS * 1000)) / 1000;
    return secondsIntoWindow <= TOKEN_GRACE_SECONDS;
  }
  return false;
}

// --------------- Google APIs ---------------

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/auth/google/callback`
  );
}

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  let auth;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    throw new Error('No Google Sheets credentials configured');
  }

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function bangkokIso(date) {
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
  return `${local}+07:00`;
}

async function recordAttendance(user) {
  const sheets = await getSheetsClient();
  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
  const timeStr = now.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Sheet1!A:H',
    valueInputOption: 'RAW',
    requestBody: {
      // Column H holds an exact ISO timestamp used by the dashboard.
      values: [[dateStr, timeStr, user.fullName, user.studentId, user.email, 'Present', user.section, bangkokIso(now)]]
    }
  });
}

// --------------- Routes ---------------

app.get('/api/token', (req, res) => {
  const now = Date.now();
  const token = tokenForWindow(currentWindow(now));
  const elapsed = Math.floor((now % (TOKEN_TTL_SECONDS * 1000)) / 1000);
  const remaining = Math.max(1, TOKEN_TTL_SECONDS - elapsed);
  res.set('Cache-Control', 'no-store');
  res.json({
    token,
    remainingSeconds: remaining,
    ttlSeconds: TOKEN_TTL_SECONDS,
    checkinUrl: `${BASE_URL}/checkin?token=${token}`
  });
});

app.get('/checkin', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send(renderPage('Error', 'Missing token', 'red'));
  }

  if (!isTokenValid(token)) {
    return res.send(renderPage(
      'QR Code หมดอายุ',
      'QR code นี้หมดอายุแล้ว กรุณาสแกน QR code ใหม่จากหน้าจอของอาจารย์',
      'red'
    ));
  }

  // The scan is checked here. The student then has time to log in and fill the form.
  req.session.pendingToken = token;
  req.session.scannedAt = Date.now();

  if (req.session.user) {
    return res.redirect('/profile');
  }

  const client = createOAuth2Client();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
  });
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(renderPage('Authentication Cancelled', 'Please scan the QR code again.', 'orange'));
  }

  try {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();

    req.session.user = {
      email: data.email,
      name: data.name,
      picture: data.picture
    };

    return res.redirect('/profile');
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.status(500).send(renderPage('Authentication Failed', 'Please try again.', 'red'));
  }
});

app.get('/profile', (req, res) => {
  if (!req.session.user || !req.session.pendingToken) {
    return res.redirect('/student.html');
  }
  res.send(renderProfilePage(req.session.user));
});

app.post('/profile', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send(renderPage('Session Expired', 'กรุณาสแกน QR code ใหม่อีกครั้ง', 'red'));
  }

  const section = (req.body.section || '').trim();
  const studentId = (req.body.studentId || '').trim();
  const fullName = (req.body.fullName || '').trim().replace(/\s+/g, ' ');
  const form = { section, studentId, fullName };

  if (!section || !studentId || !fullName) {
    return res.send(renderProfilePage(req.session.user, 'กรุณากรอกข้อมูลให้ครบถ้วน', form));
  }
  if (!SECTIONS.includes(section)) {
    return res.send(renderProfilePage(req.session.user, 'กรุณาเลือกกลุ่มเรียนจากรายการ', form));
  }
  if (!THAI_NAME_PATTERN.test(fullName)) {
    return res.send(renderProfilePage(req.session.user, 'กรุณากรอกชื่อ-นามสกุลเป็นภาษาไทย โดยเว้นวรรคระหว่างชื่อและนามสกุล', form));
  }

  req.session.user.section = section;
  req.session.user.studentId = studentId;
  req.session.user.fullName = fullName;

  return processCheckin(req, res);
});

// --------------- Dashboards ---------------

const dataSource = createDataSource(getSheetsClient, process.env.GOOGLE_SHEET_ID);
const gradeStore = grades.createGradeStore(getSheetsClient, process.env.GOOGLE_SHEET_ID, dataSource);

function passwordMatches(given, expected) {
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Simple brute-force limit: 20 wrong passwords per IP per 10 minutes.
const failedLogins = new Map();
function tooManyFailures(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.since > 10 * 60 * 1000) return false;
  return entry.count >= 20;
}
function recordFailure(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.since > 10 * 60 * 1000) failedLogins.set(ip, { count: 1, since: Date.now() });
  else entry.count++;
}

async function loadModel(res, force) {
  try {
    return await dataSource.load(force);
  } catch (err) {
    console.error('Dashboard load error:', err.message);
    res.status(500).send(pages.renderDataError(err.message));
    return null;
  }
}

app.get('/', (req, res) => res.redirect('/my'));

app.get('/my', async (req, res) => {
  const model = await loadModel(res);
  if (!model) return;
  res.send(pages.renderMyLogin({ closed: !model.settings.studentDashboardOn }));
});

app.post('/my', async (req, res) => {
  const model = await loadModel(res);
  if (!model) return;
  if (!model.settings.studentDashboardOn) {
    return res.send(pages.renderMyLogin({ closed: true }));
  }
  const studentId = normId(req.body.studentId);
  if (tooManyFailures(req.ip)) {
    return res.status(429).send(pages.renderMyLogin({ error: 'ลองผิดหลายครั้งเกินไป กรุณารอ 10 นาที', studentId }));
  }
  if (!passwordMatches(req.body.password, process.env.STUDENT_PASSWORD)) {
    recordFailure(req.ip);
    return res.send(pages.renderMyLogin({ error: 'รหัสผ่านไม่ถูกต้อง', studentId }));
  }
  const student = model.studentById[studentId];
  if (!student) {
    return res.send(pages.renderMyLogin({ error: 'ไม่พบรหัสนักศึกษานี้ในรายชื่อ กรุณาตรวจสอบหรือติดต่ออาจารย์', studentId }));
  }
  let gradeInfo = null;
  const cfg = grades.gradeConfig(model);
  if (cfg.visible.size && cfg.sections.includes(student.section)) {
    try {
      const records = await gradeStore.load();
      const rec = gradeStore.get(records, cfg.term, student.section, student.id);
      const calc = grades.computeGrade(rec, model.studentReport(student), cfg);
      gradeInfo = { items: gradePages.studentGradeItems(rec, calc, cfg) };
    } catch (err) {
      console.error('Grade load error:', err.message);
    }
  }
  res.send(pages.renderMyReport(model.studentReport(student), model, gradeInfo));
});

app.get('/teacher', async (req, res) => {
  if (!req.session.isTeacher) {
    return res.send(pages.renderTeacherLogin({ notConfigured: !process.env.TEACHER_PASSWORD }));
  }
  const model = await loadModel(res, req.query.refresh === '1');
  if (!model) return;
  const flash = req.session.flash;
  delete req.session.flash;
  res.send(pages.renderTeacherDashboard(model, req.query.section || (flash && flash.section), flash));
});

app.post('/teacher/login', (req, res) => {
  if (tooManyFailures(req.ip)) {
    return res.status(429).send(pages.renderTeacherLogin({ error: 'ลองผิดหลายครั้งเกินไป กรุณารอ 10 นาที' }));
  }
  if (!passwordMatches(req.body.password, process.env.TEACHER_PASSWORD)) {
    recordFailure(req.ip);
    return res.send(pages.renderTeacherLogin({
      error: 'รหัสผ่านไม่ถูกต้อง',
      notConfigured: !process.env.TEACHER_PASSWORD
    }));
  }
  req.session.isTeacher = true;
  res.redirect('/teacher');
});

app.get('/teacher/logout', (req, res) => {
  delete req.session.isTeacher;
  res.redirect('/teacher');
});

// Roster import: step 1 parses the uploaded file and keeps the result in the session.
app.post('/teacher/roster/preview',
  express.raw({ type: 'application/octet-stream', limit: '5mb' }),
  async (req, res) => {
    if (!req.session.isTeacher) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบใหม่' });
    const model = await dataSource.load().catch(err => ({ error: err.message }));
    if (model.error) return res.status(500).json({ error: model.error });
    const section = req.query.section;
    if (!model.sections.includes(section)) return res.status(400).json({ error: 'ไม่พบกลุ่มเรียนนี้ในแท็บ Schedule' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'ไฟล์ว่างเปล่า' });

    let parsed;
    try {
      parsed = parseRosterFile(req.body);
    } catch (err) {
      return res.status(400).json({ error: 'อ่านไฟล์ไม่ได้ กรุณาใช้ไฟล์ .xls, .xlsx หรือ .csv' });
    }
    if (!parsed.students.length) {
      return res.status(400).json({ error: 'ไม่พบรหัสนักศึกษาในไฟล์นี้' });
    }
    const expected = sectionNumberOf(section);
    if (parsed.sectionNumber && expected && parsed.sectionNumber !== expected) {
      return res.status(400).json({
        error: `ไฟล์นี้เป็นใบรายชื่อของ Sect.${parsed.sectionNumber} แต่เลือกกลุ่ม ${section} กรุณาเลือกกลุ่มให้ตรงกัน`
      });
    }
    const token = crypto.randomBytes(8).toString('hex');
    req.session.pendingRoster = { token, section, students: parsed.students };
    res.json({
      token,
      students: parsed.students,
      existing: model.students.filter(s => s.section === section).length,
      warning: parsed.sectionNumber ? '' : 'ไม่พบเลข Section ในไฟล์ กรุณาตรวจสอบว่าเลือกกลุ่มถูกต้อง'
    });
  });

// Step 2: write the previewed list to the Roster tab.
app.post('/teacher/roster/confirm', async (req, res) => {
  if (!req.session.isTeacher) return res.redirect('/teacher');
  const pending = req.session.pendingRoster;
  delete req.session.pendingRoster;
  if (!pending || pending.token !== req.body.token) {
    req.session.flash = { ok: false, message: 'หมดเวลายืนยัน กรุณาอัปโหลดไฟล์ใหม่' };
    return res.redirect('/teacher');
  }
  try {
    await dataSource.replaceRoster(pending.section, pending.students);
    req.session.flash = {
      ok: true,
      section: pending.section,
      message: `บันทึกรายชื่อ ${pending.section} จำนวน ${pending.students.length} คนลงแท็บ Roster แล้ว`
    };
  } catch (err) {
    console.error('Roster import error:', err.message);
    req.session.flash = { ok: false, section: pending.section, message: `บันทึกไม่สำเร็จ: ${err.message}` };
  }
  res.redirect('/teacher?section=' + encodeURIComponent(pending.section));
});

// --------------- Grades ---------------

async function loadGradeView(res, section, force) {
  const model = await loadModel(res, force);
  if (!model) return null;
  const cfg = grades.gradeConfig(model);
  const chosen = cfg.sections.includes(section) ? section : cfg.sections[0];
  if (!chosen) return { model, cfg, view: null };
  try {
    const records = await gradeStore.load(force);
    return { model, cfg, records, view: grades.sectionGrades(model, records, gradeStore, cfg, chosen) };
  } catch (err) {
    console.error('Grade load error:', err.message);
    res.status(500).send(pages.renderDataError(err.message));
    return null;
  }
}

app.get('/teacher/grades', async (req, res) => {
  if (!req.session.isTeacher) return res.redirect('/teacher');
  const data = await loadGradeView(res, req.query.section || (req.session.flash && req.session.flash.section), req.query.refresh === '1');
  if (!data) return;
  const flash = req.session.flash;
  delete req.session.flash;
  res.send(gradePages.renderGradesPage(data.model, data.cfg, data.view, flash));
});

app.post('/teacher/grades/save', async (req, res) => {
  if (!req.session.isTeacher) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบใหม่' });
  let model;
  try {
    model = await dataSource.load();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  const cfg = grades.gradeConfig(model);
  const section = req.body && req.body.section;
  if (!cfg.sections.includes(section)) return res.status(400).json({ error: 'กลุ่มเรียนนี้ไม่ได้ใช้ระบบคะแนน' });
  const changes = Array.isArray(req.body.changes) ? req.body.changes.slice(0, 2000) : [];
  const defs = grades.fieldDefs(cfg);
  const enrolled = new Set(model.students.filter(s => s.section === section).map(s => s.id));

  const valid = [];
  const errors = [];
  changes.forEach(ch => {
    const studentId = normId(ch && ch.studentId);
    const def = defs.find(d => d.key === (ch && ch.field));
    if (!enrolled.has(studentId)) return errors.push({ studentId, field: ch && ch.field, message: `ไม่พบรหัส ${studentId} ในกลุ่มนี้` });
    if (!def) return errors.push({ studentId, field: ch.field, message: 'ไม่รู้จักช่องคะแนนนี้' });
    const v = grades.validateValue(def, ch.value);
    if (v.error) return errors.push({ studentId, field: def.key, message: v.error });
    valid.push({ studentId, field: def.key, value: v.value });
  });

  try {
    if (valid.length) await gradeStore.save(cfg.term, section, valid, 'teacher');
    const records = await gradeStore.load(true);
    const rows = {};
    new Set(valid.map(v => v.studentId)).forEach(id => {
      const st = model.studentById[id];
      const rec = gradeStore.get(records, cfg.term, section, id);
      const calc = grades.computeGrade(rec, model.studentReport(st), cfg);
      rows[id] = gradePages.rowPayload({ student: st, rec, calc });
    });
    res.status(errors.length && !valid.length ? 400 : 200).json({ rows, errors });
  } catch (err) {
    console.error('Grade save error:', err.message);
    res.status(500).json({ error: `บันทึกไม่สำเร็จ: ${err.message}` });
  }
});

app.post('/teacher/grades/visibility', async (req, res) => {
  if (!req.session.isTeacher) return res.redirect('/teacher');
  const model = await loadModel(res);
  if (!model) return;
  const cfg = grades.gradeConfig(model);
  const allowed = new Set(grades.visibleItemDefs(cfg).map(d => d.key));
  const items = [].concat(req.body.items || []).filter(k => allowed.has(k));
  try {
    await dataSource.updateSetting('grades_visible', items.join(','));
    req.session.flash = { ok: true, section: req.body.section, message: `บันทึกแล้ว เปิดให้นักศึกษาดู ${items.length} รายการ` };
  } catch (err) {
    req.session.flash = { ok: false, section: req.body.section, message: `บันทึกไม่สำเร็จ: ${err.message}` };
  }
  res.redirect('/teacher/grades?section=' + encodeURIComponent(req.body.section || ''));
});

app.get('/teacher/grades/export.:format(xlsx|csv)', async (req, res) => {
  if (!req.session.isTeacher) return res.redirect('/teacher');
  const data = await loadGradeView(res, req.query.section);
  if (!data) return;
  if (!data.view) return res.status(404).send('No section');
  const base = `grades-${data.cfg.term.replace(/\W+/g, '-')}-${data.view.section.replace(/[^\w]+/g, '-')}`;
  if (req.params.format === 'xlsx') {
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    return res.send(gradePages.gradesXlsx(data.view, data.cfg));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${base}.csv"`);
  res.send(gradePages.gradesCsv(data.view, data.cfg));
});

app.get('/teacher/export.csv', async (req, res) => {
  if (!req.session.isTeacher) return res.redirect('/teacher');
  const model = await loadModel(res);
  if (!model) return;
  const section = model.sections.includes(req.query.section) ? req.query.section : model.sections[0];
  if (!section) return res.status(404).send('No section');
  const filename = `attendance-${section.replace(/[^\w]+/g, '-')}.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pages.renderSectionCsv(model, section));
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/student.html');
});

async function processCheckin(req, res) {
  const scannedAt = req.session.scannedAt || 0;
  delete req.session.pendingToken;
  delete req.session.scannedAt;

  if (Date.now() - scannedAt > CHECKIN_FORM_WINDOW_MS) {
    return res.send(renderPage(
      'หมดเวลากรอกข้อมูล',
      'ใช้เวลากรอกข้อมูลนานเกินไป กรุณาสแกน QR code ใหม่จากหน้าจอของอาจารย์',
      'red'
    ));
  }

  try {
    await recordAttendance(req.session.user);
    const user = req.session.user;
    res.send(renderResultPage(user));
  } catch (err) {
    console.error('Record attendance error:', err.message);
    res.status(500).send(renderPage(
      'Recording Failed',
      `Authentication succeeded but failed to save to Google Sheets: ${err.message}`,
      'red'
    ));
  }
}

// --------------- HTML Helpers ---------------

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage(title, message, color) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; background: #f0f2f5; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 48px; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 420px; width: 100%; }
    h1 { color: ${color}; font-size: 1.5rem; margin-bottom: 12px; }
    p { color: #555; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

function renderResultPage(user) {
  const now = new Date();
  const timeStr = now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>บันทึกการเข้าเรียนสำเร็จ</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; background: #f0f2f5; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 48px; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 420px; width: 100%; }
    .check { font-size: 64px; margin-bottom: 16px; color: #22c55e; }
    h1 { color: #22c55e; font-size: 1.5rem; margin-bottom: 20px; }
    .info { text-align: left; background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .info div { padding: 6px 0; color: #333; font-size: 0.95rem; }
    .label { color: #888; font-size: 0.85rem; display: block; margin-bottom: 2px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>บันทึกการเข้าเรียนสำเร็จ!</h1>
    <div class="info">
      <div><span class="label">กลุ่มเรียน</span>${escapeHtml(user.section)}</div>
      <div><span class="label">รหัสนักศึกษา</span>${escapeHtml(user.studentId)}</div>
      <div><span class="label">ชื่อ-นามสกุล</span>${escapeHtml(user.fullName)}</div>
      <div><span class="label">อีเมล</span>${escapeHtml(user.email)}</div>
      <div><span class="label">เวลา</span>${timeStr}</div>
    </div>
  </div>
</body>
</html>`;
}

function renderProfilePage(user, errorMsg, form) {
  const values = form || {
    section: user.section || '',
    studentId: user.studentId || '',
    fullName: user.fullName || ''
  };
  const sectionOptions = SECTIONS.map(s =>
    `<option value="${escapeHtml(s)}"${s === values.section ? ' selected' : ''}>${escapeHtml(s)}</option>`
  ).join('');
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>กรอกข้อมูลนักศึกษา</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; background: #f0f2f5; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 40px; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 440px; width: 100%; }
    .avatar { width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 12px; display: block;
              object-fit: cover; }
    h1 { color: #1e3a5f; font-size: 1.4rem; margin-bottom: 4px; }
    .google-email { color: #888; font-size: 0.85rem; margin-bottom: 28px; }
    label { display: block; text-align: left; font-size: 0.9rem; color: #555;
            margin-bottom: 6px; font-weight: 600; }
    input, select { width: 100%; padding: 12px 16px; border: 1.5px solid #e5e7eb; border-radius: 10px;
            font-size: 1rem; outline: none; transition: border-color 0.2s; margin-bottom: 20px;
            font-family: inherit; }
    select { background: white; appearance: auto; }
    input:focus, select:focus { border-color: #3b82f6; }
    .btn { width: 100%; padding: 14px; background: #3b82f6; color: white; border: none;
           border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer;
           transition: background 0.2s; font-family: inherit; }
    .btn:hover { background: #2563eb; }
    .error-banner { background: #fef2f2; color: #dc2626; border-radius: 8px;
                    padding: 10px 14px; margin-bottom: 20px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <img src="${escapeHtml(user.picture)}" alt="" class="avatar" onerror="this.style.display='none'">
    <h1>กรอกข้อมูลนักศึกษา</h1>
    <p class="google-email">เข้าสู่ระบบด้วย ${escapeHtml(user.email)}</p>

    ${errorMsg ? `<div class="error-banner">${errorMsg}</div>` : ''}

    <form method="POST" action="/profile">
      <label for="section">กลุ่มเรียน</label>
      <select id="section" name="section" required>
        <option value=""${values.section ? '' : ' selected'} disabled>-- เลือกกลุ่มเรียน --</option>
        ${sectionOptions}
      </select>

      <label for="studentId">รหัสนักศึกษา</label>
      <input type="text" id="studentId" name="studentId" placeholder="เช่น 65xxxxxxx" required autocomplete="off"
             inputmode="numeric" value="${escapeHtml(values.studentId)}">

      <label for="fullName">ชื่อ-นามสกุล (ภาษาไทย)</label>
      <input type="text" id="fullName" name="fullName" placeholder="เช่น สมชาย ใจดี" required autocomplete="name"
             lang="th" pattern="[\\u0E00-\\u0E7F]+(\\s+[\\u0E00-\\u0E7F]+)+"
             title="กรุณากรอกชื่อ-นามสกุลเป็นภาษาไทย โดยเว้นวรรคระหว่างชื่อและนามสกุล"
             value="${escapeHtml(values.fullName)}">

      <button type="submit" class="btn">บันทึกการเข้าเรียน</button>
    </form>
  </div>
</body>
</html>`;
}

// --------------- Start Server ---------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Attendance server running at ${BASE_URL}`);
  console.log(`  Teacher view: ${BASE_URL}/teacher.html`);
  console.log(`  Student view: ${BASE_URL}/student.html`);
});
