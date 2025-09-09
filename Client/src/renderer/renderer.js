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
    const files = await window.electronAPI.files.get();
    const tbody = document.querySelector('.file-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    (files || []).forEach((f) => {
      const tr = document.createElement('tr');
      const d = f.lastModifiedUTC ? new Date(f.lastModifiedUTC).toISOString().slice(0,10) : '';
      tr.innerHTML = `
        <td>
          <div class="name-col">
            <a href="#" class="recent-file" data-file-id="${f.id}">${f.originalName || ''}</a>
            <div class="meta-line"><span class="badge muted">Encrypted</span></div>
          </div>
        </td>
        <td>${f.type || (f.originalName ? f.originalName.split('.').pop().toUpperCase() : 'Unknown')}</td>
        <td>${f.size || 'Unknown'}</td>
        <td>${d}</td>
        <td><span class="chip success">${f.sharedWith ? f.sharedWith.length : 0} users</span></td>
        <td><span class="badge success">synced</span></td>
        <td>
          <button class="kebab" aria-label="More" data-file-id="${f.id}">⋮</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    // Add event listeners for file actions
    addFileActionListeners();
  } catch (e) {
    console.error('loadFiles failed:', e);
  }
}

// Add event listeners for file actions
function addFileActionListeners() {
  // File download
  document.querySelectorAll('.recent-file[data-file-id]').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const fileId = e.target.getAttribute('data-file-id');
        showPasswordModal(async (password) => {
          if (!password) return;
          try {
            const result = await window.electronAPI.files.download(fileId, password);
            if (result.success) {
              showNotification('File downloaded successfully', 'success');
            } else {
              showNotification(result.message, 'error');
            }
          } catch (error) {
            showNotification('Download failed: ' + error.message, 'error');
          }
        });
    });
  });

  // Password modal for downloads
function showPasswordModal(callback) {
  const modal = $('#password-modal');
  const passwordInput = $('#modal-password-input');
  const errorEl = $('#modal-error');
  const submitBtn = $('#modal-submit-btn');
  const cancelBtn = $('#modal-cancel-btn');

  if (!modal || !passwordInput || !submitBtn || !cancelBtn) return;

  // Reset state
  passwordInput.value = '';
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  modal.style.display = 'flex';
  passwordInput.focus();

  const cleanup = () => {
    modal.style.display = 'none';
    // Remove the old listeners to prevent them from stacking up
    submitBtn.replaceWith(submitBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
  };

  const onSubmit = () => {
    const password = passwordInput.value;
    if (!password) {
      if (errorEl) { 
        errorEl.textContent = 'Password cannot be empty.';
        errorEl.style.display = 'block';
      }
      return;
    }
    cleanup();
    callback(password);
  };

  const onCancel = () => {
    cleanup();
    callback(null); // Indicate cancellation
  };

  // Add event listeners
  submitBtn.addEventListener('click', onSubmit, { once: true });
  cancelBtn.addEventListener('click', onCancel, { once: true });
  
  // Also allow submitting with Enter key
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitBtn.click();
    }
  }, { once: true });
}

  // File actions menu
  document.querySelectorAll('.kebab[data-file-id]').forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      const fileId = e.target.getAttribute('data-file-id');
      showFileActionMenu(fileId, e.target);
    });
  });
}

// Show file action menu
function showFileActionMenu(fileId, button) {
  // Remove existing menus
  document.querySelectorAll('.file-action-menu').forEach(menu => menu.remove());
  
  const menu = document.createElement('div');
  menu.className = 'file-action-menu';
  menu.innerHTML = `
    <div class="menu-item" data-action="download" data-file-id="${fileId}">Download</div>
    <div class="menu-item" data-action="share" data-file-id="${fileId}">Share</div>
    <div class="menu-item danger" data-action="delete" data-file-id="${fileId}">Delete</div>
  `;
  
  // Position menu
  const rect = button.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = rect.bottom + 'px';
  menu.style.left = rect.left + 'px';
  menu.style.zIndex = '1000';
  
  document.body.appendChild(menu);
  
  // Add event listeners
  menu.addEventListener('click', async (e) => {
    const action = e.target.getAttribute('data-action');
    const targetFileId = e.target.getAttribute('data-file-id');
    
    if (action === 'download') {
      const password = prompt('Enter vault password to download:');
      if (password) {
        try {
          const result = await window.electronAPI.files.download(targetFileId, password);
          if (result.success) {
            showNotification('File downloaded successfully', 'success');
          } else {
            showNotification(result.message, 'error');
          }
        } catch (error) {
          showNotification('Download failed: ' + error.message, 'error');
        }
      }
    } else if (action === 'share') {
      const userIds = prompt('Enter user IDs to share with (comma-separated):');
      if (userIds) {
        try {
          const result = await window.electronAPI.files.share(targetFileId, userIds.split(',').map(id => id.trim()));
          if (result.success) {
            showNotification('File shared successfully', 'success');
          } else {
            showNotification(result.message, 'error');
          }
        } catch (error) {
          showNotification('Share failed: ' + error.message, 'error');
        }
      }
    } else if (action === 'delete') {
      if (confirm('Are you sure you want to delete this file?')) {
        try {
          const result = await window.electronAPI.files.delete(targetFileId);
          if (result.success) {
            showNotification('File deleted successfully', 'success');
            await loadFiles();
          } else {
            showNotification(result.message, 'error');
          }
        } catch (error) {
          showNotification('Delete failed: ' + error.message, 'error');
        }
      }
    }
    
    menu.remove();
  });
  
  // Close menu when clicking outside
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 0);
}

// Notification system
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 4px;
    color: white;
    z-index: 10000;
    background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
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
      const result = await window.electronAPI.user.login({ username, password });
      if (!result || !result.token) throw new Error('Login failed.');
      showApp(true);
      await loadFiles();
      await updateUserInfo();
      await updateSyncStatus();
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
      window.electronAPI.dialog.openFile().then((paths) => {
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
      const res = await window.electronAPI.files.addPath({ password: pwd, filePath: selectedPath });
      if (!res?.success) throw new Error(res?.message || 'Upload failed.');
      closeUploadModal();
      await loadFiles();
      showNotification('File uploaded and encrypted successfully', 'success');
    } catch (e) {
      console.error('upload failed:', e);
      if (uploadError) { uploadError.style.display = 'block'; uploadError.textContent = e.message || 'Upload failed.'; }
    }
  });
}

// Update user info in header
async function updateUserInfo() {
  try {
    const userInfo = await window.electronAPI.user.getInfo();
    if (userInfo) {
      const avatarBtn = $('#avatar-btn');
      const roleBadge = $('.role-badge');
      const acctName = $('.acct-name');
      const acctEmail = $('.acct-email');
      const acctDept = $('.acct-dept');
      
      if (avatarBtn) avatarBtn.textContent = userInfo.username.charAt(0).toUpperCase();
      if (roleBadge) roleBadge.textContent = `${userInfo.role.charAt(0).toUpperCase() + userInfo.role.slice(1)} • IT Security`;
      if (acctName) acctName.innerHTML = `${userInfo.username} <span class="chip danger">${userInfo.role.charAt(0).toUpperCase() + userInfo.role.slice(1)}</span>`;
      if (acctEmail) acctEmail.textContent = `${userInfo.username}@securevault.com`;
      if (acctDept) acctDept.textContent = 'IT Security';
    }
  } catch (error) {
    console.error('Failed to update user info:', error);
  }
}

// Update sync status
async function updateSyncStatus() {
  try {
    const syncStatus = await window.electronAPI.app.getSyncStatus();
    const syncBtn = $('#header-sync');
    const syncNowBtn = $('#sync-now-top');
    const dashSyncBtn = $('#dash-sync-now');
    const footerSyncBtn = $('#footer-sync');
    const statusPill = $('.status-pill');
    const statusProgress = $('.status-progress span');
    const statusBytes = $('.status-bytes');
    
    if (syncBtn) {
      syncBtn.textContent = syncStatus.status === 'synced' ? 'Synced' : 'Offline';
      syncBtn.className = `sync-indicator ${syncStatus.status}`;
    }
    
    if (statusPill) {
      statusPill.textContent = syncStatus.status === 'synced' ? 'Online' : 'Offline';
      statusPill.className = `status-pill ${syncStatus.status}`;
    }
    
    if (statusProgress) {
      statusProgress.style.width = syncStatus.status === 'synced' ? '100%' : '0%';
    }
    
    if (statusBytes) {
      statusBytes.textContent = `${syncStatus.filesCount || 0} files`;
    }
    
    // Add sync functionality to buttons
    [syncNowBtn, dashSyncBtn, footerSyncBtn].forEach(btn => {
      if (btn) {
        btn.onclick = async () => {
          try {
            btn.classList.add('loading');
            const result = await window.electronAPI.files.sync();
            if (result.success) {
              showNotification('Files synced successfully', 'success');
              await loadFiles();
              await updateSyncStatus();
            } else {
              showNotification(result.message, 'error');
            }
          } catch (error) {
            showNotification('Sync failed: ' + error.message, 'error');
          } finally {
            btn.classList.remove('loading');
          }
        };
      }
    });
  } catch (error) {
    console.error('Failed to update sync status:', error);
  }
}

// Load audit logs
async function loadAuditLogs() {
  try {
    const logs = await window.electronAPI.audit.get();
    const auditView = $('#audit-view');
    if (auditView) {
      if (logs.length === 0) {
        auditView.innerHTML = '<p class="placeholder">No audit logs found.</p>';
        return;
      }
      
      const table = document.createElement('table');
      table.className = 'audit-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr>
              <td>${new Date(log.timestamp).toLocaleString()}</td>
              <td>${log.userId}</td>
              <td>${log.action}</td>
              <td>${log.details || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      `;
      
      auditView.innerHTML = '';
      auditView.appendChild(table);
    }
  } catch (error) {
    console.error('Failed to load audit logs:', error);
    const auditView = $('#audit-view');
    if (auditView) {
      auditView.innerHTML = '<p class="placeholder">Failed to load audit logs.</p>';
    }
  }
}

// Add logout functionality
function addLogoutHandler() {
  const logoutBtn = document.querySelector('.menu-row.danger');
  if (logoutBtn && logoutBtn.textContent.includes('Log out')) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await window.electronAPI.user.logout();
        showApp(false);
        // Clear form fields
        const usernameField = $('#username');
        const passwordField = $('#password');
        if (usernameField) usernameField.value = '';
        if (passwordField) passwordField.value = '';
        showNotification('Logged out successfully', 'success');
      } catch (error) {
        showNotification('Logout failed: ' + error.message, 'error');
      }
    });
  }
}

// Add view-specific functionality
function addViewSpecificHandlers() {
  // Audit view
  const auditItem = document.querySelector('[data-view="audit-view"]');
  if (auditItem) {
    auditItem.addEventListener('click', () => {
      setTimeout(loadAuditLogs, 100);
    });
  }
  
  // Sync view
  const syncItem = document.querySelector('[data-view="sync-view"]');
  if (syncItem) {
    syncItem.addEventListener('click', () => {
      setTimeout(updateSyncStatus, 100);
    });
  }
}

// Registration functionality
function addRegistrationHandlers() {
  const showRegisterLink = $('#show-register-link');
  const showLoginLink = $('#show-login-link');
  const registerButton = $('#register-button');
  const loginView = $('#login-view');
  const registerView = $('#register-view');

  if (showRegisterLink) {
    showRegisterLink.addEventListener('click', (e) => {
      e.preventDefault();
      loginView.style.display = 'none';
      registerView.style.display = 'block';
    });
  }

  if (showLoginLink) {
    showLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      registerView.style.display = 'none';
      loginView.style.display = 'block';
    });
  }

  if (registerButton) {
    registerButton.addEventListener('click', async () => {
      const username = ($('#reg-username')?.value || '').trim();
      const password = ($('#reg-password')?.value || '').trim();
      const role = ($('#reg-role')?.value || 'user');
      const errorEl = $('#register-error');

      if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

      if (!username || !password) {
        if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = 'Enter username and password.'; }
        return;
      }

      registerButton.classList.add('loading');
      try {
        const result = await window.electronAPI.user.register({ username, password, role });
        if (result.success) {
          showNotification('Account created successfully! Please sign in.', 'success');
          registerView.style.display = 'none';
          loginView.style.display = 'block';
          // Clear form
          $('#reg-username').value = '';
          $('#reg-password').value = '';
        } else {
          if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = result.message; }
        }
      } catch (e) {
        console.error('Registration failed:', e);
        if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = e.message || 'Registration failed.'; }
      } finally {
        registerButton.classList.remove('loading');
      }
    });
  }
}

// Initialize app
function initializeApp() {
  addLogoutHandler();
  addViewSpecificHandlers();
  addRegistrationHandlers();
  updateSyncStatus();
}

// Initial state
showApp(false);
initializeApp();

