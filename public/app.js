let currentTab = 'videos';
let mediaData = { videos: [], images: [] };
let authMode = 'login';

const videoPlayer = document.getElementById('vlcPlayer');
const imageViewer = document.getElementById('vlcImageViewer');
const fileInput = document.getElementById('fileInput');

function toggleAuthTab(mode) {
  authMode = mode;
  document.getElementById('tabLoginBtn').classList.toggle('active', mode === 'login');
  document.getElementById('tabRegisterBtn').classList.toggle('active', mode === 'register');
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Login' : 'Register';
  document.getElementById('errorMsg').textContent = '';
  document.getElementById('successMsg').textContent = '';
}

async function handleAuth() {
  const username = document.getElementById('userInput').value;
  const password = document.getElementById('passwordInput').value;
  const errorMsg = document.getElementById('errorMsg');
  const successMsg = document.getElementById('successMsg');

  const endpoint = authMode === 'login' ? '/api/login' : '/api/register';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();

  if (res.ok) {
    if (authMode === 'register') {
      successMsg.textContent = data.message;
      toggleAuthTab('login');
    } else {
      checkAuth();
    }
  } else {
    errorMsg.textContent = data.error;
  }
}

async function checkAuth() {
  const res = await fetch('/api/check-auth');
  const data = await res.json();
  if (data.authenticated) {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');
    document.getElementById('currentUser').textContent = data.username;
    loadMedia();
  } else {
    document.getElementById('loginModal').classList.remove('hidden');
    document.getElementById('mainContent').classList.add('hidden');
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  checkAuth();
}

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('mediaFile', file);

  const res = await fetch('/upload', { method: 'POST', body: formData });
  if (res.ok) loadMedia();
});

async function loadMedia() {
  const res = await fetch('/api/files');
  if (!res.ok) return checkAuth();
  mediaData = await res.json();
  renderPlaylist();
}

function switchTab(type) {
  currentTab = type;
  document.getElementById('btnVideos').classList.toggle('active', type === 'videos');
  document.getElementById('btnImages').classList.toggle('active', type === 'images');
  renderPlaylist();
}

function renderPlaylist() {
  const list = document.getElementById('mediaList');
  list.innerHTML = '';

  mediaData[currentTab].forEach(item => {
    const li = document.createElement('li');

    const infoSpan = document.createElement('span');
    infoSpan.className = 'item-info';
    infoSpan.innerHTML = `${item.originalName} (by ${item.uploadedBy})`;
    infoSpan.onclick = () => playMedia(item.url, currentTab);

    li.appendChild(infoSpan);

    if (item.canDelete) {
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = '🗑 Delete';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteFile(currentTab, item.filename);
      };
      li.appendChild(delBtn);
    }

    list.appendChild(li);
  });
}

async function deleteFile(type, filename) {
  if (!confirm('Are you sure you want to delete this file?')) return;

  const res = await fetch(`/api/files/${type}/${encodeURIComponent(filename)}`, {
    method: 'DELETE'
  });

  if (res.ok) {
    loadMedia();
  } else {
    const data = await res.json();
    alert(data.error);
  }
}

function playMedia(url, type) {
  if (type === 'videos') {
    imageViewer.classList.add('hidden');
    videoPlayer.classList.remove('hidden');
    videoPlayer.src = url;
    videoPlayer.play();
  } else {
    videoPlayer.pause();
    videoPlayer.classList.add('hidden');
    imageViewer.classList.remove('hidden');
    imageViewer.src = url;
  }
}

checkAuth();