const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'vlc-cloud-secret-key-change-this';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// File-based database paths
const USERS_FILE = path.join(__dirname, 'users.json');
const METADATA_FILE = path.join(__dirname, 'file-metadata.json');

// Helper functions for reading/writing JSON files
const readData = (filePath) => fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
const writeData = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

// Ensure upload directories exist
['uploads/videos', 'uploads/images'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, 'uploads/videos');
    else if (file.mimetype.startsWith('image/')) cb(null, 'uploads/images');
    else cb(new Error('Invalid file type'), false);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
  }
});
const upload = multer({ storage });

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const token = req.cookies.vlc_auth_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized. Please login.' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired. Please login again.' });
    req.user = user;
    next();
  });
}

// ----------------- AUTHENTICATION API -----------------

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const users = readData(USERS_FILE);
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  users.push({ username, password: hashedPassword });
  writeData(USERS_FILE, users);

  res.json({ success: true, message: 'Registration successful! You can now log in.' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readData(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (user && await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '7d' });
    res.cookie('vlc_auth_token', token, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 3600 * 1000 
    });
    return res.json({ success: true, username: user.username });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

app.get('/api/check-auth', (req, res) => {
  const token = req.cookies.vlc_auth_token;
  if (!token) return res.json({ authenticated: false });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.json({ authenticated: false });
    res.json({ authenticated: true, username: user.username });
  });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('vlc_auth_token');
  res.json({ success: true });
});

// ----------------- PRIVATE FILE HANDLING API -----------------

// Upload File Endpoint
app.post('/upload', authenticateToken, upload.single('mediaFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const metadata = readData(METADATA_FILE);
  const fileType = req.file.mimetype.startsWith('video/') ? 'videos' : 'images';

  metadata.push({
    filename: req.file.filename,
    originalName: req.file.originalname,
    uploadedBy: req.user.username,
    type: fileType,
    uploadDate: new Date().toISOString()
  });

  writeData(METADATA_FILE, metadata);
  res.json({ message: 'File uploaded successfully!' });
});

// Get User's Own Files Only
app.get('/api/files', authenticateToken, (req, res) => {
  const metadata = readData(METADATA_FILE);

  // Filter so users ONLY see files they uploaded
  const formatList = (type) => metadata
    .filter(f => f.type === type && f.uploadedBy === req.user.username)
    .map(f => ({
      filename: f.filename,
      originalName: f.originalName,
      uploadedBy: f.uploadedBy,
      url: `/media/${type}/${encodeURIComponent(f.filename)}`,
      canDelete: true
    }));

  res.json({
    videos: formatList('videos'),
    images: formatList('images')
  });
});

// Delete File Endpoint
app.delete('/api/files/:type/:filename', authenticateToken, (req, res) => {
  const { type, filename } = req.params;
  const metadata = readData(METADATA_FILE);

  const fileIndex = metadata.findIndex(f => f.filename === filename && f.type === type);
  if (fileIndex === -1) return res.status(404).json({ error: 'File not found' });

  const fileRecord = metadata[fileIndex];

  // Restrict deletion to owner
  if (fileRecord.uploadedBy !== req.user.username) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  // Remove file from disk
  const filePath = path.join(__dirname, 'uploads', type, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // Remove metadata record
  metadata.splice(fileIndex, 1);
  writeData(METADATA_FILE, metadata);

  res.json({ success: true, message: 'File deleted successfully' });
});

// Secure Private Stream Route (HTTP 206)
app.get('/media/videos/:filename', authenticateToken, (req, res) => {
  const metadata = readData(METADATA_FILE);
  const fileRecord = metadata.find(f => f.filename === req.params.filename && f.type === 'videos');

  // Verify ownership before serving stream
  if (!fileRecord || fileRecord.uploadedBy !== req.user.username) {
    return res.status(403).send('Access denied. You do not own this media.');
  }

  const filePath = path.join(__dirname, 'uploads/videos', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Video not found.');

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Secure Private Images Route
app.get('/media/images/:filename', authenticateToken, (req, res) => {
  const metadata = readData(METADATA_FILE);
  const fileRecord = metadata.find(f => f.filename === req.params.filename && f.type === 'images');

  // Verify ownership before serving image
  if (!fileRecord || fileRecord.uploadedBy !== req.user.username) {
    return res.status(403).send('Access denied. You do not own this media.');
  }

  const filePath = path.join(__dirname, 'uploads/images', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Image not found.');

  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`Express Private VLC Cloud Storage running on port ${PORT}`);
});