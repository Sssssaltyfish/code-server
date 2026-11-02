type Workspace = { kind: 'folder' | 'workspace'; path: string }
type Decision = { remember?: string | null; redirect?: string }

function validWorkspace(value: unknown): value is Workspace {
    if (!value || typeof value !== 'object') return false
    const item = value as Workspace
    return (item.kind === 'folder' || item.kind === 'workspace') && typeof item.path === 'string'
        && item.path.startsWith('/') && item.path.length <= 16384 && !item.path.includes('\0')
}

export function routeWorkspace(href: string, saved: string | null): Decision {
    const url = new URL(href)
    const kind = url.searchParams.has('workspace') ? 'workspace' : 'folder'
    const explicit = { kind, path: url.searchParams.get(kind) }
    if (validWorkspace(explicit)) return { remember: JSON.stringify(explicit) }
    // Native Close Folder / Close Workspace explicitly requests an empty window.
    if (url.searchParams.has('ew')) return { remember: null }
    if (url.searchParams.has('folder') || url.searchParams.has('workspace')) return {}
    if (!saved) return {}
    let previous: unknown
    try { previous = JSON.parse(saved) } catch { return { remember: null } }
    if (!validWorkspace(previous)) return { remember: null }
    url.searchParams.set(previous.kind, previous.path)
    return { redirect: url.href }
}

export function workspaceUrl(href: string, workspace: Workspace | null): string {
    const url = new URL(href)
    for (const name of ['folder', 'workspace', 'ew']) url.searchParams.delete(name)
    if (workspace && validWorkspace(workspace)) url.searchParams.set(workspace.kind, workspace.path)
    else url.searchParams.set('ew', 'true')
    return url.href
}

if (typeof window !== 'undefined') {
    const key = 'seia.editor.workspace.v1:' + window.location.pathname
    function apply(restore: boolean) {
        let saved: string | null = null
        try { if (restore) saved = window.localStorage.getItem(key) } catch { /* Private storage can be unavailable. */ }
        const result = routeWorkspace(window.location.href, saved)
        try {
            if (result.remember === null) window.localStorage.removeItem(key)
            else if (result.remember !== undefined) window.localStorage.setItem(key, result.remember)
        } catch { /* Opening an editor must not depend on storage availability. */ }
        if (result.redirect) window.location.replace(result.redirect)
    }
    apply(true)
    // VS Code can replace a folder in this window without navigating the browser.
    // The native workspace service calls this on actual workspace changes. Focus
    // and pageshow must not let an older tab overwrite a more recently opened one.
    Object.assign(window, { seiaWorkspaceState: {
        remember(workspace: Workspace | null) {
            if (workspace !== null && !validWorkspace(workspace)) return
            try {
                if (workspace) window.localStorage.setItem(key, JSON.stringify(workspace))
                else window.localStorage.removeItem(key)
            } catch { /* Storage is optional. */ }
            const next = workspaceUrl(window.location.href, workspace)
            if (next !== window.location.href) window.history.replaceState(window.history.state, '', next)
        }
    } })
}
