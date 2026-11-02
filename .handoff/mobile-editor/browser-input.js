// Kept independent of the workbench bootstrap so keyboard transitions can be
// checked without starting a browser or duplicating Monaco's gesture machinery.
class EditingSession {
    editing = false;
    keyboardSeen = false;
    enter() { this.editing = true; this.keyboardSeen = false; }
    reset() { this.editing = false; this.keyboardSeen = false; }
    keyboard(visible) {
        if (visible && this.editing) this.keyboardSeen = true;
        if (!visible && this.keyboardSeen) this.reset();
    }
}

function installInput({ editors, editorService, config, compact, changed }) {
    const records = new Map();
    const geometryKeys = ['lineNumbersMinChars', 'lineDecorationsWidth', 'glyphMargin', 'folding', 'minimap'];
    const optionKeys = [...geometryKeys, 'editContext'];
    const visible = editor => editor?.getDomNode()?.getClientRects().length > 0;
    const active = () => {
        return [editors.getFocusedCodeEditor(), editors.getActiveCodeEditor()]
            .find(editor => records.has(editor) && visible(editor)) || null;
    };
    const isReading = record => compact() && config().readOnlyByDefault && !record.session.editing;
    const rawSnapshot = editor => Object.fromEntries(optionKeys.map(key => [key, editor.getRawOptions()[key]]));
    function sync(editor, record) {
        if (record.applying) return;
        record.applying = true;
        try {
            const settings = config(), reading = isReading(record);
            const options = { ...record.original };
            if (compact()) {
                // Use one input backend for the entire compact session. Switching
                // EditContext on each tap used to replace the focused DOM input.
                options.editContext = false;
                if (settings.compactGutter) Object.assign(options, {
                    lineNumbersMinChars: settings['gutter.lineNumberCharacters'],
                    lineDecorationsWidth: settings['gutter.decorationWidth'],
                    glyphMargin: settings['gutter.glyphMargin'], folding: settings['gutter.folding'],
                    minimap: { ...record.original.minimap, enabled: settings['gutter.minimap'] }
                });
            }
            // Never override readOnly: the workbench owns that input capability.
            editor.updateOptions(options);
            record.applied = rawSnapshot(editor);
            const node = editor.getDomNode();
            node?.classList.toggle('mobile-reader-reading', reading);
            const input = node?.querySelector('textarea.inputarea');
            if (input) {
                // Monaco only honors domReadOnly when its readOnly option is also
                // true. Inert gates DOM focus independently of file capabilities,
                // and Monaco does not rewrite it during selection/IME updates.
                input.inert = reading;
                if (reading) input.setAttribute('inputmode', 'none');
                else input.removeAttribute('inputmode');
            }
        } finally { record.applying = false; }
    }
    function clearTap(record) {
        clearTimeout(record.hoverTimer); record.lastTap = null;
    }
    function leave(editor, record) {
        clearTap(record); record.session.reset(); sync(editor, record);
        const focused = document.activeElement;
        if (editor.getDomNode()?.contains(focused) && focused.matches('textarea.inputarea, .native-edit-context')) focused.blur();
        changed();
    }
    function enter(editor, record) {
        if (!editor.getModel() || editor.getRawOptions().readOnly) return;
        clearTap(record); record.session.enter(); record.session.keyboard(keyboardOpen); sync(editor, record);
        editor.focus();
        // Called synchronously from a real tap/button, preserving user activation.
        try { navigator.virtualKeyboard?.show(); } catch { /* Ordinary focus remains the fallback. */ }
        changed();
    }
    function hover(editor = active()) {
        if (editor?.getModel()) void editor.getAction('editor.action.showHover')?.run({ focus: 'noAutoFocus' });
    }
    function tap(editor, record, x, y, time) {
        const position = editor.getTargetAtClientPoint(x, y)?.position;
        if (!position) return;
        const settings = config(), last = record.lastTap;
        editor.setPosition(position);
        clearTap(record);
        if (settings.doubleTapToEdit && last && time - last.time <= settings['gestures.doubleTapInterval']
            && Math.hypot(x - last.x, y - last.y) <= settings['gestures.doubleTapDistance']) {
            enter(editor, record); return;
        }
        record.lastTap = { x, y, time };
        if (settings.tapToHover && editor.getModel()?.getWordAtPosition(position)) {
            const model = editor.getModel();
            const delay = settings['gestures.hoverDelay'] ?? (settings.doubleTapToEdit ? settings['gestures.doubleTapInterval'] + 10 : 0);
            record.hoverTimer = setTimeout(() => {
                if (isReading(record) && editor.getModel() === model && visible(editor)) hover(editor);
            }, delay);
        }
    }
    function attach(editor) {
        const node = editor.getDomNode();
        if (!node?.closest('.part.editor') || editor.getRawOptions().isSimpleWidget) return;
        const previous = records.get(editor);
        if (previous?.node === node) return;
        // VS Code can keep the editor instance while rebuilding its DOM when
        // switching between a webview and source. Rebind to the current view,
        // preserving the original options rather than snapshotting our overrides.
        previous?.subscriptions.forEach(item => item.dispose());
        const record = { node, original: previous?.original || rawSnapshot(editor), session: new EditingSession(), subscriptions: [], applying: false };
        records.set(editor, record);
        const listen = (type, listener, options = true) => {
            node.addEventListener(type, listener, options);
            record.subscriptions.push({ dispose: () => node.removeEventListener(type, listener, options) });
        };
        const isCode = target => target instanceof Element && !!target.closest('.lines-content, .view-lines, textarea.inputarea')
            && !target.closest('.contentWidgets, .overlayWidgets, .monaco-hover');
        let start, lastTouch = -Infinity;
        listen('pointerdown', event => {
            if (!isReading(record) || !event.isPrimary || !isCode(event.target)) return;
            if (event.pointerType === 'touch') lastTouch = performance.now();
            start = { x: event.clientX, y: event.clientY, time: performance.now(), moved: false, pointer: event.pointerType };
        });
        listen('pointermove', event => {
            if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > config()['gestures.moveTolerance']) {
                start.moved = true; clearTap(record);
            }
        });
        listen('pointercancel', () => { if (start) start.moved = true; clearTap(record); });
        listen('pointerup', event => {
            if (!isReading(record) || !start || start.pointer === 'touch') return;
            const gesture = start; start = null;
            if (!gesture.moved && performance.now() - gesture.time <= config()['gestures.longPressThreshold']) {
                tap(editor, record, event.clientX, event.clientY, performance.now());
            }
        });
        // Android's Monaco handler focuses the textarea from this synthetic event,
        // after pointerup. Intercept the tap, not raw touchmove: native scrolling
        // and its inertia keep working, and no parallel scrolling implementation is needed.
        listen('-monaco-gesturetap', event => {
            if (!isReading(record) || !isCode(event.target)) return;
            event.preventDefault(); event.stopImmediatePropagation();
            lastTouch = performance.now();
            if (start?.moved || (start && performance.now() - start.time > config()['gestures.longPressThreshold'])) return;
            tap(editor, record, event.pageX - window.scrollX, event.pageY - window.scrollY, performance.now());
            start = null;
        });
        listen('-monaco-gesturechange', () => { clearTap(record); });
        // Suppress compatibility mouse events and native mouse-focus in reading mode.
        for (const type of ['mousedown', 'click']) listen(type, event => {
            if (isCode(event.target) && (isReading(record) || performance.now() - lastTouch < 500)) {
                event.preventDefault(); event.stopImmediatePropagation();
            }
        });
        listen('dblclick', event => {
            if (!isReading(record) || !isCode(event.target)) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (config().doubleTapToEdit) enter(editor, record);
        });
        listen('focusin', event => {
            if (isReading(record) && event.target.matches('textarea.inputarea, .native-edit-context')) event.target.blur();
        });
        listen('focusout', () => queueMicrotask(() => {
            if (document.activeElement?.closest('.editor-actions')) return;
            if (record.session.editing && !node.contains(document.activeElement)) leave(editor, record);
        }));
        record.subscriptions.push(editor.onDidChangeModel(() => {
            start = null; leave(editor, record);
            queueMicrotask(() => sync(editor, record));
        }));
        record.subscriptions.push(editor.onDidChangeConfiguration(() => {
            if (record.applying) return;
            const raw = rawSnapshot(editor);
            for (const key of optionKeys) {
                if (JSON.stringify(raw[key]) !== JSON.stringify(record.applied?.[key])) record.original[key] = raw[key];
            }
            sync(editor, record);
        }));
        record.subscriptions.push({ dispose: () => clearTap(record) });
        let knownInput = node.querySelector('textarea.inputarea');
        const inputObserver = new MutationObserver(() => {
            const next = node.querySelector('textarea.inputarea');
            if (next === knownInput) return;
            knownInput = next;
            if (next) {
                next.inert = isReading(record);
                if (isReading(record)) next.setAttribute('inputmode', 'none');
            }
        });
        inputObserver.observe(node, { childList: true, subtree: true });
        record.subscriptions.push({ dispose: () => inputObserver.disconnect() });
        sync(editor, record);
    }
    const attachAll = () => editors.listCodeEditors().forEach(attach);
    editors.onCodeEditorAdd(() => requestAnimationFrame(attachAll));
    editors.onCodeEditorRemove(editor => {
        records.get(editor)?.subscriptions.forEach(item => item.dispose()); records.delete(editor); changed();
    });
    editorService.onDidActiveEditorChange(() => {
        attachAll();
        for (const [editor, record] of records) leave(editor, record);
        requestAnimationFrame(() => { attachAll(); changed(); });
    });
    // Attach before a newly created editor can receive its first native focus.
    document.addEventListener('focusin', event => {
        if (!(event.target instanceof Element) || !event.target.matches('textarea.inputarea, .native-edit-context')) return;
        attachAll();
        for (const [editor, record] of records) {
            if (editor.getDomNode()?.contains(event.target) && isReading(record)) event.target.blur();
        }
    }, true);
    attachAll();

    let keyboardOpen = false, nativeKeyboardObserved = false, closeTimer;
    let viewportWidth = window.innerWidth, viewportBaseline = window.innerHeight;
    function keyboard(visible) {
        if (!compact()) return;
        keyboardOpen = visible;
        const focused = document.activeElement;
        for (const [editor, record] of records) {
            const ownsInput = editor.getDomNode()?.contains(focused) && focused?.matches('textarea.inputarea');
            if (visible && ownsInput && !editor.getRawOptions().readOnly && !record.session.editing) {
                record.session.enter(); sync(editor, record);
            }
            record.session.keyboard(visible && (ownsInput || record.session.keyboardSeen));
            if (!visible && !record.session.editing && isReading(record)) leave(editor, record);
        }
        changed();
    }
    navigator.virtualKeyboard?.addEventListener('geometrychange', () => {
        const height = navigator.virtualKeyboard.boundingRect.height;
        if (height > 0) nativeKeyboardObserved = true;
        if (nativeKeyboardObserved) { clearTimeout(closeTimer); keyboard(height > 0); }
    });
    function observeViewport() {
        const viewport = window.visualViewport;
        if (!viewport || !compact() || nativeKeyboardObserved || Math.abs(viewport.scale - 1) > .05) return;
        if (Math.abs(window.innerWidth - viewportWidth) > 80) {
            viewportWidth = window.innerWidth; viewportBaseline = window.innerHeight;
            if (keyboardOpen) keyboard(false);
            return;
        }
        const anyEditing = [...records.values()].some(record => record.session.editing);
        if (!anyEditing && !keyboardOpen) viewportBaseline = window.innerHeight;
        const occlusion = Math.max(window.innerHeight, viewportBaseline) - viewport.height;
        clearTimeout(closeTimer);
        if (occlusion > config()['gestures.keyboardThreshold']) keyboard(true);
        else if (keyboardOpen) closeTimer = setTimeout(() => keyboard(false), 120);
    }
    window.visualViewport?.addEventListener('resize', observeViewport);
    window.addEventListener('resize', observeViewport);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) for (const [editor, record] of records) leave(editor, record);
    });
    return {
        active, hover,
        editing: () => records.get(active())?.session.editing === true,
        toggleEditing() {
            const editor = active(), record = records.get(editor);
            if (record) record.session.editing ? leave(editor, record) : enter(editor, record);
        },
        finishEditing() {
            const editor = active(), record = records.get(editor);
            if (record) leave(editor, record);
        },
        refresh() {
            attachAll();
            for (const [editor, record] of records) {
                if (!compact()) record.session.reset();
                sync(editor, record);
            }
        }
    };
}

module.exports = { EditingSession, installInput };
