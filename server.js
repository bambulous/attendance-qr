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

// --------------- Token Management ---------------

let currentToken = null;
let tokenCreatedAt = null;

function rotateToken() {
  currentToken = crypto.randomBytes(16).toString('hex');
  tokenCreatedAt = Date.now();
}

rotateToken();
setInterval(rotateToken, 30000);

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
    range: 'Sheet1!A:E',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[dateStr, timeStr, user.name, user.email, 'Present']]
    }
  });
}

// --------------- Routes ---------------

app.get('/api/token', (req, res) => {
  const elapsed = Math.floor((Date.now() - tokenCreatedAt) / 1000);
  const remaining = Math.max(0, 30 - elapsed);
  res.json({
    token: currentToken,
    remainingSeconds: remaining,
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
    return processCheckin(req, res);
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

    return processCheckin(req, res);
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.status(500).send(renderPage('Authentication Failed', 'Please try again.', 'red'));
  }
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
  <title>Check-in Success</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; background: #f0f2f5; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 48px; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 420px; width: 100%; }
    .check { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #22c55e; font-size: 1.5rem; margin-bottom: 20px; }
    .info { text-align: left; background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .info div { padding: 6px 0; color: #333; font-size: 0.95rem; }
    .label { color: #888; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h1>Check-in Successful!</h1>
    <div class="info">
      <div><span class="label">Name:</span> ${user.name}</div>
      <div><span class="label">Email:</span> ${user.email}</div>
      <div><span class="label">Time:</span> ${timeStr}</div>
    </div>
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
