import './styles/main.css';

console.log('👋 This message is being logged by "renderer.js", included via webpack');

// DOM helpers
const $ = (sel) => document.querySelector(sel);

// View switchers (existing)
const sidebarItems = document.querySelectorAll('#app-sidebar .sidebar-item');
const appViews = document.querySelectorAll('#main-content .app-view');
const goToVaultBtn = document.querySelector('[data-view-target="vault-view"]');

function showView(viewId) {
  appViews.forEach((view) => {
    if (view.id === viewId) {
      view.style.display = 'block';
      view.classList.add('app-view');
    } else {
      view.style.display = 'none';
      view.classList.add('app-view');
    }
  });
}

// Enable Sign in button state for new auth screen
const authUser = document.getElementById('auth-username');
const authPass = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
function updateAuthButtonState() {
  if (!authSubmit) return;
  const ok = (authUser && authUser.value.trim()) && (authPass && authPass.value.trim());
  if (ok) authSubmit.classList.add('enabled'); else authSubmit.classList.remove('enabled');
  authSubmit.disabled = !ok;
}
if (authUser) authUser.addEventListener('input', updateAuthButtonState);
if (authPass) authPass.addEventListener('input', updateAuthButtonState);

if (sidebarItems && sidebarItems.length) {
  sidebarItems.forEach((item) => {
    item.addEventListener('click', () => {
      sidebarItems.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      const target = item.getAttribute('data-view');
      if (target) showView(target);
    });
  });
}

if (goToVaultBtn) {
  goToVaultBtn.addEventListener('click', () => {
    const vaultItem = Array.from(sidebarItems).find((i) => i.getAttribute('data-view') === 'vault-view');
    if (vaultItem) vaultItem.click();
  });
}

// App/login toggling
function showApp(visible) {
  const loginView = $('#login-view');
  const appContainer = $('#app-container');
  if (visible) {
    if (loginView) loginView.style.display = 'none';
    if (appContainer) appContainer.style.display = 'grid';
  } else {
    if (loginView) loginView.style.display = 'block';
    if (appContainer) appContainer.style.display = 'none';
  }
}

// Files table rendering
async function loadFiles() {
  try {
    const files = await window.ipcRenderer.invoke('files:get');
    const tbody = document.querySelector('.file-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    (files || []).forEach((f) => {
      const tr = document.createElement('tr');
      const d = f.lastModifiedUTC ? new Date(f.lastModifiedUTC).toISOString().slice(0,10) : '';
      tr.innerHTML = `<td>${f.originalName || ''}</td><td>${f.type || ''}</td><td>${f.size || ''}</td><td>${d}</td><td></td><td>Synced</td><td></td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('loadFiles failed:', e);
  }
}

// Login flow
const loginBtn = $('#login-button');
if (loginBtn) {
  loginBtn.addEventListener('click', async () => {
    const username = ($('#username')?.value || '').trim();
    const password = ($('#password')?.value || '').trim();
    const errorEl = $('#login-error');
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
    if (!username || !password) {
      if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = 'Enter username and password.'; }
      return;
    }
    loginBtn.classList.add('loading');
    try {
      const result = await window.ipcRenderer.invoke('user:login', { username, password });
      if (!result || !result.token) throw new Error('Login failed.');
      showApp(true);
      await loadFiles();
    } catch (e) {
      console.error('login failed:', e);
      if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = e.message || 'Login failed.'; }
    } finally {
      loginBtn.classList.remove('loading');
    }
  });
}

// Upload modal wiring
const uploadBtn = $('#dash-upload-file');
const uploadModal = $('#upload-modal');
const uploadDropzone = $('#upload-dropzone');
const uploadFileInput = $('#upload-file-input');
const uploadPassword = $('#upload-password');
const uploadCancel = $('#upload-cancel');
const uploadSubmit = $('#upload-submit');
const uploadError = $('#upload-error');
let selectedPath = null;

function openUploadModal() {
  selectedPath = null;
  if (uploadError) { uploadError.style.display = 'none'; uploadError.textContent = ''; }
  if (uploadFileInput) uploadFileInput.value = '';
  if (uploadPassword) uploadPassword.value = '';
  if (uploadModal) uploadModal.style.display = 'block';
}
function closeUploadModal() {
  if (uploadModal) uploadModal.style.display = 'none';
}

if (uploadBtn && uploadModal) {
  uploadBtn.addEventListener('click', openUploadModal);
}
if (uploadCancel) {
  uploadCancel.addEventListener('click', closeUploadModal);
}

// Click to browse
if (uploadDropzone && uploadFileInput) {
  uploadDropzone.addEventListener('click', () => uploadFileInput.click());
  uploadDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      uploadFileInput.click();
    }
  });
  uploadFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Electron file input may not expose path by default; fallback to IPC file dialog if needed
    selectedPath = file.path;
    if (!selectedPath) {
      // Ask main to open dialog and choose a file
      window.ipcRenderer.invoke('dialog:openFile').then((paths) => {
        if (Array.isArray(paths) && paths.length) selectedPath = paths[0];
      });
    }
  });
}

// Drag & drop
if (uploadDropzone) {
  ;['dragenter','dragover'].forEach((evt) => uploadDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.add('dragging');
  }));
  ;['dragleave','drop'].forEach((evt) => uploadDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadDropzone.classList.remove('dragging');
  }));
  uploadDropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      selectedPath = files[0].path;
    }
  });
}

// Submit upload
if (uploadSubmit) {
  uploadSubmit.addEventListener('click', async () => {
    if (uploadError) { uploadError.style.display = 'none'; uploadError.textContent = ''; }
    const pwd = uploadPassword?.value || '';
    if (!pwd) {
      if (uploadError) { uploadError.style.display = 'block'; uploadError.textContent = 'Enter your vault password.'; }
      return;
    }
    if (!selectedPath) {
      if (uploadError) { uploadError.style.display = 'block'; uploadError.textContent = 'Select a file to upload.'; }
      return;
    }
    try {
      const res = await window.ipcRenderer.invoke('file:addPath', { password: pwd, filePath: selectedPath });
      if (!res?.success) throw new Error(res?.message || 'Upload failed.');
      closeUploadModal();
      await loadFiles();
    } catch (e) {
      console.error('upload failed:', e);
      if (uploadError) { uploadError.style.display = 'block'; uploadError.textContent = e.message || 'Upload failed.'; }
    }
  });
}

// Initial state
showApp(false);

