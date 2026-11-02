// All private workbench identifiers below are checked by the deployment script.
(() => {
    const execute = (id, ...args) => __WORKBENCH_COMMANDS__.executeCommand(id, ...args).catch(console.error);
    const { installInput } = __READER_INPUT__;
    const { installLayout } = __READER_LAYOUT__;
    const { readSettings } = __READER_SETTINGS__;
    const settingsKey = () => {
        const query = new URLSearchParams(location.search);
        return 'seia.editor.reader.v1:' + location.pathname + ':' + JSON.stringify([query.get('folder'), query.get('workspace')]);
    };
    function initialSettings() {
        let cached;
        try { cached = JSON.parse(localStorage.getItem(settingsKey()) || '{}'); } catch { /* Defaults also work without browser storage. */ }
        return readSettings({ get: (key, fallback) => cached && Object.hasOwn(cached, key) ? cached[key] : fallback });
    }
    let controller;
    __COMMAND_REGISTRY__.registerCommand('mobileReader.bootstrap', accessor => {
        if (controller) return;
        controller = createController(accessor);
        controller.configure(initialSettings(), false);
        console.debug('[Mobile Reader] layout initialized locally');
    });
    // The embedder API waits for the local workbench. It does not need the
    // remote extension host's onStartupFinished activation or its round trip.
    queueMicrotask(() => execute('mobileReader.bootstrap'));
    __COMMAND_REGISTRY__.registerCommand('mobileReader.configure', (accessor, config) => {
        controller ??= createController(accessor);
        return controller.configure(config);
    });
    function createController(accessor) {
        const editors = accessor.get(__CODE_EDITOR_SERVICE__);
        const editorService = accessor.get(__EDITOR_SERVICE__);
        const layout = accessor.get(__LAYOUT_SERVICE__);
        const quickInput = accessor.get(__QUICK_INPUT_SERVICE__);
        const workspace = accessor.get(__WORKSPACE_SERVICE__);
        const context = accessor.get(__CONTEXT_SERVICE__);
        const sourceVisible = context.createKey('mobileReader.sourceVisible', false);
        const editing = context.createKey('mobileReader.editing', false);
        const compactKey = context.createKey('mobileReader.compact', false);
        let config = {}, compact = false, media, input, chrome, pickerVisible = false, extensionReady = false;
        let menuItems = [], menuOrder;
        function rememberWorkspace() {
            const current = workspace.getWorkspace(), uri = current.configuration || current.folders[0]?.uri;
            window.seiaWorkspaceState?.remember(uri ? { kind: current.configuration ? 'workspace' : 'folder', path: uri.path } : null);
        }
        rememberWorkspace();
        workspace.onDidChangeWorkspaceFolders(rememberWorkspace);
        workspace.onDidChangeWorkbenchState(rememberWorkspace);
        workspace.onDidChangeWorkspaceName(rememberWorkspace);

        const actions = {
            hover: ['mobileReader.hover', '符号说明', 'info'],
            definition: ['mobileReader.definition', '转到定义', 'go-to-file'],
            symbols: ['mobileReader.symbols', '符号目录', 'symbol-method'],
            back: ['mobileReader.back', '后退', 'arrow-left'],
            edit: ['mobileReader.toggleEditing', '进入编辑', 'edit']
        };
        function updateMenus() {
            const order = [...new Set(config['toolbar.order'] || Object.keys(actions))].filter(key => actions[key]);
            if (JSON.stringify(order) === menuOrder) return;
            menuOrder = JSON.stringify(order); menuItems.forEach(item => item.dispose()); menuItems = [];
            const baseWhen = __CONTEXT_EXPR__.and(__CONTEXT_EXPR__.has('mobileReader.compact'), __CONTEXT_EXPR__.has('mobileReader.sourceVisible'));
            order.forEach((key, index) => {
                const [id, title, icon] = actions[key];
                const append = (label, glyph, when, commandId = id) => menuItems.push(__MENU_REGISTRY__.appendMenuItem(__MENU_ID__.EditorTitle, {
                    command: { id: commandId, title: label, icon: { id: glyph } }, group: 'navigation', order: -100 + index, when
                }));
                if (key === 'edit') {
                    append(title, icon, __CONTEXT_EXPR__.and(baseWhen, __CONTEXT_EXPR__.not('mobileReader.editing')));
                    append('结束编辑', 'check', __CONTEXT_EXPR__.and(baseWhen, __CONTEXT_EXPR__.has('mobileReader.editing')), 'mobileReader.finishEditing');
                } else append(title, icon, baseWhen);
            });
        }
        function updateContext() {
            sourceVisible.set(!!input?.active()); editing.set(input?.editing() === true);
        }

        const root = document.querySelector('.monaco-workbench');
        const cancel = document.createElement('button');
        cancel.id = 'mobile-reader-cancel'; cancel.type = 'button'; cancel.textContent = '取消';
        cancel.addEventListener('mousedown', event => event.preventDefault());
        cancel.addEventListener('click', () => quickInput.cancel(2));
        const backdrop = document.createElement('button');
        backdrop.id = 'mobile-reader-picker-backdrop'; backdrop.type = 'button'; backdrop.tabIndex = -1;
        backdrop.setAttribute('aria-label', '取消选择框');
        backdrop.addEventListener('mousedown', event => event.preventDefault());
        backdrop.addEventListener('click', () => quickInput.cancel(2)); root.append(backdrop);
        function updatePicker() {
            cancel.hidden = !(compact && pickerVisible);
            backdrop.hidden = !(compact && pickerVisible && config.dismissPickerOnOutsideTap);
            if (pickerVisible) document.querySelector('.quick-input-widget')?.append(cancel);
        }
        quickInput.onShow(() => { pickerVisible = true; requestAnimationFrame(updatePicker); });
        quickInput.onHide(() => { pickerVisible = false; updatePicker(); });

        function updateMode() {
            compact = config.mode === 'on' || (config.mode !== 'off' && media.matches);
            compactKey.set(compact);
            input ??= installInput({ editors, editorService, config: () => config, compact: () => compact, changed: updateContext });
            chrome ??= installLayout({ layout, config: () => config, compact: () => compact, execute });
            input.refresh(); chrome.refresh(); updateMenus(); updatePicker(); updateContext();
            if (extensionReady) execute('mobileReader.viewportChanged', compact);
        }
        return {
            configure(value, fromExtension = true) {
                const firstSync = fromExtension && !extensionReady;
                extensionReady ||= fromExtension;
                config = readSettings({ get: (key, fallback) => value && Object.hasOwn(value, key) ? value[key] : fallback });
                if (fromExtension) try { localStorage.setItem(settingsKey(), JSON.stringify(config)); } catch { /* Optional first-paint cache. */ }
                media?.removeEventListener('change', updateMode);
                const width = Math.max(320, Math.min(1400, Number(config.maxWidth) || 820));
                media = window.matchMedia(`(max-width: ${width}px) and (max-device-width: ${width}px) and (pointer: coarse)`);
                media.addEventListener('change', updateMode); updateMode();
                if (firstSync) console.debug('[Mobile Reader] remote settings synchronized');
                return compact;
            },
            toggle() { config = { ...config, mode: compact ? 'off' : 'on' }; updateMode(); },
            focus() { chrome?.close(); }, hover() { input?.hover(); }, toggleEditing() { input?.toggleEditing(); }, finishEditing() { input?.finishEditing(); }
        };
    }
    return [
        { id: 'mobileReader.focusBrowser', handler: () => controller?.focus() },
        { id: 'mobileReader.hoverBrowser', handler: () => controller?.hover() },
        { id: 'mobileReader.toggleEditing', handler: () => controller?.toggleEditing() },
        { id: 'mobileReader.finishEditing', handler: () => controller?.finishEditing() },
        { id: 'mobileReader.toggleCompact', handler: () => controller?.toggle() }
    ];
})()
