function installLayout({ layout, config, compact, execute }) {
    const root = document.querySelector('.monaco-workbench');
    const parts = ['workbench.parts.activitybar', 'workbench.parts.sidebar', 'workbench.parts.auxiliarybar'];
    const bars = new Map();
    let frame, previousLayout, wasCompact = false;
    const button = document.createElement('button');
    button.id = 'mobile-reader-sidebar-toggle'; button.type = 'button';
    button.className = 'codicon codicon-layout-sidebar-left';
    button.title = '显示或收起侧栏'; button.setAttribute('aria-label', button.title);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
        const open = layout.isVisible(parts[1]) || layout.isVisible(parts[0]);
        if (open) close();
        else {
            layout.setPartHidden(false, parts[0]); layout.setPartHidden(false, parts[1]);
            // Native sidebar retains the selected Explorer/Search/Source Control view.
        }
        updateBackdrop();
    });
    const backdrop = document.createElement('button');
    backdrop.id = 'mobile-reader-sidebar-backdrop'; backdrop.type = 'button'; backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', '收起侧栏');
    backdrop.addEventListener('mousedown', event => event.preventDefault());
    backdrop.addEventListener('click', close);
    root.append(backdrop);
    function close() {
        if (!compact()) return;
        for (const part of parts) layout.setPartHidden(true, part);
        updateBackdrop();
    }
    function updateBackdrop() {
        const open = compact() && (layout.isVisible(parts[0]) || layout.isVisible(parts[1]));
        button.setAttribute('aria-expanded', String(open));
        backdrop.hidden = !open;
        if (open) {
            const side = document.querySelector('.part.sidebar').getBoundingClientRect();
            const activity = document.querySelector('.part.activitybar').getBoundingClientRect();
            const top = document.querySelector('.part.titlebar').getBoundingClientRect().bottom;
            const bottom = document.querySelector('.part.statusbar').getBoundingClientRect().top;
            Object.assign(backdrop.style, { left: Math.max(side.right, activity.right) + 'px', top: top + 'px',
                right: '0', height: Math.max(0, bottom - top) + 'px' });
        }
    }
    function sizeBar(bar, record, requested) {
        const settings = config();
        const width = bar.closest('.editor-group-container')?.getBoundingClientRect().width || window.innerWidth;
        const minimum = settings['toolbar.buttonSize'];
        const maximum = Math.max(minimum, Math.min(width * settings['toolbar.maxWidthPercent'] / 100, width - 96));
        const desired = requested ?? record.customWidth ?? settings['toolbar.visibleActions'] * minimum;
        const actual = Math.max(minimum, Math.min(maximum, desired));
        bar.style.setProperty('--reader-actions-width', actual + 'px');
        record.sash.setAttribute('aria-valuemin', String(Math.round(minimum)));
        record.sash.setAttribute('aria-valuemax', String(Math.round(maximum)));
        record.sash.setAttribute('aria-valuenow', String(Math.round(actual)));
        record.sash.hidden = !compact() || !settings['toolbar.resizable'];
        return actual;
    }
    function decorate() {
        frame = null;
        // Keep the one drawer button in the existing titlebar, beside navigation.
        const title = root.querySelector('.part.titlebar .titlebar-left');
        if (title && !button.isConnected) title.prepend(button);
        button.hidden = !compact();
        for (const bar of root.querySelectorAll('.part.editor .editor-group-container > .title .editor-actions')) {
            let record = bars.get(bar);
            if (!record) {
                const sash = document.createElement('div');
                sash.className = 'mobile-reader-action-sash'; sash.tabIndex = 0;
                sash.setAttribute('role', 'separator'); sash.setAttribute('aria-orientation', 'vertical');
                sash.setAttribute('aria-label', '调整选项卡与操作按钮的宽度');
                record = { sash }; bars.set(bar, record); bar.prepend(sash);
                // Monaco's action items consume native touch gestures, so CSS
                // overflow alone cannot scroll this strip. Own only its drag;
                // ordinary taps still reach the original action controls.
                let swipe, suppressTapUntil = 0;
                bar.addEventListener('pointerdown', event => {
                    if (!compact() || !event.isPrimary || event.button !== 0 || event.target.closest('.mobile-reader-action-sash')) return;
                    const viewport = bar.querySelector(':scope > .monaco-toolbar');
                    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return;
                    suppressTapUntil = 0;
                    swipe = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, viewport, moved: false };
                }, true);
                bar.addEventListener('pointermove', event => {
                    if (!swipe || swipe.pointer !== event.pointerId) return;
                    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
                    if (!swipe.moved && (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy))) return;
                    swipe.moved = true;
                    bar.setPointerCapture(event.pointerId);
                    swipe.viewport.scrollLeft = swipe.left - dx;
                    event.preventDefault(); event.stopImmediatePropagation();
                }, true);
                const finishSwipe = event => {
                    if (!swipe || swipe.pointer !== event.pointerId) return;
                    if (swipe.moved) {
                        suppressTapUntil = performance.now() + 500;
                        event.preventDefault(); event.stopImmediatePropagation();
                    }
                    swipe = null;
                };
                bar.addEventListener('pointerup', finishSwipe, true);
                bar.addEventListener('pointercancel', finishSwipe, true);
                for (const type of ['click', '-monaco-gesturetap']) bar.addEventListener(type, event => {
                    if (compact() && (swipe?.moved || performance.now() < suppressTapUntil)) {
                        event.preventDefault(); event.stopImmediatePropagation();
                    }
                }, true);
                let drag;
                sash.addEventListener('pointerdown', event => {
                    drag = { x: event.clientX, width: sizeBar(bar, record) };
                    sash.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation();
                });
                sash.addEventListener('pointermove', event => {
                    if (!drag) return;
                    record.customWidth = sizeBar(bar, record, drag.width + drag.x - event.clientX);
                });
                const stop = () => { drag = null; };
                sash.addEventListener('pointerup', stop); sash.addEventListener('pointercancel', stop);
                sash.addEventListener('dblclick', () => { record.customWidth = undefined; sizeBar(bar, record); });
                sash.addEventListener('keydown', event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
                    event.preventDefault();
                    record.customWidth = event.key === 'Home' ? undefined : sizeBar(bar, record) + (event.key === 'ArrowLeft' ? 1 : -1) * config()['toolbar.buttonSize'];
                    sizeBar(bar, record);
                });
            }
            // Native menus can rebuild the toolbar; retain just our resize handle.
            if (!record.sash.isConnected) bar.prepend(record.sash);
            sizeBar(bar, record);
        }
        for (const [bar, record] of bars) if (!bar.isConnected) { record.sash.remove(); bars.delete(bar); }
        updateBackdrop();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(decorate); }
    new MutationObserver(schedule).observe(root, { subtree: true, childList: true });
    window.addEventListener('resize', schedule);
    layout.onDidChangePartVisibility?.(schedule);
    // Native buttons outside the sidebar retain their action while closing it.
    document.addEventListener('pointerdown', event => {
        if (!compact() || backdrop.hidden || event.target === backdrop) return;
        if (event.target.closest('.part.sidebar, .part.activitybar, #mobile-reader-sidebar-toggle, .quick-input-widget, .monaco-dialog-box, .context-view')) return;
        close();
    }, true);
    return {
        close,
        refresh() {
            root.classList.toggle('mobile-reader-compact', compact());
            root.style.setProperty('--reader-button-size', config()['toolbar.buttonSize'] + 'px');
            root.style.setProperty('--reader-hover-opacity', String(config()['hover.highlightOpacity']));
            if (compact() !== wasCompact) {
                if (compact()) {
                    previousLayout = parts.map(part => layout.isVisible(part));
                    close();
                } else if (previousLayout) {
                    parts.forEach((part, i) => layout.setPartHidden(!previousLayout[i], part));
                }
                wasCompact = compact();
            }
            decorate();
        }
    };
}
module.exports = { installLayout };
