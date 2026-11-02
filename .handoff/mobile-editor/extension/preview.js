(() => {
    function update() {
        let style = document.getElementById('mobile-reader-preview-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'mobile-reader-preview-style';
            document.head.append(style);
        }
        const css = document.querySelector('.mobile-reader-preview-config')?.getAttribute('data-style') || '';
        if (style.textContent !== css) style.textContent = css;
    }
    // Initial webview content can arrive after the script/DOMContentLoaded;
    // native preview updates may replace the body before their custom event.
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; update(); });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-style'] });
    window.addEventListener('vscode.markdown.updateContent', update);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update, { once: true });
    else update();
})();
