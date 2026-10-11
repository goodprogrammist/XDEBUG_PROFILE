// Shared code for background script, popup and options (Firefox + Chrome, Manifest V3).
// Firefox exposes `browser`, Chrome exposes `chrome` (both return promises in MV3).
const api = globalThis.browser || globalThis.chrome;
const LOG_PREFIX = '[XDEBUG_PROFILE]';
// firstPartyDomain exists only in Firefox, Chrome rejects unknown properties
const IS_FIREFOX = typeof api.runtime.getBrowserInfo === 'function';

// Supported Xdebug triggers. Storage keys of PROFILE are the same as in old versions.
const TRIGGERS = [
    // XDEBUG_SESSION value is passed to the IDE as IDE key (matters only for DBGp proxy or picky IDEs)
    { id: 'debug', label: 'Debug', badge: 'D', key: 'cookie_XDEBUG_SESSION', defaultName: 'XDEBUG_SESSION', defaultValue: 'vsc', ide: true },
    { id: 'profile', label: 'Profile', badge: 'P', key: 'cookie_XDEBUG_PROFILE', defaultName: 'XDEBUG_PROFILE', defaultValue: 'Y' },
    { id: 'trace', label: 'Trace', badge: 'T', key: 'cookie_XDEBUG_TRACE', defaultName: 'XDEBUG_TRACE', defaultValue: 'Y' }
];
const DEFAULT_ON_COLOR = 'red';
const DEFAULT_OFF_COLOR = 'light';
// Must match host_permissions in manifest.json
const SITE_ORIGINS = { origins: ['http://*/*', 'https://*/*'] };
// Default IDE keys: VS Code - php.debug.ideKey of xdebug/vscode-php-debug,
// others - as in Xdebug helper extension. Any other value is a custom key.
const IDE_PRESETS = [
    { label: 'VS Code', key: 'vsc' },
    { label: 'PhpStorm', key: 'PHPSTORM' },
    { label: 'NetBeans', key: 'netbeans-xdebug' },
    { label: 'Eclipse', key: 'XDEBUG_ECLIPSE' },
    { label: 'MacGDBp', key: 'macgdbp' }
];
// Set when the user has chosen the IDE on the options page (welcome block is shown until then)
const IDE_CHOSEN_KEY = 'ide_chosen';

// Localized string from _locales/*/messages.json, falls back to the key itself
function t(key, ...substitutions) {
    let message = api.i18n.getMessage(key, substitutions.map(String));
    if (!message) {
        console.warn(LOG_PREFIX, 'i18n: no message for', key);
        return key;
    }
    return message;
}

// Translates elements with data-i18n (text), data-i18n-placeholder and data-i18n-title attributes
function localizePage(root) {
    if (!root) {
        root = document;
        // Language of the translation actually used (stored in messages.json)
        document.documentElement.lang = t('langCode');
    }
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
}

// RFC 6265: cookie-name is a token, cookie-value has no spaces, quotes, commas, semicolons, backslashes
function isValidCookieName(name) {
    return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

function isValidCookieValue(value) {
    return /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value);
}

function getIdePreset(key) {
    return IDE_PRESETS.find(preset => preset.key === key) || null;
}

// "VS Code (vsc)" or "custom key (VSCODE)"
function getIdeLabel(key) {
    let preset = getIdePreset(key);
    return (preset ? preset.label : t('customKey')) + ' (' + key + ')';
}

function log(...args) {
    console.debug(LOG_PREFIX, ...args);
}

function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

// Cookies can be managed only for regular web pages (not about:, chrome:, file:, moz-extension: etc.)
function isSupportedUrl(url) {
    return /^https?:\/\//i.test(url || '');
}

async function hasHostPermission() {
    try {
        return await api.permissions.contains(SITE_ORIGINS);
    } catch (e) {
        logError('permissions.contains failed', e);
        return false;
    }
}

// Must be called from a user action handler (click)
async function requestHostPermission() {
    let granted = await api.permissions.request(SITE_ORIGINS);
    log('host permission granted:', granted);
    return granted;
}

// Returns [{...trigger, name, value, siteValue}] with values from settings.
// host - apply per-site overrides (IDE key of the debug trigger), siteValue is true then.
async function getTriggerSettings(host) {
    let keys = [];
    for (let trigger of TRIGGERS) {
        keys.push(trigger.key, trigger.key + '_value');
    }
    let config = await api.storage.sync.get(keys);
    let siteIdeKey = host ? await getSiteIdeKey(host) : '';

    return TRIGGERS.map(trigger => Object.assign({}, trigger, {
        label: t('trigger_' + trigger.id),
        name: config[trigger.key] || trigger.defaultName,
        value: (trigger.ide && siteIdeKey) || config[trigger.key + '_value'] || trigger.defaultValue,
        siteValue: !!(trigger.ide && siteIdeKey)
    }));
}

// IDE key for a site, overrides the global one ('' - use global).
// Useful when some projects work through DBGp proxy with their own key.
async function getSiteIdeKey(host) {
    let key = 'idekey:' + host;
    let data = await api.storage.local.get(key);
    return data[key] || '';
}

async function setSiteIdeKey(host, ideKey) {
    let key = 'idekey:' + host;
    if (ideKey) {
        await api.storage.local.set({ [key]: ideKey });
    } else {
        await api.storage.local.remove(key);
    }
    log('IDE key for', host, '=', ideKey || '(global)');
}

async function getColors() {
    let config = await api.storage.sync.get(['cookie_XDEBUG_PROFILE_on_color', 'cookie_XDEBUG_PROFILE_off_color']);

    return {
        on: config.cookie_XDEBUG_PROFILE_on_color || DEFAULT_ON_COLOR,
        off: config.cookie_XDEBUG_PROFILE_off_color || DEFAULT_OFF_COLOR
    };
}

// Firefox: tab.cookieStoreId (containers, private windows).
// Chrome: no cookieStoreId in tabs, find the store that contains the tab ("0" - normal, "1" - incognito).
async function getStoreId(tab) {
    if (tab.cookieStoreId) {
        return tab.cookieStoreId;
    }
    let stores = await api.cookies.getAllCookieStores();
    for (let store of stores) {
        if (store.tabIds && store.tabIds.includes(tab.id)) {
            return store.id;
        }
    }
    log('getStoreId: store not found for tab', tab.id, 'using default');
    return undefined;
}

function getHost(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return '';
    }
}

// Domains the cookie can be set for: the host itself and its parent domains (at least 2 labels).
// Public suffixes (like co.uk) are rejected by the browser itself, the error is shown in popup.
function getDomainCandidates(host) {
    if (!host || host.indexOf('.') === -1 || /^[\d.]+$/.test(host) || host.indexOf(':') !== -1 || host.startsWith('[')) {
        return [];
    }
    let labels = host.split('.');
    let result = [];
    for (let i = 0; i <= labels.length - 2; i++) {
        result.push(labels.slice(i).join('.'));
    }
    return result;
}

// Scope is remembered per host: '' - host-only cookie, 'example.com' - cookie for .example.com and subdomains
async function getScope(host) {
    let key = 'scope:' + host;
    let data = await api.storage.local.get(key);
    let scope = data[key] || '';
    if (scope && !getDomainCandidates(host).includes(scope)) {
        return '';
    }
    return scope;
}

async function setScope(host, scope) {
    let key = 'scope:' + host;
    if (scope) {
        await api.storage.local.set({ [key]: scope });
    } else {
        await api.storage.local.remove(key);
    }
    log('scope for', host, '=', scope || '(host only)');
}

async function getCookie(tab, trigger) {
    if (!tab || !isSupportedUrl(tab.url)) {
        return null;
    }

    let cookie = null;
    try {
        cookie = await api.cookies.get({
            url: tab.url,
            name: trigger.name,
            storeId: await getStoreId(tab)
        });
    } catch (e) {
        logError('getCookie failed for', tab.url, trigger.name, e);
        return null;
    }

    if (cookie && cookie.value == trigger.value) {
        return cookie;
    }
    if (cookie) {
        log('getCookie: cookie', trigger.name, 'has unexpected value', cookie.value, 'expected', trigger.value);
    }

    return null;
}

// Returns {debug: cookie|null, profile: ..., trace: ...}
async function getStates(tab) {
    let triggers = await getTriggerSettings(getHost(tab.url));
    let states = {};
    for (let trigger of triggers) {
        states[trigger.id] = await getCookie(tab, trigger);
    }
    return states;
}

function cookieUrl(cookie) {
    return (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '') + cookie.path;
}

async function removeCookie(cookie) {
    let details = {
        url: cookieUrl(cookie),
        name: cookie.name,
        storeId: cookie.storeId
    };
    if (IS_FIREFOX && cookie.firstPartyDomain !== undefined) {
        details.firstPartyDomain = cookie.firstPartyDomain;
    }
    await api.cookies.remove(details);
    log('removed', cookie.name, 'for', details.url, 'store', cookie.storeId);
}

// Removes all cookies with this name that are sent to the tab url (host-only and domain ones)
async function disableTrigger(tab, trigger) {
    let query = {
        url: tab.url,
        name: trigger.name,
        storeId: await getStoreId(tab)
    };
    if (IS_FIREFOX) {
        query.firstPartyDomain = null;
    }
    let cookies = await api.cookies.getAll(query);
    for (let cookie of cookies) {
        await removeCookie(cookie);
    }
}

async function enableTrigger(tab, trigger) {
    let host = getHost(tab.url);
    let scope = await getScope(host);
    let details = {
        url: tab.url,
        name: trigger.name,
        value: trigger.value,
        path: '/',
        storeId: await getStoreId(tab)
    };
    if (scope) {
        details.domain = scope;
    }
    await api.cookies.set(details);
    log('set', trigger.name + '=' + trigger.value, 'for', scope ? '.' + scope : host, 'store', details.storeId);
}

// Returns new state (true - enabled). Throws on API errors.
async function toggleTrigger(tab, triggerId) {
    if (!tab || !isSupportedUrl(tab.url)) {
        log('toggleTrigger: skipped, unsupported url', tab && tab.url);
        return false;
    }
    let triggers = await getTriggerSettings(getHost(tab.url));
    let trigger = triggers.find(t => t.id === triggerId);
    if (await getCookie(tab, trigger)) {
        await disableTrigger(tab, trigger);
        return false;
    }
    await enableTrigger(tab, trigger);
    return true;
}

// Re-sets enabled cookies after scope change.
// triggerIds - triggers to (re)enable, by default the currently enabled ones.
async function reapplyTriggers(tab, triggerIds) {
    let triggers = await getTriggerSettings(getHost(tab.url));
    for (let trigger of triggers) {
        let enabled = triggerIds ? triggerIds.includes(trigger.id) : !!await getCookie(tab, trigger);
        if (enabled) {
            await disableTrigger(tab, trigger);
            await enableTrigger(tab, trigger);
        }
    }
}

async function getActiveTab() {
    let tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
}
