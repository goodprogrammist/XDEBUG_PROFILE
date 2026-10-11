# XDEBUG_PROFILE (cookie trigger)
Firefox addon for setting XDEBUG_PROFILE cookie

One click on the toolbar button (or `Alt+Shift+P`) sets / removes the `XDEBUG_PROFILE`
cookie for the current site, so Xdebug starts the profiler for every request of this site.

## Server setup (php.ini)

Xdebug 3:

```ini
xdebug.mode = profile
xdebug.start_with_request = trigger
xdebug.output_dir = /tmp/xdebug
; optional: if set, the cookie value in addon options must be the same
; xdebug.trigger_value = Y
```

Xdebug 2:

```ini
xdebug.profiler_enable_trigger = 1
xdebug.profiler_output_dir = /tmp/xdebug
```

Open the generated `cachegrind.out.*` files in KCachegrind / QCachegrind.

## Options

- cookie name (default `XDEBUG_PROFILE`);
- cookie value (default `Y`, must match `xdebug.trigger_value` if it is set);
- icon colors for "on" and "off" states.

The keyboard shortcut can be changed in `about:addons` → gear → "Manage Extension Shortcuts".

## Debug

Open `about:debugging#/runtime/this-firefox` → this addon → "Inspect": the background
script logs every action with the `[XDEBUG_PROFILE]` prefix (enable "Debug" level in the console).

## Screenshots

![Webpage](screens/webpage.png)
![Settings](screens/settings.png)
![Xdebug on server](screens/server-xdebug.png)
![Call graph](screens/call-graph.png)
![Caller map](screens/caller-map.png)
