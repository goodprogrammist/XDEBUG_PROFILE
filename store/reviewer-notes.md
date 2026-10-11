# Notes for reviewers (AMO "Notes for Reviewers")

No account, server or build step is needed. The package contains plain, non-minified source files
(identical to https://github.com/goodprogrammist/XDEBUG_PROFILE).

How to test:
1. Open any http(s) site, e.g. https://example.com/.
2. Click the toolbar icon: the popup shows Debug / Profile / Trace switches.
3. Turn on "Profile": the cookie XDEBUG_PROFILE=Y is set for the site
   (visible in DevTools → Storage → Cookies), the icon gets the "P" badge.
4. Turn it off: the cookie is removed.

Permissions: "cookies" and host permissions for http/https are needed to set and remove these cookies
for the current site; "storage" keeps the settings. The extension makes no network requests
and collects no data.
