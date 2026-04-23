// Context Sidebar — 260px collapsible sidebar (collapses to 48px rail).
// Uses the same .app-layout.sidebar-hidden class that the rest of main.js already checks,
// so no other code needs to change for the toggle to work.

const STORAGE_KEY = 'loom:sidebar:collapsed';

function _isCollapsed() {
    return document.querySelector('.app-layout')?.classList.contains('sidebar-hidden') ?? false;
}

function _applyState(collapsed) {
    const layout = document.querySelector('.app-layout');
    const btn = document.getElementById('sidebar-toggle');
    if (!layout || !btn) return;
    if (collapsed) {
        layout.classList.add('sidebar-hidden');
        btn.setAttribute('data-collapsed', 'true');
        btn.title = 'Expand sidebar (B)';
    } else {
        layout.classList.remove('sidebar-hidden');
        btn.removeAttribute('data-collapsed');
        btn.title = 'Collapse sidebar (B)';
    }
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
}

export function toggle() {
    _applyState(!_isCollapsed());
}

export function expand() {
    _applyState(false);
}

export function initContextSidebar() {
    // Restore persisted state (support both old "loom-sidebar" key and new key)
    const legacyHidden = localStorage.getItem('loom-sidebar') === 'hidden';
    const newCollapsed = localStorage.getItem(STORAGE_KEY) === '1';
    _applyState(legacyHidden || newCollapsed);

    const btn = document.getElementById('sidebar-toggle');
    if (btn) {
        btn.addEventListener('click', () => toggle());
    }
}
