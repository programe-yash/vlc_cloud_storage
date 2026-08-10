let currentTab = 'videos';
let mediaData = { videos: [], images: [] };
let authMode = 'login';
let currentPlayingUrl = null;

const videoPlayer = document.getElementById('vlcPlayer');
const imageViewer = document.getElementById('vlcImageViewer');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const dragHint = document.getElementById('dragDropHint');
const speedControls = document.getElementById('speedControls');

// Resume Playback Memory Tracker
videoPlayer.addEventListener('timeupdate', () => {
  if (currentPlayingUrl && videoPlayer.currentTime > 0) {
    localStorage.setItem(`vlc_time_${currentPlayingUrl}`, videoPlayer.currentTime);
  }
});

function setPlaybackSpeed(speed) {
  videoPlayer.playbackRate = speed;
}

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

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    uploadFilesBatch(e.target.files);
  }
});

['dragenter', 'dragover'].forEach(name => {
  dropZone.addEventListener(name, (e) => {
    e.preventDefault();
    dragHint.classList.remove('hidden');
  });
});

['dragleave', 'drop'].forEach(name => {
  dropZone.addEventListener(name, (e) => {
    e.preventDefault();
    dragHint.classList.add('hidden');
  });
});

dropZone.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files.length > 0) uploadFilesBatch(files);
});

function uploadFilesBatch(files) {
  const formData = new FormData();
  const fileListContainer = document.getElementById('fileListProgress');
  fileListContainer.innerHTML = '';

  for (let i = 0; i < files.length; i++) {
    formData.append('mediaFiles', files[i]);
    const item = document.createElement('div');
    item.className = 'file-list-item';
    item.innerHTML = `<span>${files[i].name}</span> <span>${(files[i].size / (1024 * 1024)).toFixed(1)} MB</span>`;
    fileListContainer.appendChild(item);
  }

  document.getElementById('uploadStatusModal').classList.remove('hidden');
  document.getElementById('closeUploadBtn').classList.add('hidden');
  document.getElementById('uploadCount').textContent = `0 / ${files.length} Files`;

  const xhr = new XMLHttpRequest();
  const startTime = Date.now();

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percentComplete = Math.round((e.loaded / e.total) * 100);
      document.getElementById('overallProgressBar').style.width = percentComplete + '%';
      document.getElementById('uploadPercentage').textContent = percentComplete + '%';

      const elapsedTime = (Date.now() - startTime) / 1000;
      const speedKB = (e.loaded / 1024) / elapsedTime;
      document.getElementById('uploadSpeed').textContent = speedKB > 1024 
        ? `${(speedKB / 1024).toFixed(1)} MB/s` 
        : `${Math.round(speedKB)} KB/s`;
    }
  });

  xhr.addEventListener('load', () => {
    if (xhr.status === 200) {
      document.getElementById('uploadCount').textContent = `${files.length} / ${files.length} Complete!`;
      document.getElementById('closeUploadBtn').classList.remove('hidden');
      fileInput.value = '';
      loadMedia();
    } else {
      const errResponse = JSON.parse(xhr.responseText || '{}');
      alert('Upload failed: ' + (errResponse.error || xhr.statusText));
      closeUploadOverlay();
    }
  });

  xhr.open('POST', '/upload', true);
  xhr.send(formData);
}

function closeUploadOverlay() {
  document.getElementById('uploadStatusModal').classList.add('hidden');
  document.getElementById('overallProgressBar').style.width = '0%';
}

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
  const searchVal = document.getElementById('searchInput').value.toLowerCase();
  const sortVal = document.getElementById('sortSelect').value;

  list.innerHTML = '';
  document.getElementById('selectAllCheckbox').checked = false;

  let items = [...mediaData[currentTab]];

  if (searchVal) {
    items = items.filter(i => i.originalName.toLowerCase().includes(searchVal));
  }

  items.sort((a, b) => {
    if (sortVal === 'date-desc') return new Date(b.uploadDate) - new Date(a.uploadDate);
    if (sortVal === 'date-asc') return new Date(a.uploadDate) - new Date(b.uploadDate);
    if (sortVal === 'name-asc') return a.originalName.localeCompare(b.originalName);
    if (sortVal === 'size-desc') return b.size - a.size;
  });

  items.forEach(item => {
    const li = document.createElement('li');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'item-select-checkbox';
    checkbox.value = item.id;

    const infoSpan = document.createElement('span');
    infoSpan.className = 'item-info';
    infoSpan.innerHTML = `${item.originalName} <span style="font-size: 0.75rem; color:#888;">(${(item.size / (1024*1024)).toFixed(1)} MB)</span>`;
    infoSpan.onclick = () => playMedia(item.url, currentTab);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '🗑 Delete';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteSingleFile(item.id);
    };

    li.appendChild(checkbox);
    li.appendChild(infoSpan);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

function toggleSelectAll(master) {
  document.querySelectorAll('.item-select-checkbox').forEach(cb => cb.checked = master.checked);
}

function getSelectedIds() {
  return Array.from(document.querySelectorAll('.item-select-checkbox:checked')).map(cb => cb.value);
}

async function batchDeleteSelected() {
  const ids = getSelectedIds();
  if (ids.length === 0) return alert('No items selected.');
  if (!confirm(`Delete ${ids.length} selected item(s)?`)) return;

  const res = await fetch('/api/files/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });

  if (res.ok) loadMedia();
}

async function batchDownloadSelected() {
  const ids = getSelectedIds();
  if (ids.length === 0) return alert('No items selected.');

  const res = await fetch('/api/files/batch-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vlc-cloud-media.zip';
  a.click();
}

async function deleteSingleFile(id) {
  if (!confirm('Are you sure you want to delete this file?')) return;
  const res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
  if (res.ok) loadMedia();
}

function playMedia(url, type) {
  currentPlayingUrl = url;

  if (type === 'videos') {
    imageViewer.classList.add('hidden');
    videoPlayer.classList.remove('hidden');
    speedControls.classList.remove('hidden');
    videoPlayer.src = url;

    const savedTime = localStorage.getItem(`vlc_time_${url}`);
    if (savedTime) {
      videoPlayer.currentTime = parseFloat(savedTime);
    }
    videoPlayer.play();
  } else {
    videoPlayer.pause();
    videoPlayer.classList.add('hidden');
    speedControls.classList.add('hidden');
    imageViewer.classList.remove('hidden');
    imageViewer.src = url;
  }
}

checkAuth();