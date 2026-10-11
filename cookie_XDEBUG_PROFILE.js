const LOG_PREFIX = '[XDEBUG_PROFILE]';
const DEFAULT_COOKIE_NAME = 'XDEBUG_PROFILE';
const DEFAULT_COOKIE_VALUE = 'Y';
let currentTab;

function log(...args) {
    console.debug(LOG_PREFIX, ...args);
}

function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

// Cookies can be managed only for regular web pages (not about:, file:, moz-extension: etc.)
function isSupportedUrl(url) {
    return /^https?:\/\//i.test(url || '');
}

async function updateIcon() {
    if (!currentTab) {
        log('updateIcon: no active tab yet');
        return;
    }

    let cookie = await getCookie();
    let icons = await getIcons(cookie);
    let title = cookie ? 'XDEBUG_PROFILE cookie (on)' : 'XDEBUG_PROFILE cookie (off)';
    if (!isSupportedUrl(currentTab.url)) {
        title = 'XDEBUG_PROFILE cookie (not available on this page)';
    }

    log('updateIcon: tab', currentTab.id, currentTab.url, cookie ? 'ON' : 'OFF', icons);
    try {
        await browser.browserAction.setIcon({
            path: icons,
            tabId: currentTab.id
        });
        await browser.browserAction.setTitle({
            title: title,
            tabId: currentTab.id
        });
    } catch (e) {
        // The tab may be closed between query and update
        logError('updateIcon failed', e);
    }
}

async function toggleCookie(tab) {
    if (tab) {
        currentTab = tab;
    }
    if (!currentTab || !isSupportedUrl(currentTab.url)) {
        log('toggleCookie: skipped, unsupported url', currentTab && currentTab.url);
        await updateIcon();
        return null;
    }

    let cookie = await getCookie();
    let currentUrl = currentTab.url;
    let cookieName = await getValueToSet();
    let cookieValue = await getCookieValue();

    try {
        if (cookie) {
            await browser.cookies.remove({
                url: currentUrl,
                name: cookieName,
                storeId: currentTab.cookieStoreId
            });
            log('toggleCookie: removed', cookieName, 'for', currentUrl, 'store', currentTab.cookieStoreId);
        } else {
            await browser.cookies.set({
                url: currentUrl,
                name: cookieName,
                value: cookieValue,
                path: "/",
                storeId: currentTab.cookieStoreId
            });
            log('toggleCookie: set', cookieName + '=' + cookieValue, 'for', currentUrl, 'store', currentTab.cookieStoreId);
        }
    } catch (e) {
        logError('toggleCookie failed for', currentUrl, e);
    }

    await updateIcon();
}

async function getIcons(cookie) {
    let state = 'cookie_XDEBUG_PROFILE_off_color';
    let stateColor = 'light';
    if (cookie) {
        state = 'cookie_XDEBUG_PROFILE_on_color';
        stateColor = 'red';
    }
    let config = await browser.storage.sync.get(state);
    if (config[state]) {
        stateColor = config[state];
    }

    return {
        "64": "icons/bug-" + stateColor + "-64.png",
        "128": "icons/bug-" + stateColor + "-128.png"
    }
}

// Cookie name from settings
async function getValueToSet() {
    let config = await browser.storage.sync.get('cookie_XDEBUG_PROFILE');

    return config.cookie_XDEBUG_PROFILE || DEFAULT_COOKIE_NAME;
}

// Cookie value from settings (must match xdebug.trigger_value if it is set in php.ini)
async function getCookieValue() {
    let config = await browser.storage.sync.get('cookie_XDEBUG_PROFILE_value');

    return config.cookie_XDEBUG_PROFILE_value || DEFAULT_COOKIE_VALUE;
}

async function getCookie() {
    if (!currentTab || !isSupportedUrl(currentTab.url)) {
        return null;
    }

    let currentUrl = currentTab.url;
    let cookieName = await getValueToSet();
    let cookieValue = await getCookieValue();

    let cookie = null;
    try {
        cookie = await browser.cookies.get({
            url: currentUrl,
            name: cookieName,
            storeId: currentTab.cookieStoreId
        });
    } catch (e) {
        logError('getCookie failed for', currentUrl, e);
        return null;
    }

    if (cookie && cookie.value == cookieValue) {
        return cookie;
    }
    if (cookie) {
        log('getCookie: cookie', cookieName, 'has unexpected value', cookie.value, 'expected', cookieValue);
    }

    return null;
}

async function updateActiveTab() {
    function updateTab(tabs) {
        if (tabs[0]) {
            currentTab = tabs[0];
            updateIcon();
        }
    }

    let tabs = await browser.tabs.query({
        active: true,
        currentWindow: true
    });
    updateTab(tabs);
}

// Removes cookies with the old name after it has been changed in options,
// otherwise they stay in the browser and keep triggering the profiler.
async function removeCookiesByName(name, value) {
    let stores = await browser.cookies.getAllCookieStores();
    for (let store of stores) {
        let cookies = [];
        try {
            cookies = await browser.cookies.getAll({
                name: name,
                storeId: store.id,
                firstPartyDomain: null
            });
        } catch (e) {
            logError('removeCookiesByName: getAll failed for store', store.id, e);
            continue;
        }
        for (let cookie of cookies) {
            if (cookie.value != value) {
                continue;
            }
            let url = (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '') + cookie.path;
            try {
                await browser.cookies.remove({
                    url: url,
                    name: cookie.name,
                    storeId: cookie.storeId,
                    firstPartyDomain: cookie.firstPartyDomain
                });
                log('removeCookiesByName: removed', cookie.name, 'for', url, 'store', cookie.storeId);
            } catch (e) {
                logError('removeCookiesByName: remove failed for', url, e);
            }
        }
    }
}

async function onSettingsChanged(changes, area) {
    log('settings changed in', area, changes);
    let nameChange = changes.cookie_XDEBUG_PROFILE;
    if (nameChange && nameChange.oldValue && nameChange.oldValue !== nameChange.newValue) {
        let valueChange = changes.cookie_XDEBUG_PROFILE_value;
        let oldValue = (valueChange ? valueChange.oldValue : await getCookieValue()) || DEFAULT_COOKIE_VALUE;
        await removeCookiesByName(nameChange.oldValue, oldValue);
    }
    updateActiveTab();
}

async function onCookieChanged(changeInfo) {
    let cookieName = await getValueToSet();
    if (changeInfo.cookie.name !== cookieName) {
        return;
    }
    log('cookie changed:', changeInfo.cookie.domain, 'removed:', changeInfo.removed, 'cause:', changeInfo.cause);
    updateActiveTab();
}

function onTabUpdated(tabId, changeInfo, tab) {
    // React only to navigation of the active tab, not to title/favicon/audio updates of any tab
    if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
        updateActiveTab();
    }
}

updateActiveTab();

browser.browserAction.onClicked.addListener(toggleCookie);
browser.tabs.onUpdated.addListener(onTabUpdated);
browser.tabs.onActivated.addListener(updateActiveTab);
browser.windows.onFocusChanged.addListener(updateActiveTab);
browser.cookies.onChanged.addListener(onCookieChanged);
browser.storage.onChanged.addListener(onSettingsChanged);
