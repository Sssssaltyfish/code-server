const vscode = require('vscode');
const { readSettings, markdownStyle } = require('./settings');

function activate(context) {
    let compact = null;
    const register = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
    const focus = () => vscode.commands.executeCommand('mobileReader.focusBrowser');
    register('mobileReader.focus', focus);
    register('mobileReader.files', () => vscode.commands.executeCommand('workbench.view.explorer'));
    const tabKey = () => {
        const group = vscode.window.tabGroups.activeTabGroup, tab = group.activeTab;
        return JSON.stringify([group.viewColumn, tab?.input?.uri?.toString() || tab?.input?.modified?.toString() || tab?.label, tab?.input?.viewType]);
    };
    let previousTab = tabKey();
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => {
        const next = tabKey();
        if (next === previousTab) return;
        previousTab = next;
        if (compact && vscode.workspace.getConfiguration('mobileReader').get('autoHideSidebar')) void focus();
    }));
    const setDevice = async (value) => {
        const previous = compact;
        compact = value === true;
        if (previous !== compact) void vscode.commands.executeCommand('markdown.preview.refresh');
    };
    register('mobileReader.viewportChanged', setDevice);
    // Missing bridge (e.g. after an upstream upgrade) defaults to the standard desktop UI.
    const configure = () => {
        const settings = readSettings(vscode.workspace.getConfiguration('mobileReader'));
        return vscode.commands.executeCommand('mobileReader.configure', settings)
            .then(setDevice, error => { console.error('Mobile Reader bridge:', error); return setDevice(false); });
    };
    void configure();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('mobileReader')) {
            void configure(); void vscode.commands.executeCommand('markdown.preview.refresh');
        }
    }));
    register('mobileReader.hover', () => vscode.commands.executeCommand('mobileReader.hoverBrowser'));
    register('mobileReader.definition', () => vscode.commands.executeCommand('editor.action.revealDefinition'));
    register('mobileReader.back', () => vscode.commands.executeCommand('workbench.action.navigateBack'));
    register('mobileReader.symbols', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', editor.document.uri);
        const choices = [];
        function visit(items, depth = 0) {
            for (const item of items || []) {
                choices.push({ label: `${'  '.repeat(depth)}${item.name}`, description: item.detail,
                    range: item.selectionRange || item.location?.range || item.range });
                visit(item.children, depth + 1);
            }
        }
        visit(symbols);
        if (!choices.length) return vscode.window.showInformationMessage('No symbols yet. Wait for rust-analyzer to load this workspace.');
        const choice = await vscode.window.showQuickPick(choices, {placeHolder:'Choose a symbol to read its documentation'});
        if (choice?.range) {
            editor.selection = new vscode.Selection(choice.range.start, choice.range.start);
            editor.revealRange(choice.range, vscode.TextEditorRevealType.InCenter);
            await vscode.commands.executeCommand('mobileReader.hoverBrowser');
        }
    });
    return {
        extendMarkdownIt(md) {
            const render = md.renderer.render.bind(md.renderer);
            md.renderer.render = (tokens, options, env) => {
                const settings = readSettings(vscode.workspace.getConfiguration('mobileReader', env?.currentDocument));
                return markdownStyle(settings, compact) + render(tokens, options, env);
            };
            return md;
        }
    };
}
module.exports = { activate };
