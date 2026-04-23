// App Drawer — persistent 56px navigation rail
// Fires CustomEvent('loom:navigate', { detail: { destination } }) on click.

const DESTINATIONS = ['calendar', 'tasks', 'focus', 'settings'];

const BTN_MAP = {
    calendar: 'drawer-calendar-btn',
    tasks:    'drawer-todos-btn',
    focus:    'drawer-focus-btn',
    settings: 'drawer-settings-btn',
};

function _setActive(destination) {
    DESTINATIONS.forEach(dest => {
        const btn = document.getElementById(BTN_MAP[dest]);
        if (!btn) return;
        btn.classList.toggle('active', dest === destination);
    });
}

export function initAppDrawer() {
    DESTINATIONS.forEach(dest => {
        const btn = document.getElementById(BTN_MAP[dest]);
        if (!btn) return;
        btn.addEventListener('click', () => {
            document.dispatchEvent(
                new CustomEvent('loom:navigate', { detail: { destination: dest } })
            );
        });
    });

    // Update active state when navigation happens
    document.addEventListener('loom:navigate', e => {
        _setActive(e.detail.destination);
    });

    // Restore last active destination from storage
    const saved = localStorage.getItem('loom:destination') ?? 'calendar';
    _setActive(saved);
}
