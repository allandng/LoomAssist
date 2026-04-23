// Top Bar — view switcher + date nav for the calendar destination.
// Fires CustomEvents that main.js listens for so this module stays decoupled
// from calendarInstance.

function _updateViewPills(activeView) {
    document.querySelectorAll('.view-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.view === activeView);
    });
}

export function setActiveView(view) {
    _updateViewPills(view);
}

export function initTopBar() {
    // View switcher pills
    document.querySelectorAll('.view-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const view = pill.dataset.view;
            document.dispatchEvent(
                new CustomEvent('loom:view-change', { detail: { view } })
            );
            _updateViewPills(view);
        });
    });

    // Date navigation buttons
    const handlers = {
        'cal-prev-btn':  'prev',
        'cal-today-btn': 'today',
        'cal-next-btn':  'next',
    };
    Object.entries(handlers).forEach(([id, action]) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                document.dispatchEvent(
                    new CustomEvent('loom:date-nav', { detail: { action } })
                );
            });
        }
    });

    // Show/hide view switcher + date nav based on active destination
    document.addEventListener('loom:navigate', e => {
        const isCalendar = e.detail.destination === 'calendar';
        const switcher = document.getElementById('view-switcher');
        const dateNav  = document.querySelector('.date-nav');
        if (switcher) switcher.style.display = isCalendar ? '' : 'none';
        if (dateNav)  dateNav.style.display  = isCalendar ? '' : 'none';
    });
}
