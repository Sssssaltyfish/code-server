import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = process.env.EDITOR_ROOT!
if (!root) throw new Error('Set EDITOR_ROOT')
const local = process.env.DESKTOP_SETTINGS || ''
const source = import.meta.dir
const readerOnly = true
const pkg = JSON.parse(readFileSync(join(root,'runtime/package.json'),'utf8'))
if(pkg.version !== '4.144.0' || pkg.commit !== 'ee31cdbe02c07b3ba718007f221d14c890696c61') throw new Error('Unsupported code-server release')
const backup = join(root, 'backups', 'appearance-' + new Date().toISOString().replaceAll(/[:.]/g, '-'))
mkdirSync(backup, { recursive: true })
const settingsPath = join(root, 'data/User/settings.json')
mkdirSync(join(root, 'data/User'), {recursive:true})
if (!existsSync(settingsPath)) writeFileSync(settingsPath, '{}')
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
settings['workbench.editorAssociations'] = {...settings['workbench.editorAssociations'], '*.md':'vscode.markdown.preview.editor'}
writeFileSync(settingsPath, JSON.stringify(settings,null,2))
const desktop = readerOnly ? {} : Bun.JSONC.parse(readFileSync(local, 'utf8')) as Record<string, unknown>
copyFileSync(settingsPath, join(backup, 'settings.json'))

const appearance = /^(editor\.(font|lineHeight|letterSpacing|wordWrap|render|cursor|lineNumbers|minimap|stickyScroll|semanticHighlighting|tokenColorCustomizations|semanticTokenColorCustomizations|guides|bracketPairColorization|rulers|scrollBeyondLastLine|mouseWheelZoom)|workbench\.(colorTheme|iconTheme|productIconTheme|colorCustomizations|editor\.|activityBar\.|sideBar\.|tree\.)|window\.(zoomLevel|commandCenter)|breadcrumbs\.|markdown\.preview\.(font|lineHeight)|terminal\.integrated\.(font|lineHeight|letterSpacing|cursor))/
const copied: string[] = []
if (!readerOnly) {
// Remove only the mobile-first display defaults installed by configure.py.
for (const key of Object.keys(settings)) {
    if (appearance.test(key) || ['workbench.editorAssociations', 'workbench.secondarySideBar.defaultVisibility', 'workbench.layoutControl.enabled',
        'markdown.preview.scrollEditorWithPreview', 'markdown.preview.scrollPreviewWithEditor'].includes(key)) delete settings[key]
}
for (const [key, value] of Object.entries(desktop)) {
    if (appearance.test(key) || key === 'workbench.editorAssociations') {
        settings[key] = value
        copied.push(key)
    } else if (/^\[.*\]$/.test(key) && value && typeof value === 'object') {
        const values = Object.fromEntries(Object.entries(value).filter(([name]) => appearance.test(name)))
        if (Object.keys(values).length) { settings[key] = { ...settings[key], ...values }; copied.push(key) }
    }
}
// Preserve the Windows editor defaults across a Linux-hosted frontend.
settings['editor.fontFamily'] ??= "Consolas, 'Courier New', monospace"
settings['editor.fontSize'] ??= 14
settings['editor.lineHeight'] ??= 0
settings['editor.semanticHighlighting.enabled'] ??= true
// Web Editor is a reading entry point on every device. Keep this after the desktop snapshot.
settings['workbench.editorAssociations'] = { ...settings['workbench.editorAssociations'], '*.md': 'vscode.markdown.preview.editor' }
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')

}
const extension = join(root, 'extensions/local.mobile-reader-0.1.0')
if (existsSync(extension)) cpSync(extension, join(backup, 'mobile-reader'), { recursive: true })
cpSync(join(source, 'extension'), extension, { recursive: true })
const vsix=join(backup,'mobile-reader.vsix')
execFileSync('python3',['-c',"import pathlib,sys,zipfile\nr=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'w') as z:\n z.writestr('[Content_Types].xml','<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"json\" ContentType=\"application/json\"/></Types>')\n z.writestr('extension.vsixmanifest','<PackageManifest Version=\"2.0.0\" xmlns=\"http://schemas.microsoft.com/developer/vsx-schema/2011\"><Metadata><Identity Language=\"en-US\" Id=\"mobile-reader\" Version=\"0.1.0\" Publisher=\"local\"/><DisplayName>Mobile Reader</DisplayName><Description>Mobile Reader</Description></Metadata><Installation><InstallationTarget Id=\"Microsoft.VisualStudio.Code\"/></Installation><Dependencies/><Assets><Asset Type=\"Microsoft.VisualStudio.Code.Manifest\" Path=\"extension/package.json\" Addressable=\"true\"/></Assets></PackageManifest>')\n for f in r.rglob('*'):\n  if f.is_file(): z.write(f,'extension/'+str(f.relative_to(r)))",extension,vsix])
execFileSync(join(root,'runtime/bin/code-server'), ['--user-data-dir',join(root,'data'),'--extensions-dir',join(root,'extensions'),'--install-extension',vsix,'--force'], {stdio:'inherit'})
// A manifest-only change otherwise appears one reload late: the scanner can
// first return its old contribution list and refresh that cache in the background.
const profileCache = join(root, 'data/CachedProfilesData/__default__profile__')
if (existsSync(profileCache)) for (const file of readdirSync(profileCache)) {
    if (!/^extensions\.user.*\.cache$/.test(file)) continue
    copyFileSync(join(profileCache, file), join(backup, file))
    unlinkSync(join(profileCache, file))
}

// The bootstrap exposes embedder commands, but code-server does not configure any.
// Keep this single version-checked insertion separate from the minified upstream code.
const workbench = join(root, 'runtime/lib/vscode/out/vs/code/browser/workbench/workbench.js')
const original = workbench + '.mobile-reader-original'
if (!existsSync(original)) copyFileSync(workbench, original)
copyFileSync(workbench, join(backup, 'workbench.js'))
const bundle = readFileSync(original, 'utf8')
const expected = {js:'6af38fcb0bf7080aecf7569835591e69a051603090ec077c27b72d4cac538257',css:'f79d25f9acf9d72edb7991959914e6f9a782df47b39d34ce75018d3922c9d64d',html:'2bc720cb830cac1b75193cf16cb42f5bc583cc6e5b8546b2e02b795d23ec10ab'}
for(const [suffix,hash] of Object.entries(expected)){ const target=workbench.replace(/\.js$/,'.'+suffix); const pristine=existsSync(target+'.mobile-reader-original')?target+'.mobile-reader-original':target; if(createHash('sha256').update(readFileSync(pristine)).digest('hex')!==hash) throw new Error('Original bundle hash mismatch: '+suffix) }
const anchor = 'kGo(vt.document.body,{...e,windowIndicator:'
const bridgeSymbols = {
    __WORKBENCH_COMMANDS__: ['ycr', 'o.executeCommand=s})(ycr||={})'],
    __COMMAND_REGISTRY__: ['Qe', 'Qe.registerCommand(t.id,(i,...n)=>t.handler(...n))'],
    __CODE_EDITOR_SERVICE__: ['ki', 'var ki=me("codeEditorService")'],
    __EDITOR_SERVICE__: ['ue', 'var ue=me("editorService")'],
    __CONTEXT_SERVICE__: ['se', 'se=me("contextKeyService")'],
    __MENU_REGISTRY__: ['Me', 'Me.appendMenuItem(O.EditorTitle,'],
    __MENU_ID__: ['O', 'Me.appendMenuItem(O.EditorTitle,'],
    __CONTEXT_EXPR__: ['D', 'D.and('],
    __LAYOUT_SERVICE__: ['so', 'var so=_l;'],
    __QUICK_INPUT_SERVICE__: ['nt', 'nt=me("quickInputService")'],
    __WORKSPACE_SERVICE__: ['ze', 'var ze=me("contextService")']
}
if (bundle.split(anchor).length !== 2 || Object.values(bridgeSymbols).some(([, marker]) => !bundle.includes(marker))
    || !bundle.includes('n.Tap="-monaco-gesturetap"') || !bundle.includes('onTap(o){o.preventDefault(),this.viewHelper.focusTextArea()')) {
    throw new Error('Workbench version changed; review the mobile bridge before patching')
}
let commands = readFileSync(join(source, 'browser-commands.js'), 'utf8')
for (const [placeholder, file] of [['__READER_INPUT__', 'browser-input.js'], ['__READER_LAYOUT__', 'browser-layout.js'], ['__READER_SETTINGS__', 'extension/settings.js']]) {
    const module = readFileSync(join(source, file), 'utf8')
        .replace("require('./package.json')", readFileSync(join(source, 'extension/package.json'), 'utf8'))
    commands = commands.replace(placeholder, `(() => { const module = { exports: {} }; ${module}; return module.exports; })()`)
}
for (const [placeholder, [symbol]] of Object.entries(bridgeSymbols)) commands = commands.replaceAll(placeholder, symbol)
writeFileSync(workbench, bundle.replace(anchor, 'kGo(vt.document.body,{...e,commands:[...(e.commands??[]),...' + commands + '],windowIndicator:'))
// Keep the user's Windows monospace face available on the phone as well.
const fontCss = ''
const cssPath = workbench.replace(/\.js$/, '.css')
const cssOriginal = cssPath + '.mobile-reader-original'
if (!existsSync(cssOriginal)) copyFileSync(cssPath, cssOriginal)
copyFileSync(cssPath, join(backup, 'workbench.css'))
writeFileSync(cssPath, readFileSync(cssOriginal, 'utf8') + '\n' + fontCss + '\n' + readFileSync(join(source, 'browser.css'), 'utf8'))
writeFileSync(join(extension, 'reading.css'), fontCss + '\n' + readFileSync(join(source, 'extension/reading.css'), 'utf8'))
const htmlPath = workbench.replace(/\.js$/, '.html')
const htmlOriginal = htmlPath + '.mobile-reader-original'
if (!existsSync(htmlOriginal)) copyFileSync(htmlPath, htmlOriginal)
copyFileSync(htmlPath, join(backup, 'workbench.html'))
const workspaceBuild = await Bun.build({ entrypoints: [join(source, 'workspace-state.ts')], target: 'browser', format: 'iife', minify: true })
if (!workspaceBuild.success) throw new Error('Workspace state script failed to build')
const workspaceScript = await workspaceBuild.outputs[0].text()
writeFileSync(workbench.replace(/workbench\.js$/, 'workspace-state.js'), workspaceScript)
const revision = createHash('sha256').update(readFileSync(workbench)).update(readFileSync(cssPath)).update(workspaceScript).digest('hex').slice(0, 12)
writeFileSync(htmlPath, readFileSync(htmlOriginal, 'utf8')
    .replace('<meta charset="utf-8" />', `<meta charset="utf-8" /><script nonce="{{WORKBENCH_SCRIPT_NONCE}}" src="{{WORKBENCH_WEB_BASE_URL}}/out/vs/code/browser/workbench/workspace-state.js?reader=${revision}"></script>`)
    .replace('/workbench/workbench.js"', `/workbench/workbench.js?reader=${revision}"`)
    .replace('/workbench/workbench.css"', `/workbench/workbench.css?reader=${revision}"`))
writeFileSync(join(root, readerOnly ? 'reader-sync.json' : 'appearance-sync.json'), JSON.stringify({ source: local, copied, theme: settings['workbench.colorTheme'],
    iconTheme: settings['workbench.iconTheme'], fontFamily: settings['editor.fontFamily'], fontSize: settings['editor.fontSize'], lineHeight: settings['editor.lineHeight'], backup }, null, 2))
console.log(JSON.stringify({ copied: copied.length, theme: settings['workbench.colorTheme'], backup }))
