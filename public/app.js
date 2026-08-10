let currentTab = 'videos';
let mediaData = { videos: [], images: [] };
let authMode = 'login';

const videoPlayer = document.getElementById('vlcPlayer');
const imageViewer = document.getElementById('vlcImageViewer');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const dragHint = document.getElementById('dragDropHint');

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

// Multi-file Upload Handler with Progress Tracker
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    uploadFilesBatch(e.target.files);
  }
});

// Drag and Drop Upload Support
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dragHint.classList.remove('hidden');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dragHint.classList.add('hidden');
  });
});

dropZone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length > 0) {
    uploadFilesBatch(files);
  }
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

  // Show status modal
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

      // Calculate Upload Speed
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
      alert('Upload failed: ' + xhr.statusText);
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
  list.innerHTML = '';

  mediaData[currentTab].forEach(item => {
    const li = document.createElement('li');

    const infoSpan = document.createElement('span');
    infoSpan.className = 'item-info';
    infoSpan.innerHTML = `${item.originalName} <span class="uploader-tag">(by ${item.uploadedBy})</span>`;
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