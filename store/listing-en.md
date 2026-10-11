# Store listing (English)

## Name
Xdebug Cookies: Debug, Profile, Trace

## Summary (short description)
Toggle XDEBUG_SESSION, XDEBUG_PROFILE and XDEBUG_TRACE cookies to trigger Xdebug on the current site.

## Description
Start PHP step debugging, profiling or function tracing with Xdebug in one click.

The toolbar popup toggles Xdebug trigger cookies for the current site:
• Debug — XDEBUG_SESSION (value is the IDE key)
• Profile — XDEBUG_PROFILE
• Trace — XDEBUG_TRACE

Features:
• Badge on the toolbar icon shows enabled modes (D, P, T)
• Cookie for the current host only or for a parent domain with all subdomains
• IDE presets: VS Code (vsc), PhpStorm, NetBeans, Eclipse, MacGDBp or a custom IDE key
• Own IDE key for a site (e.g. projects behind a DBGp proxy)
• Custom cookie names and values (xdebug.trigger_value)
• Keyboard shortcuts: Alt+Shift+P — profiler, Alt+Shift+D — debugger, Alt+Shift+X — popup
• Works with Firefox containers and private windows
• English, Russian and Kazakh interface

Server setup (Xdebug 3):
xdebug.mode = debug,profile,trace
xdebug.start_with_request = trigger

The extension does not collect or send any data. Source code: https://github.com/goodprogrammist/XDEBUG_PROFILE

## Category
Developer Tools

## Homepage / support
https://github.com/goodprogrammist/XDEBUG_PROFILE
