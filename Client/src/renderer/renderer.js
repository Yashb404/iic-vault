import './styles/main.css';

console.log('👋 This message is being logged by "renderer.js", included via webpack');

// DOM helpers
const $ = (sel) => document.querySelector(sel);

// View switchers (existing)
const sidebarItems = document.querySelectorAll('.app-sidebar .nav-link');
const appViews = document.querySelectorAll('.app-main .app-view');
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
    const tbody = document.querySelector('.table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    (files || []).forEach((f) => {
      const tr = document.createElement('tr');
      const fileExtension = f.originalName ? f.originalName.split('.').pop().toUpperCase() : '';
      const modifiedDate = f.lastModifiedUTC ? new Date(f.lastModifiedUTC).toLocaleDateString() : 'Unknown';
      
      tr.innerHTML = `
        <td>
          <div class="name-col">
            <a href="#" class="recent-file">${f.originalName || 'Unknown'}</a>
            <div class="meta-line"><span class="badge badge-neutral">Encrypted</span></div>
          </div>
        </td>
        <td>${fileExtension}</td>
        <td>Unknown</td>
        <td>${modifiedDate}</td>
        <td><span class="badge badge-success">1 user</span></td>
        <td><span class="badge badge-success">synced</span></td>
        <td><button class="btn btn-ghost btn-sm" aria-label="More">⋮</button></td>
      `;
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
      if (!result || !result.id) throw new Error('Login failed.');
      
      console.log('Login successful:', result);
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
    
    // Try to get the file path, fallback to using the file input
    selectedPath = file.path || file.name;
    
    // If we don't have a proper path, use the file dialog instead
    if (!file.path) {
      window.ipcRenderer.invoke('dialog:openFile').then((filePath) => {
        if (filePath) {
          selectedPath = filePath;
          // Update the dropzone to show the selected file
          const dropzone = document.getElementById('upload-dropzone');
          if (dropzone) {
            dropzone.querySelector('.dropzone-title').textContent = `Selected: ${file.name}`;
            dropzone.querySelector('.dropzone-subtitle').textContent = 'Click to change file';
          }
        }
      });
    } else {
      // Update the dropzone to show the selected file
      const dropzone = document.getElementById('upload-dropzone');
      if (dropzone) {
        dropzone.querySelector('.dropzone-title').textContent = `Selected: ${file.name}`;
        dropzone.querySelector('.dropzone-subtitle').textContent = 'Click to change file';
      }
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
      const file = files[0];
      selectedPath = file.path || file.name;
      
      // Update the dropzone to show the dropped file
      const dropzone = document.getElementById('upload-dropzone');
      if (dropzone) {
        dropzone.querySelector('.dropzone-title').textContent = `Selected: ${file.name}`;
        dropzone.querySelector('.dropzone-subtitle').textContent = 'Click to change file';
      }
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
      
      // Show success message
      console.log('File uploaded successfully:', res);
      closeUploadModal();
      await loadFiles();
      
      // Reset the dropzone
      const dropzone = document.getElementById('upload-dropzone');
      if (dropzone) {
        dropzone.querySelector('.dropzone-title').textContent = 'Drag & drop file here';
        dropzone.querySelector('.dropzone-subtitle').textContent = 'or click to browse';
      }
    } catch (e) {
      console.error('upload failed:', e);
      if (uploadError) { uploadError.style.display = 'block'; uploadError.textContent = e.message || 'Upload failed.'; }
    }
  });
}

// Initial state
showApp(false);

