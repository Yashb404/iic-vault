import './styles/main.css';



// DOM element references
// Dashboard elements
const sidebarItems = document.querySelectorAll('#app-sidebar .sidebar-item');
const appViews = document.querySelectorAll('#main-content .app-view');
const goToVaultBtn = document.querySelector('[data-view-target="vault-view"]');
const addFilePlus = document.getElementById('add-file-plus');
const addFileModal = document.getElementById('add-file-modal');
const addFileClose = document.getElementById('add-file-close');
const addFileBackdrop = addFileModal ? addFileModal.querySelector('.modal-backdrop') : null;
const dashUploadButton = document.getElementById('dash-upload-file');
// Header popovers
const headerSyncBtn = document.getElementById('header-sync');
const notifyBtn = document.getElementById('notify-btn');
const avatarBtn = document.getElementById('avatar-btn');
const syncPopover = document.getElementById('sync-popover');
const notifyPopover = document.getElementById('notify-popover');
const accountPopover = document.getElementById('account-popover');
const syncNowTop = document.getElementById('sync-now-top');

// Initial event listeners
// View switching
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

  // Update header title based on active view
  const titleEl = document.querySelector('#app-header .app-title');
  if (titleEl) {
    if (viewId === 'dashboard-view') titleEl.textContent = 'Security Dashboard';
    else if (viewId === 'vault-view') titleEl.textContent = 'Document Management';
    else if (viewId === 'sync-view') titleEl.textContent = 'Synchronization';
    else if (viewId === 'audit-view') titleEl.textContent = 'Audit Log';
    else if (viewId === 'settings-view') titleEl.textContent = 'Settings';
  }
}

if (sidebarItems && sidebarItems.length) {
  sidebarItems.forEach((item) => {
    item.addEventListener('click', () => {
      // Active state
      sidebarItems.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      const target = item.getAttribute('data-view');
      if (target) showView(target);
    });
  });
}

if (goToVaultBtn) {
  goToVaultBtn.addEventListener('click', () => {
    // simulate clicking the sidebar
    const vaultItem = Array.from(sidebarItems).find((i) => i.getAttribute('data-view') === 'vault-view');
    if (vaultItem) vaultItem.click();
  });
}

// Add File modal
if (addFilePlus && addFileModal) {
  addFilePlus.addEventListener('click', () => {
    addFileModal.style.display = 'block';
  });
}

// Close handlers for the Add File modal (works from any view)
if (addFileModal && addFileClose) {
  addFileClose.addEventListener('click', () => {
    addFileModal.style.display = 'none';
  });
}
if (addFileModal && addFileBackdrop) {
  addFileBackdrop.addEventListener('click', () => {
    addFileModal.style.display = 'none';
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && addFileModal && addFileModal.style.display === 'block') {
    addFileModal.style.display = 'none';
  }
});

if (dashUploadButton && addFileModal) {
  dashUploadButton.addEventListener('click', () => {
    addFileModal.style.display = 'block';
  });
}

// Simple popover toggles
function togglePopover(btn, pop) {
  if (!btn || !pop) return;
  const isOpen = pop.style.display === 'block';
  pop.style.display = isOpen ? 'none' : 'block';
  btn.setAttribute('aria-expanded', String(!isOpen));
}

if (headerSyncBtn && syncPopover) headerSyncBtn.addEventListener('click', () => {
  togglePopover(headerSyncBtn, syncPopover);
  if (notifyPopover) notifyPopover.style.display = 'none';
  if (accountPopover) accountPopover.style.display = 'none';
});
if (notifyBtn && notifyPopover) notifyBtn.addEventListener('click', () => {
  togglePopover(notifyBtn, notifyPopover);
  if (syncPopover) syncPopover.style.display = 'none';
  if (accountPopover) accountPopover.style.display = 'none';
});
if (avatarBtn && accountPopover) avatarBtn.addEventListener('click', () => {
  togglePopover(avatarBtn, accountPopover);
  if (syncPopover) syncPopover.style.display = 'none';
  if (notifyPopover) notifyPopover.style.display = 'none';
});

if (syncNowTop) syncNowTop.addEventListener('click', () => {
  console.log('Top Sync Now clicked');
});

// Sync status utilities
function setSyncStatus(online) {
  const indicator = document.getElementById('sync-status-indicator');
  if (!indicator) return;
  if (online) {
    indicator.textContent = 'Online';
  } else {
    indicator.textContent = 'Offline';
  }
}

function updateSyncQueue(uploadCount, downloadCount) {
  const up = document.getElementById('files-to-upload');
  const down = document.getElementById('files-to-download');
  if (up) up.textContent = `Files to upload: ${uploadCount}`;
  if (down) down.textContent = `Files to download: ${downloadCount}`;
}

// Global security status
function setGlobalStatus(level) {
  const badge = document.getElementById('global-status');
  if (!badge) return;
  if (level === 'warning') {
    badge.textContent = '';
    badge.title = 'Potential issue detected';
  } else if (level === 'error') {
    badge.textContent = '';
    badge.title = 'Vault at risk';
  } else {
    badge.textContent = '';
    badge.title = 'Vault Secured';
  }
}

// Recent activity click logging
document.addEventListener('click', (e) => {
  const target = e.target;
  if (target && target.classList && target.classList.contains('recent-file')) {
    e.preventDefault();
    const file = target.getAttribute('data-file');
    console.log('Recent file clicked:', file);
  }
});

// Remove legacy add file button logic (handled by modal now)

document.addEventListener('DOMContentLoaded', () => {
  const $ = (sel) => document.querySelector(sel);

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

  async function loadFiles() {
    try {
      const files = await window.ipcRenderer.invoke('files:get');
      const tbody = document.querySelector('.file-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      (files || []).forEach((f) => {
        const tr = document.createElement('tr');
        const d = f.lastModifiedUTC ? new Date(f.lastModifiedUTC).toISOString().slice(0,10) : '';
        tr.innerHTML = `<td>${f.originalName || ''}</td><td>${d}</td><td>${f.size || ''}</td><td>Synced</td>`;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error('loadFiles failed:', e);
    }
  }

  // Initial: show login screen only
  showApp(false);

  const loginBtn = document.getElementById('login-button');
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

  // Existing sidebar/view-switch logic can remain as is
});

