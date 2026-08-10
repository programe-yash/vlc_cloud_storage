const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'vlc-cloud-secret-key-change-this';

// Strict Content Security Policy Header (No unsafe-eval)
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data: blob:;"
  );
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// File-based database paths
const USERS_FILE = path.join(__dirname, 'users.json');
const METADATA_FILE = path.join(__dirname, 'file-metadata.json');

const readData = (filePath) => fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
const writeData = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

// Ensure upload directories exist on disk
['uploads/videos', 'uploads/images'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer Storage Configuration (Local Disk Storage)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, 'uploads/videos');
    else if (file.mimetype.startsWith('image/')) cb(null, 'uploads/images');
    else cb(new Error('Invalid file type. Only videos and images are allowed.'), false);
  },
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${cleanName}`);
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

// ----------------- MEDIA & FILE HANDLING API -----------------

// Multi-file Upload Endpoint
app.post('/upload', authenticateToken, upload.array('mediaFiles', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const metadata = readData(METADATA_FILE);

  req.files.forEach(file => {
    const isVideo = file.mimetype.startsWith('video/');
    metadata.push({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      filename: file.filename,
      originalName: file.originalname,
      uploadedBy: req.user.username,
      type: isVideo ? 'videos' : 'images',
      size: file.size,
      uploadDate: new Date().toISOString()
    });
  });

  writeData(METADATA_FILE, metadata);
  res.json({ message: `${req.files.length} file(s) uploaded successfully!` });
});

// Fetch User's Private Files
app.get('/api/files', authenticateToken, (req, res) => {
  const metadata = readData(METADATA_FILE);

  const formatList = (type) => metadata
    .filter(f => f.type === type && f.uploadedBy === req.user.username)
    .map(f => ({
      id: f.id,
      filename: f.filename,
      originalName: f.originalName,
      uploadedBy: f.uploadedBy,
      url: `/media/${type}/${encodeURIComponent(f.filename)}`,
      size: f.size || 0,
      uploadDate: f.uploadDate,
      canDelete: true
    }));

  res.json({
    videos: formatList('videos'),
    images: formatList('images')
  });
});

// Delete Single File Endpoint
app.delete('/api/files/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const metadata = readData(METADATA_FILE);

  const fileIndex = metadata.findIndex(f => f.id === id);
  if (fileIndex === -1) return res.status(404).json({ error: 'File not found' });

  const fileRecord = metadata[fileIndex];

  if (fileRecord.uploadedBy !== req.user.username) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const filePath = path.join(__dirname, 'uploads', fileRecord.type, fileRecord.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  metadata.splice(fileIndex, 1);
  writeData(METADATA_FILE, metadata);

  res.json({ success: true, message: 'File deleted successfully' });
});

// Batch Delete Endpoint
app.post('/api/files/batch-delete', authenticateToken, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid payload' });

  let metadata = readData(METADATA_FILE);
  const filesToDelete = metadata.filter(f => ids.includes(f.id) && f.uploadedBy === req.user.username);

  filesToDelete.forEach(file => {
    const filePath = path.join(__dirname, 'uploads', file.type, file.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  metadata = metadata.filter(f => !(ids.includes(f.id) && f.uploadedBy === req.user.username));
  writeData(METADATA_FILE, metadata);

  res.json({ success: true, message: 'Batch deletion completed' });
});

// Batch Download as ZIP
app.post('/api/files/batch-download', authenticateToken, (req, res) => {
  const { ids } = req.body;
  const metadata = readData(METADATA_FILE);
  const filesToDownload = metadata.filter(f => ids.includes(f.id) && f.uploadedBy === req.user.username);

  if (filesToDownload.length === 0) {
    return res.status(400).json({ error: 'No valid files selected' });
  }

  res.attachment('vlc-cloud-media.zip');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  filesToDownload.forEach(file => {
    const filePath = path.join(__dirname, 'uploads', file.type, file.filename);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: file.originalName });
    }
  });

  archive.finalize();
});

// Stream Video Route (HTTP 206 Partial Content Streaming)
app.get('/media/videos/:filename', authenticateToken, (req, res) => {
  const metadata = readData(METADATA_FILE);
  const fileRecord = metadata.find(f => f.filename === req.params.filename && f.type === 'videos');

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

// Serve Images Route
app.get('/media/images/:filename', authenticateToken, (req, res) => {
  const metadata = readData(METADATA_FILE);
  const fileRecord = metadata.find(f => f.filename === req.params.filename && f.type === 'images');

  if (!fileRecord || fileRecord.uploadedBy !== req.user.username) {
    return res.status(403).send('Access denied. You do not own this media.');
  }

  const filePath = path.join(__dirname, 'uploads/images', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Image not found.');

  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`VLC Cloud Storage server active on port ${PORT}`);
});