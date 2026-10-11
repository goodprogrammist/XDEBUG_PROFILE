# Permission justifications (for store review forms)

**Single purpose:** toggle Xdebug trigger cookies (XDEBUG_SESSION, XDEBUG_PROFILE, XDEBUG_TRACE)
for the current site to start PHP debugging, profiling or tracing.

| Permission | Why it is needed |
|---|---|
| `cookies` | Set and remove the Xdebug trigger cookies for the current site; watch cookie changes to show the actual state on the toolbar icon. |
| `tabs` | Read the URL of the active tab to know which site the cookie is for, and update the toolbar icon and badge per tab. |
| `storage` | Save extension settings (cookie names and values, IDE, icon colors) and per-site choices. |
| Host permission `<all_urls>` | The cookies API works only for sites the extension has host permission for. Developers debug arbitrary hosts (localhost, test domains, staging servers), so the list of sites cannot be fixed in advance. |
| Remote code | Not used. All code is in the package. |
| Data collection | None. |
