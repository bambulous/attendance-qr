# QR Code Attendance System

ระบบเช็คชื่อเข้าเรียนผ่าน QR Code ด้วย Google OAuth + Google Sheets

## Features

- **Teacher View** — แสดง QR Code ที่ reset token อัตโนมัติทุก 30 วินาที
- **Student View** — scan QR แล้ว login ด้วย Google เพื่อยืนยันตัวตน
- **Google Sheets** — บันทึกข้อมูลการเช็คชื่อลง Google Sheets อัตโนมัติ

## Prerequisites

- Node.js 18+
- Google Cloud Project ที่ enable APIs แล้ว

## Setup

### 1. Install dependencies

```bash
cd attendance-qr
npm install
```

### 2. Setup Google Cloud Project

ไปที่ [Google Cloud Console](https://console.cloud.google.com/):

#### 2a. สร้าง OAuth 2.0 Credentials (สำหรับ student login)

1. ไปที่ **APIs & Services > Credentials**
2. กด **Create Credentials > OAuth client ID**
3. เลือก **Web application**
4. ตั้ง **Authorized redirect URIs**: `http://localhost:3000/auth/google/callback`
5. Copy **Client ID** และ **Client Secret**

#### 2b. สร้าง Service Account (สำหรับเขียน Google Sheets)

1. ไปที่ **APIs & Services > Credentials**
2. กด **Create Credentials > Service account**
3. สร้างเสร็จแล้ว เข้าไปที่ Service Account > **Keys** > **Add Key** > **Create new key** > JSON
4. Download file JSON แล้วบันทึกเป็น `service-account-key.json` ใน project folder

#### 2c. Enable APIs

ไปที่ **APIs & Services > Library** แล้ว enable:
- **Google Sheets API**
- **Google People API** (หรือ Google+ API)

### 3. สร้าง Google Sheet

1. สร้าง Google Sheet ใหม่
2. ใส่ header row: `Date | Time | Name | Email | Status`
3. **Share** sheet กับ email ของ Service Account (อยู่ใน file JSON ที่ download มา, field `client_email`)
4. ให้สิทธิ์ **Editor**
5. Copy **Sheet ID** จาก URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### 4. สร้างไฟล์ .env

```bash
copy .env.example .env
```

แก้ไขค่าในไฟล์ `.env`:

```env
PORT=3000
BASE_URL=http://localhost:3000
SESSION_SECRET=random-string-here

GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx

GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account-key.json
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
```

### 5. Start server

```bash
npm start
```

## Usage

| Page | URL | Description |
|------|-----|-------------|
| Teacher | `http://localhost:3000/teacher.html` | แสดง QR Code ให้นักเรียน scan |
| Student | `http://localhost:3000/student.html` | เปิด QR Scanner ในเว็บ (optional) |

### Flow

1. อาจารย์เปิด Teacher View บนจอโปรเจคเตอร์
2. นักเรียนใช้กล้องมือถือ scan QR Code (หรือเปิด Student View)
3. ระบบ redirect ไปยัง Google Login
4. หลัง login สำเร็จ ระบบบันทึกชื่อลง Google Sheets

### Google Sheet Output

| Date | Time | Name | Email | Status |
|------|------|------|-------|--------|
| 24/6/2569 | 13:45:30 | สมชาย ใจดี | somchai@gmail.com | Present |

## Tech Stack

- **Backend**: Node.js, Express, express-session
- **Auth**: Google OAuth 2.0
- **Storage**: Google Sheets API (via service account)
- **QR Code**: [qrcode.js](https://github.com/soldair/node-qrcode) (CDN)
- **QR Scanner**: [html5-qrcode](https://github.com/mebjas/html5-qrcode) (CDN)

## Attendance Dashboard

| Page | URL | Access |
|------|-----|--------|
| Student dashboard | `/my` (or `/`) | Student ID + `STUDENT_PASSWORD`, only when `student_dashboard` = `on` |
| Teacher dashboard | `/teacher` (small lock icon) | `TEACHER_PASSWORD` |

Set `TEACHER_PASSWORD` and `STUDENT_PASSWORD` as environment variables on Render. Do not put them in the code.

The dashboard creates these tabs in the attendance Google Sheet on first load:

| Tab | Columns | Purpose |
|-----|---------|---------|
| Roster | Section, StudentID, Name | Student list. Absence is counted only for students listed here. |
| Schedule | Section, Day, Start, End, LateAfter | Weekly classes. Empty LateAfter = no late check. |
| Calendar | Date, Section, Type, Start, End, LateAfter, Note | `หยุด` / `สอบ` / `งดสอน` cancel a class. `สอนชดเชย` adds one. Empty Section = all sections. |
| Adjustment | Date, Section, StudentID, Status, Note | Status: `กิจกรรม` (counts as present), `มา`, `สาย`, `ขาด` |
| Settings | Key, Value | `student_dashboard` (on/off), `semester_start`, `semester_end`, `scan_open_minutes_before` |

Rules: a scan after `LateAfter` (e.g. 09:46:00 for 09:45) is late. Two lates count as one absence.
Scans are accepted from `scan_open_minutes_before` minutes before the start until the end of class.
Other scans are listed under "รอตรวจสอบ" on the teacher dashboard.
Dates in the tabs use `YYYY-MM-DD`. Data is cached for 1 minute.

### Importing a class list

On the teacher dashboard, choose a section and upload the registration-office list (.xls, .xlsx or .csv).
The system finds each student ID and the name next to it, shows a preview, and after confirmation
replaces that section's rows in the Roster tab. If the file says a different `Sect.` number, the upload is refused.

## Grade Management (Gen Eng sections)

Teacher dashboard → tab **คะแนน** (`/teacher/grades`). Sections are listed in Settings `grade_sections`.

| Component | Items | Raw max | Weight |
|---|---|---|---|
| Attendance | auto from check-ins, 10 × (held − total absences) ÷ held; teacher can override | 10 | 10 |
| Quiz | 4 | 15 each | 15 |
| Conversation | 6 | 5 each | 15 |
| Midterm | 1 | Settings `midterm_max` (60) | 20 |
| Final | 1 | Settings `final_max` (60) | 20 |
| Speexx | 1 | Settings `speexx_max` (10) | 10 |
| Pre-test / Post-test | completion: blank / done / not done | – | 5 each |

- Raw scores are stored in the **Grades** tab (one row per term + section + student). Edit them only through the web page.
- Every change is logged in **GradeHistory** (time, editor, old value, new value).
- Blank means "not recorded" and is different from 0. Totals are provisional until every item is recorded.
- University columns: coursework /60, midterm /20, final /20, each rounded to 2 decimals.
- Export: `.xlsx` and `.csv`. Students see only the items ticked under "เปิดคะแนนให้นักศึกษาดู" (Settings `grades_visible`).
