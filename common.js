// Shared code for background script, popup and options (Firefox + Chrome, Manifest V3).
// Firefox exposes `browser`, Chrome exposes `chrome` (both return promises in MV3).
const api = globalThis.browser || globalThis.chrome;
const LOG_PREFIX = '[XDEBUG_PROFILE]';
// firstPartyDomain exists only in Firefox, Chrome rejects unknown properties
const IS_FIREFOX = typeof api.runtime.getBrowserInfo === 'function';

// Supported Xdebug triggers. Storage keys of PROFILE are the same as in old versions.
const TRIGGERS = [
    { id: 'debug', label: 'Debug', badge: 'D', key: 'cookie_XDEBUG_SESSION', defaultName: 'XDEBUG_SESSION', defaultValue: 'PHPSTORM' },
    { id: 'profile', label: 'Profile', badge: 'P', key: 'cookie_XDEBUG_PROFILE', defaultName: 'XDEBUG_PROFILE', defaultValue: 'Y' },
    { id: 'trace', label: 'Trace', badge: 'T', key: 'cookie_XDEBUG_TRACE', defaultName: 'XDEBUG_TRACE', defaultValue: 'Y' }
];
const DEFAULT_ON_COLOR = 'red';
const DEFAULT_OFF_COLOR = 'light';
const ALL_URLS = { origins: ['<all_urls>'] };

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
        return await api.permissions.contains(ALL_URLS);
    } catch (e) {
        logError('permissions.contains failed', e);
        return false;
    }
}

// Must be called from a user action handler (click)
async function requestHostPermission() {
    let granted = await api.permissions.request(ALL_URLS);
    log('host permission granted:', granted);
    return granted;
}

// Returns [{...trigger, name, value}] with values from settings
async function getTriggerSettings() {
    let keys = [];
    for (let trigger of TRIGGERS) {
        keys.push(trigger.key, trigger.key + '_value');
    }
    let config = await api.storage.sync.get(keys);

    return TRIGGERS.map(trigger => Object.assign({}, trigger, {
        name: config[trigger.key] || trigger.defaultName,
        value: config[trigger.key + '_value'] || trigger.defaultValue
    }));
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
    let triggers = await getTriggerSettings();
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
    let triggers = await getTriggerSettings();
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
    let triggers = await getTriggerSettings();
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
