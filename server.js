require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const crypto = require('crypto');
const path = require('path');

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

const SECTIONS = [
  'Sec 1 สนทนาภาษาอังกฤษเพื่องานบริการ',
  'Sec 9 Gen Eng',
  'Sec 10 Gen Eng',
  'Sec 14 Gen Eng',
  'Sec 20 Gen Eng'
];

const THAI_NAME_PATTERN = /^[\u0E00-\u0E7F]+(?:\s+[\u0E00-\u0E7F]+)+$/;

let currentToken = null;
let tokenCreatedAt = null;

function rotateToken() {
  currentToken = crypto.randomBytes(16).toString('hex');
  tokenCreatedAt = Date.now();
}

rotateToken();
setInterval(rotateToken, TOKEN_TTL_SECONDS * 1000);

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

async function recordAttendance(user) {
  const sheets = await getSheetsClient();
  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
  const timeStr = now.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Sheet1!A:G',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[dateStr, timeStr, user.fullName, user.studentId, user.email, 'Present', user.section]]
    }
  });
}

// --------------- Routes ---------------

app.get('/api/token', (req, res) => {
  const elapsed = Math.floor((Date.now() - tokenCreatedAt) / 1000);
  const remaining = Math.max(0, TOKEN_TTL_SECONDS - elapsed);
  res.json({
    token: currentToken,
    remainingSeconds: remaining,
    ttlSeconds: TOKEN_TTL_SECONDS,
    checkinUrl: `${BASE_URL}/checkin?token=${currentToken}`
  });
});

app.get('/checkin', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send(renderPage('Error', 'Missing token', 'red'));
  }

  req.session.pendingToken = token;

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

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/student.html');
});

async function processCheckin(req, res) {
  const token = req.session.pendingToken;
  delete req.session.pendingToken;

  if (token !== currentToken) {
    return res.send(renderPage(
      'QR Code Expired',
      'The QR code has expired. Please scan the new QR code from the teacher.',
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
