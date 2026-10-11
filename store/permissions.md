# Permission justifications (for store review forms)

**Single purpose:** toggle Xdebug trigger cookies (XDEBUG_SESSION, XDEBUG_PROFILE, XDEBUG_TRACE)
for the current site to start PHP debugging, profiling or tracing.

| Permission | Why it is needed |
|---|---|
| `cookies` | Set and remove the Xdebug trigger cookies for the current site; watch cookie changes to show the actual state on the toolbar icon. |
| `storage` | Save extension settings (cookie names and values, IDE, icon colors) and per-site choices. |
| Host permissions `http://*/*`, `https://*/*` | The cookies API works only for sites the extension has host permission for; the same permission gives the URL of the current tab (to know which site the cookie is for and to show the state on the toolbar icon). Developers debug arbitrary hosts (localhost, test domains, staging servers), so the list of sites cannot be fixed in advance. Only http and https are requested: Xdebug cookies make sense only there. |
| Remote code | Not used. All code is in the package. |
| Data collection | None. |
