# Mobile Editor

Use this installer with the Linux standalone release of code-server 4.144.0
(`ee31cdbe02c07b3ba718007f221d14c890696c61`). Extract the release to
`$EDITOR_ROOT/runtime`, set `EDITOR_ROOT` to an absolute path, then run
`bun .handoff/mobile-editor/install.ts` with Python 3 available. Start
code-server with `--extensions-dir "$EDITOR_ROOT/extensions"` and
`--user-data-dir "$EDITOR_ROOT/data"`. For per-browser workspace restoration,
point the portal link at `/editor/` and set `ignore-last-opened: true` in
code-server's configuration.

## Browser cache

The upstream versioned workbench JS and CSS have a one-year cache lifetime.
The installer adds a content-derived `?reader=<revision>` to the workspace
bootstrap, workbench JS and workbench CSS so a reader update gets new URLs.

For a deployment under `/editor/`, include `nginx/editor-icon-cache.conf`
in nginx's `http` context and add the following directive inside the existing
authenticated Editor proxy location:

```nginx
expires $editor_icon_expires;
```

Validate with `nginx -t` using the deployment's normal config and reload
nginx. If the portal already has the equivalent Editor rule in a shared
static-asset map, keep that rule as the single source of policy.

The rule gives the application's favicon and PWA icons a one-day lifetime
on successful image responses and conditional 304 responses. An expired icon
can validate with its existing ETag. All other paths and response types keep
their upstream cache policy, including login HTML returned for an icon URL.
To check an authenticated request, inspect the icon response in the browser's
Network panel for `Cache-Control: max-age=86400`. On a normal second visit
with browser caching enabled the fresh icon can load from disk.
