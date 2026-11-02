const properties = require('./package.json').contributes.configuration.properties;

function readSettings(configuration) {
    return Object.fromEntries(Object.entries(properties).map(([name, schema]) => {
        const key = name.slice('mobileReader.'.length);
        let value = configuration.get(key, schema.default);
        if (schema.type === 'number') value = typeof value === 'number' && Number.isFinite(value)
            ? Math.max(schema.minimum, Math.min(schema.maximum, value)) : schema.default;
        else if (Array.isArray(schema.type)) value = value === null || (typeof value === 'number' && Number.isFinite(value))
            ? value === null ? null : Math.max(schema.minimum, Math.min(schema.maximum, value)) : schema.default;
        else if (schema.type === 'boolean' && typeof value !== 'boolean') value = schema.default;
        else if (schema.enum && !schema.enum.includes(value)) value = schema.default;
        else if (schema.type === 'array') value = Array.isArray(value)
            ? [...new Set(value)].filter(item => schema.items.enum.includes(item)) : schema.default;
        return [key, value];
    }));
}

function markdownStyle(settings, compact) {
    if (!settings['markdown.enabled'] || compact === false || (compact == null && settings.mode === 'off')) return '';
    const css = `html,body{font-size:${settings['markdown.fontSize']}px;line-height:${settings['markdown.lineHeight']}}html{padding:0}body{padding:${settings['markdown.paddingVertical']}px ${settings['markdown.paddingHorizontal']}px}pre{overflow-x:auto;-webkit-overflow-scrolling:touch}table{display:block;max-width:100%;overflow-x:auto}`;
    const rule = compact === true || settings.mode === 'on' ? css
        : `@media(max-width:${settings.maxWidth}px) and(max-device-width:${settings.maxWidth}px) and(pointer:coarse){${css}}`;
    // Keep configuration in the document diff; the preview script owns the style
    // element so native incremental rendering cannot retain an old stylesheet.
    return `<span hidden class="mobile-reader-preview-config" data-style="${rule}"></span>`;
}

module.exports = { readSettings, markdownStyle };
