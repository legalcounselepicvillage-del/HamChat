const express = require('express');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_NAME_LENGTH = 24;
const MAX_ROOM_LENGTH = 32;
const MAX_MESSAGE_LENGTH = 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET must be set in production.');
}
const sessionSecret = process.env.SESSION_SECRET || require('node:crypto').randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('Using a temporary SESSION_SECRET; sessions will expire when the server restarts.');
}
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

const db = new Database(path.join(DATA_DIR, 'hamchat.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
const findUserByEmail = db.prepare('SELECT id, username, email, password_hash FROM users WHERE email = ?');
const findUserById = db.prepare('SELECT id, username, email FROM users WHERE id = ?');
const createUser = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');

const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  name: 'hamchat.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});

app.use(express.json({ limit: '10kb' }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email };
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة. يرجى الانتظار قليلاً ثم المحاولة مجدداً.' }
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
  const user = findUserById.get(req.session.userId);
  if (!user) {
    return req.session.destroy(() => res.status(401).json({ error: 'انتهت الجلسة. سجل الدخول مجدداً.' }));
  }
  res.json({ user: publicUser(user) });
});

app.post('/api/register', authLimiter, async (req, res, next) => {
  try {
    const username = cleanText(req.body?.username, MAX_NAME_LENGTH);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (username.length < 2) return res.status(400).json({ error: 'يجب أن يتكون الاسم من حرفين على الأقل.' });
    if (username.length > MAX_NAME_LENGTH) return res.status(400).json({ error: 'الاسم طويل جداً.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'أدخل بريداً إلكترونياً صالحاً.' });
    }
    if (password.length < 10 || password.length > 72) {
      return res.status(400).json({ error: 'يجب أن تكون كلمة المرور بين 10 و72 حرفاً.' });
    }
    if (findUserByEmail.get(email)) return res.status(409).json({ error: 'هذا البريد مسجل بالفعل. سجل الدخول بدلاً من ذلك.' });

    const passwordHash = await bcrypt.hash(password, 12);
    let result;
    try {
      result = createUser.run(username, email, passwordHash);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'هذا البريد مسجل بالفعل. سجل الدخول بدلاً من ذلك.' });
      }
      throw error;
    }
    const user = { id: Number(result.lastInsertRowid), username, email };
    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/login', authLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = findUserByEmail.get(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
    }
    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'تعذر تسجيل الخروج. حاول مجدداً.' });
    res.clearCookie('hamchat.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
  });
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, (error) => {
    if (error) return next(error);
    if (!socket.request.session?.userId) return next(new Error('يلزم تسجيل الدخول.'));
    const user = findUserById.get(socket.request.session.userId);
    if (!user) return next(new Error('انتهت الجلسة. سجل الدخول مجدداً.'));
    socket.data.user = publicUser(user);
    next();
  });
});

io.on('connection', (socket) => {
  socket.on('chat:join', (payload = {}) => {
    const room = cleanText(payload.room, MAX_ROOM_LENGTH).toLowerCase();
    if (!room || !/^[\p{L}\p{N}_-]+$/u.test(room)) {
      socket.emit('chat:error', 'أدخل اسم غرفة صالحاً. استخدم أحرفاً أو أرقاماً أو _ أو -.');
      return;
    }

    if (socket.data.room) {
      socket.to(socket.data.room).emit('chat:notice', `${socket.data.user.username} غادر الغرفة`);
      socket.leave(socket.data.room);
    }
    socket.data.room = room;
    socket.join(room);
    socket.emit('chat:joined', { name: socket.data.user.username, room });
    socket.to(room).emit('chat:notice', `${socket.data.user.username} انضم إلى الغرفة`);
  });

  socket.on('chat:message', (payload = {}) => {
    const room = socket.data.room;
    const text = cleanText(payload.text, MAX_MESSAGE_LENGTH);
    if (!room || !text) return;

    io.to(room).emit('chat:message', {
      id: socket.id,
      name: socket.data.user.username,
      text,
      sentAt: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit('chat:notice', `${socket.data.user.username} غادر الغرفة`);
    }
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: 'حدث خطأ في الخادم. حاول مجدداً.' });
});

server.listen(PORT, () => {
  console.log(`HamChat is running at http://localhost:${PORT}`);
});
