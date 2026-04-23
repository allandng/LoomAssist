// ==========================================
// NOTIFICATION STORE
// ==========================================

let _notifications = [];
let _subscribers = [];

function _generateId() {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _notify() {
  const snap = getNotifications();
  _subscribers.forEach(cb => cb(snap));
}

export function addNotification(notif) {
  const id = notif.id || _generateId();
  const full = {
    id,
    type:         notif.type         ?? 'info',
    title:        notif.title        ?? '',
    message:      notif.message      ?? '',
    timestamp:    notif.timestamp    ?? new Date().toISOString(),
    read:         notif.read         ?? false,
    dismissible:  notif.dismissible  ?? true,
    actionable:   notif.actionable   ?? false,
    actionLabel:  notif.actionLabel  ?? null,
    actionFn:     notif.actionFn     ?? null,
    progress:     notif.progress     ?? null,
    autoRemoveMs: notif.autoRemoveMs ?? null,
  };
  _notifications.unshift(full);
  _notify();
  if (full.autoRemoveMs) {
    setTimeout(() => dismissNotification(id), full.autoRemoveMs);
  }
  return id;
}

export function updateNotification(id, patches) {
  const idx = _notifications.findIndex(n => n.id === id);
  if (idx === -1) return;
  _notifications[idx] = { ..._notifications[idx], ...patches };
  _notify();
  const updated = _notifications.find(n => n.id === id);
  if (updated?.autoRemoveMs && patches.autoRemoveMs) {
    setTimeout(() => dismissNotification(id), patches.autoRemoveMs);
  }
}

export function dismissNotification(id) {
  _notifications = _notifications.filter(n => n.id !== id);
  _notify();
}

export function clearAllNotifications() {
  _notifications = [];
  _notify();
}

export function getNotifications() {
  return [..._notifications].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export function getUnreadCount() {
  return _notifications.filter(n => !n.read).length;
}

export function subscribeToChanges(callback) {
  _subscribers.push(callback);
  return () => { _subscribers = _subscribers.filter(s => s !== callback); };
}

// ==========================================
// RENDERER (private)
// ==========================================

const TYPE_COLORS = {
  info:     '#6366f1',
  success:  '#10b981',
  warning:  '#D97706',
  error:    '#ef4444',
  progress: '#3b82f6',
};

function _formatTs(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function _renderCard(notif) {
  const card = document.createElement('div');
  card.className = 'notif-card' + (notif.actionable ? ' notif-card--actionable' : '');
  card.dataset.id = notif.id;
  card.style.setProperty('--notif-color', TYPE_COLORS[notif.type] ?? TYPE_COLORS.info);
  if (notif.actionable) {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', notif.title);
  } else {
    card.setAttribute('role', 'listitem');
  }

  // Header row: title + dismiss button
  const header = document.createElement('div');
  header.className = 'notif-card__header';

  const titleEl = document.createElement('span');
  titleEl.className = 'notif-card__title';
  titleEl.textContent = notif.title;
  header.appendChild(titleEl);

  if (notif.dismissible) {
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'notif-card__dismiss';
    dismissBtn.textContent = '✓';
    dismissBtn.title = 'Dismiss';
    dismissBtn.setAttribute('aria-label', `Dismiss: ${notif.title}`);
    dismissBtn.addEventListener('click', e => {
      e.stopPropagation();
      dismissNotification(notif.id);
    });
    header.appendChild(dismissBtn);
  }
  card.appendChild(header);

  // Message
  if (notif.message) {
    const msgEl = document.createElement('p');
    msgEl.className = 'notif-card__message';
    msgEl.textContent = notif.message;
    card.appendChild(msgEl);
  }

  // Progress bar
  if (notif.type === 'progress' && notif.progress !== null) {
    const track = document.createElement('div');
    track.className = 'notif-progressbar';
    const fill = document.createElement('div');
    fill.className = 'notif-progressbar__fill' +
      (notif.progress < 100 ? ' notif-progressbar__fill--shimmer' : '');
    fill.style.width = `${notif.progress}%`;
    track.appendChild(fill);
    card.appendChild(track);
  }

  // Action label
  if (notif.actionable && notif.actionLabel) {
    const actionEl = document.createElement('span');
    actionEl.className = 'notif-card__action-label';
    actionEl.textContent = notif.actionLabel;
    card.appendChild(actionEl);
  }

  // Timestamp
  const tsEl = document.createElement('span');
  tsEl.className = 'notif-card__ts';
  tsEl.textContent = _formatTs(notif.timestamp);
  card.appendChild(tsEl);

  // Click / keyboard for actionable cards
  if (notif.actionable && notif.actionFn) {
    const fire = () => {
      updateNotification(notif.id, { read: true });
      notif.actionFn();
    };
    card.addEventListener('click', fire);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
    });
  }

  return card;
}

function _renderPanel(notifications) {
  const list = document.getElementById('notif-list');
  if (!list) return;
  list.innerHTML = '';

  if (notifications.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = "You're all caught up ✓";
    list.appendChild(empty);
    return;
  }

  notifications.forEach(n => list.appendChild(_renderCard(n)));
}

function _updateBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count === 0) {
    badge.classList.add('hidden');
    badge.textContent = '';
  } else {
    badge.classList.remove('hidden');
    badge.textContent = count > 9 ? '9+' : String(count);
  }
}

function _positionPanel(panel, _bellBtn) {
  // v2.0: anchor below the 56px top bar + 8px gap at the right edge
  panel.style.top   = '64px';
  panel.style.right = '16px';
}

function _openPanel(panel, bellBtn) {
  panel.classList.remove('hidden');
  bellBtn.setAttribute('aria-expanded', 'true');
  _positionPanel(panel, bellBtn);
  getNotifications().forEach(n => { if (!n.read) updateNotification(n.id, { read: true }); });
  const first = panel.querySelector('button, [tabindex="0"]');
  if (first) first.focus();
}

function _closePanel(panel, bellBtn) {
  panel.classList.add('hidden');
  bellBtn.setAttribute('aria-expanded', 'false');
  bellBtn.focus();
}

// ==========================================
// INIT (exported)
// ==========================================

export function initNotifications() {
  const header = document.querySelector('header.top-bar');
  if (!header) return;

  // Bell wrapper
  const bellWrapper = document.createElement('div');
  bellWrapper.className = 'notif-bell-wrapper';

  const bellBtn = document.createElement('button');
  bellBtn.id = 'notif-bell-btn';
  bellBtn.className = 'icon-btn notif-bell-btn';
  bellBtn.setAttribute('aria-label', 'Notifications');
  bellBtn.setAttribute('aria-haspopup', 'true');
  bellBtn.setAttribute('aria-expanded', 'false');
  bellBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>`;

  const badge = document.createElement('span');
  badge.id = 'notif-badge';
  badge.className = 'notif-badge hidden';
  badge.setAttribute('aria-live', 'polite');

  bellWrapper.appendChild(bellBtn);
  bellWrapper.appendChild(badge);
  header.appendChild(bellWrapper);

  // Notification panel (fixed, appended to body)
  const panel = document.createElement('div');
  panel.id = 'notif-panel';
  panel.className = 'notif-panel hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notifications');

  const panelHeader = document.createElement('div');
  panelHeader.className = 'notif-panel__header';

  const panelTitle = document.createElement('span');
  panelTitle.className = 'notif-panel__title';
  panelTitle.textContent = 'Notifications';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'notif-panel__clear-btn';
  clearBtn.textContent = 'Clear all';
  clearBtn.addEventListener('click', clearAllNotifications);

  panelHeader.appendChild(panelTitle);
  panelHeader.appendChild(clearBtn);

  const list = document.createElement('div');
  list.id = 'notif-list';
  list.className = 'notif-list';
  list.setAttribute('role', 'list');

  panel.appendChild(panelHeader);
  panel.appendChild(list);
  document.body.appendChild(panel);

  // Bell toggle
  bellBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (panel.classList.contains('hidden')) {
      _openPanel(panel, bellBtn);
    } else {
      _closePanel(panel, bellBtn);
    }
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!panel.classList.contains('hidden') &&
        !panel.contains(e.target) &&
        e.target !== bellBtn) {
      _closePanel(panel, bellBtn);
    }
  });

  // Escape closes panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
      _closePanel(panel, bellBtn);
    }
  });

  // Tab trap within panel
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      panel.querySelectorAll('button, [tabindex="0"]')
    ).filter(el => !el.disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  });

  // Re-render on store changes
  subscribeToChanges(notifications => {
    _renderPanel(notifications);
    _updateBadge(getUnreadCount());
  });

  // Initial render
  _renderPanel([]);
  _updateBadge(0);
}
