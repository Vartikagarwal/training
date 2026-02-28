const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { readUsers, writeUsers, findUserByEmail, createToken, verifyToken } = require('./auth');

const app = express();
const PORT = process.env.PORT || 5000;

const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload;
  next();
}

app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (findUserByEmail(trimmedEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const users = readUsers();
  const id = Date.now().toString();
  const passwordHash = await bcrypt.hash(password, 10);
  users.push({ id, email: trimmedEmail, passwordHash, createdAt: new Date().toISOString() });
  writeUsers(users);
  const user = { id, email: trimmedEmail };
  const token = createToken(user);
  res.status(201).json({ user, token });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const userRecord = findUserByEmail(trimmedEmail);
  if (!userRecord) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const match = await bcrypt.compare(password, userRecord.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });
  const user = { id: userRecord.id, email: userRecord.email };
  const token = createToken(user);
  res.json({ user, token });
});

app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  res.json({ user: { id: payload.id, email: payload.email } });
});

app.use('/api/tasks', authMiddleware);
app.use('/api/subjects', authMiddleware);
app.use('/api/growth', authMiddleware);

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { tasks: [], subjects: ['Math', 'Science', 'English', 'History', 'Programming'] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Get all tasks
app.get('/api/tasks', (req, res) => {
  const data = readData();
  res.json(data.tasks);
});

// Get all subjects
app.get('/api/subjects', (req, res) => {
  const data = readData();
  res.json(data.subjects || []);
});

// Add subject
app.post('/api/subjects', (req, res) => {
  const { name } = req.body;
  const data = readData();
  if (!data.subjects) data.subjects = [];
  if (name && !data.subjects.includes(name)) {
    data.subjects.push(name);
    writeData(data);
  }
  res.json(data.subjects);
});

// Create task
app.post('/api/tasks', (req, res) => {
  const data = readData();
  const task = {
    id: Date.now().toString(),
    title: req.body.title || 'Untitled',
    subject: req.body.subject || data.subjects[0],
    dueDate: req.body.dueDate || null,
    priority: req.body.priority || 'medium',
    status: req.body.status || 'todo',
    completedAt: null,
    createdAt: new Date().toISOString(),
  };
  data.tasks.push(task);
  writeData(data);
  res.status(201).json(task);
});

// Update task
app.put('/api/tasks/:id', (req, res) => {
  const data = readData();
  const idx = data.tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  const updated = { ...data.tasks[idx], ...req.body };
  if (req.body.status === 'done' && !data.tasks[idx].completedAt) {
    updated.completedAt = new Date().toISOString();
  }
  data.tasks[idx] = updated;
  writeData(data);
  res.json(updated);
});

// Delete task
app.delete('/api/tasks/:id', (req, res) => {
  const data = readData();
  const idx = data.tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  data.tasks.splice(idx, 1);
  writeData(data);
  res.status(204).send();
});

// Growth stats: completion over time, by subject, streaks
app.get('/api/growth', (req, res) => {
  const data = readData();
  const tasks = data.tasks || [];
  const now = new Date();

  const completed = tasks.filter((t) => t.status === 'done' && t.completedAt);
  const byWeek = {};
  const bySubject = {};
  const last7Days = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7Days.push({ date: key, count: 0, label: d.toLocaleDateString('en-US', { weekday: 'short' }) });
  }

  completed.forEach((t) => {
    const date = t.completedAt.slice(0, 10);
    const weekKey = date.slice(0, 7);
    byWeek[weekKey] = (byWeek[weekKey] || 0) + 1;
    bySubject[t.subject] = (bySubject[t.subject] || 0) + 1;
    const dayIdx = last7Days.findIndex((d) => d.date === date);
    if (dayIdx !== -1) last7Days[dayIdx].count++;
  });

  const weeklyTrend = Object.entries(byWeek)
    .sort()
    .slice(-6)
    .map(([week, count]) => ({ week, count }));

  res.json({
    totalTasks: tasks.length,
    completedCount: completed.length,
    completionRate: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0,
    bySubject: Object.entries(bySubject).map(([name, count]) => ({ name, count })),
    weeklyTrend,
    last7Days,
  });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
