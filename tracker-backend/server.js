const express = require('express');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const cors = require('cors');
const nodemailer = require('nodemailer');
const dns = require("dns").promises;

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;
const OTP_TTL = Number(process.env.OTP_TTL_SECONDS || 600);

// =======================================================
// 📌 Nodemailer setup
// =======================================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendOtpEmail(to, code) {
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Your OTP Code",
    text: `Your verification code is ${code}. It is valid for 10 minutes.`,
  });
  console.log("📧 OTP email sent:", info.messageId);

  if (info.rejected && info.rejected.length > 0) {
    throw new Error("Invalid email address");
  }
}

// =======================================================
// 📌 DB INIT
// =======================================================
const db = new Database('./tracker.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  is_verified INTEGER DEFAULT 0,
  role TEXT DEFAULT 'sharer',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expiresAt DATETIME NOT NULL,
  consumed INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viewer_email TEXT NOT NULL,
  sharer_email TEXT NOT NULL,
  granted INTEGER DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(viewer_email, sharer_email)
);
`);

// =======================================================
// 📌 Helpers
// =======================================================
function generateOtp(n = 6) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

function signToken(user) {
  return jwt.sign(
    { sub: user.email, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ✅ Email validators
function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function domainHasMX(email) {
  try {
    const domain = email.split("@")[1];
    if (!domain) return false;
    const records = await dns.resolveMx(domain);
    return records && records.length > 0;
  } catch {
    return false;
  }
}

// =======================================================
// 📌 Step 1: OTP REQUEST + VERIFY
// =======================================================
app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email_required' });

  // Regex check
  if (!isValidEmailFormat(email)) {
    return res.status(400).json({ error: 'invalid_email_format' });
  }

  // MX check
  const hasMx = await domainHasMX(email);
  if (!hasMx) {
    return res.status(400).json({ error: 'invalid_email_domain' });
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL * 1000).toISOString();
  db.prepare(`INSERT INTO otps (email, code, expiresAt) VALUES (?, ?, ?)`)
    .run(email, code, expiresAt);

  try {
    await sendOtpEmail(email, code);
    res.json({ message: 'otp_sent' });
  } catch {
    res.status(500).json({ error: 'email_failed' });
  }
});

app.post('/verify-otp', (req, res) => {
  const { email, otp, role } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'email_and_otp_required' });

  const record = db.prepare(`
    SELECT * FROM otps
    WHERE email = ? AND consumed = 0
    ORDER BY id DESC
    LIMIT 1
  `).get(email);

  if (!record) return res.status(400).json({ error: 'no_otp_requested' });
  if (new Date() > new Date(record.expiresAt)) return res.status(400).json({ error: 'otp_expired' });
  if (otp !== record.code) return res.status(401).json({ error: 'invalid_otp' });

  db.prepare(`UPDATE otps SET consumed = 1 WHERE id = ?`).run(record.id);

  let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  const finalRole = role === 'viewer' ? 'viewer' : 'sharer';

  if (!user) {
    db.prepare(`INSERT INTO users (email, is_verified, role) VALUES (?, 1, ?)`)
      .run(email, finalRole);
    user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  } else {
    if (!user.is_verified) {
      db.prepare(`UPDATE users SET is_verified = 1 WHERE email = ?`).run(email);
    }
    if (!user.role) {
      db.prepare(`UPDATE users SET role = ? WHERE email = ?`).run(finalRole, email);
    }
    user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  }

  const token = signToken(user);
  res.json({ token, user: { email, role: user.role, isVerified: true } });
});

// =======================================================
// 📌 JWT Middleware
// =======================================================
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const [, token] = auth.split(' ');
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// =======================================================
// 📌 Locations + Permissions
// =======================================================
app.post('/locations', authMiddleware, (req, res) => {
  if (req.user.role !== 'sharer') return res.status(403).json({ error: 'only_sharers_can_post' });

  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat_and_lng_required' });
  }
  db.prepare(`INSERT INTO locations (email, lat, lng) VALUES (?, ?, ?)`)
    .run(req.user.email, lat, lng);
  res.json({ message: 'location_saved' });
});

app.get('/locations/:email', authMiddleware, (req, res) => {
  if (req.user.role !== 'viewer') return res.status(403).json({ error: 'only_viewers_can_fetch' });

  const { email: sharerEmail } = req.params;
  const perm = db.prepare(`
    SELECT 1 FROM permissions
    WHERE viewer_email = ? AND sharer_email = ? AND granted = 1
    LIMIT 1
  `).get(req.user.email, sharerEmail);
  if (!perm) return res.status(403).json({ error: 'no_permission' });

  const loc = db.prepare(`
    SELECT email, lat, lng, updatedAt
    FROM locations
    WHERE email = ?
    ORDER BY updatedAt DESC, id DESC
    LIMIT 1
  `).get(sharerEmail);

  if (!loc) return res.status(404).json({ error: 'no_location_found' });
  res.json(loc);
});

app.post('/permissions/grant', authMiddleware, (req, res) => {
  if (req.user.role !== 'sharer') return res.status(403).json({ error: 'only_sharers_can_grant' });

  const { viewerEmail } = req.body;
  if (!viewerEmail) return res.status(400).json({ error: 'viewer_email_required' });

  db.prepare(`
    INSERT INTO permissions (viewer_email, sharer_email, granted)
    VALUES (?, ?, 1)
    ON CONFLICT(viewer_email, sharer_email) DO UPDATE SET granted = 1
  `).run(viewerEmail, req.user.email);

  res.json({ ok: true, message: 'permission_granted' });
});

// =======================================================
// 📌 Start Server
// =======================================================
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
