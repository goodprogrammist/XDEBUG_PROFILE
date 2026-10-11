# XDEBUG_PROFILE (cookie trigger)
Firefox addon for setting XDEBUG_PROFILE cookie

Now works in **Firefox 121+** and **Chrome / Chromium 121+** (one Manifest V3 codebase).

The toolbar popup toggles Xdebug trigger cookies for the current site:

| Trigger | Cookie (default) | Xdebug mode | Badge |
|---|---|---|---|
| Debug | `XDEBUG_SESSION=PHPSTORM` | `debug` | D |
| Profile | `XDEBUG_PROFILE=Y` | `profile` | P |
| Trace | `XDEBUG_TRACE=Y` | `trace` | T |

The cookie can be set for the current host only or for a parent domain with all
its subdomains (e.g. `.example.com` for `api.example.com` and `www.example.com`).
The choice is remembered per host.

## Keyboard shortcuts

- `Alt+Shift+X` - open popup
- `Alt+Shift+P` - toggle profiler cookie
- `Alt+Shift+D` - toggle debugger cookie
- toggle trace cookie - no default shortcut

Firefox: `about:addons` → gear → "Manage Extension Shortcuts".
Chrome: `chrome://extensions/shortcuts`.

## Installation from sources

Firefox: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → select `manifest.json`.
Firefox may treat host permissions as optional: if the popup shows "Grant access", click it.

Chrome: `chrome://extensions` → enable "Developer mode" → "Load unpacked" → select the repository folder.

Package: `npx web-ext build --ignore-files "screens/*"` (zip works for both browsers).

## Server setup (php.ini)

Xdebug 3:

```ini
xdebug.mode = debug,profile,trace
xdebug.start_with_request = trigger
xdebug.output_dir = /tmp/xdebug
; optional: if set, cookie values in addon options must be the same
; xdebug.trigger_value = Y
```

Xdebug 2:

```ini
xdebug.remote_enable = 1
xdebug.profiler_enable_trigger = 1
xdebug.trace_enable_trigger = 1
xdebug.profiler_output_dir = /tmp/xdebug
```

Open the generated `cachegrind.out.*` files in KCachegrind / QCachegrind.

## Options

- cookie name and value for every trigger (value must match `xdebug.trigger_value` if it is set;
  `XDEBUG_SESSION` value is the IDE key);
- icon colors for "on" and "off" states.

After renaming a cookie in options, cookies with the old name/value are removed from all sites.

## Debug

All scripts log with the `[XDEBUG_PROFILE]` prefix (enable "Debug"/"Verbose" level in the console):

- Firefox: `about:debugging#/runtime/this-firefox` → this addon → "Inspect";
- Chrome: `chrome://extensions` → this addon → "service worker".

Popup can be opened in a regular tab for a given tab: `popup.html?tabId=N`.

## Files

- `common.js` - shared code (triggers, cookies, settings), used by all pages;
- `background.js` - icon, badge, shortcuts, sync with cookie/settings changes;
- `popup.html/js/css` - toolbar popup;
- `options.html/js/css` - settings page.

## Screenshots

![Popup](screens/popup.png)
![Webpage](screens/webpage.png)
![Settings](screens/settings.png)
![Xdebug on server](screens/server-xdebug.png)
![Call graph](screens/call-graph.png)
![Caller map](screens/caller-map.png)
