import './styles/main.css';

console.log('👋 This message is being logged by "renderer.js", included via webpack');


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

