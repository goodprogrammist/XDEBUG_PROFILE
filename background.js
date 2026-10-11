// Chrome runs background as a service worker (background.service_worker), shared code is loaded here.
// Firefox runs background.scripts (common.js is listed before this file in manifest).
if (typeof importScripts === 'function' && typeof TRIGGERS === 'undefined') {
    importScripts('common.js');
}

function getIcons(color) {
    return {
        "16": "icons/bug-" + color + "-16.png",
        "32": "icons/bug-" + color + "-32.png",
        "64": "icons/bug-" + color + "-64.png",
        "128": "icons/bug-" + color + "-128.png"
    };
}

// Calls for the same tab are serialized: otherwise a slow call with an old state
// may overwrite the icon after a newer one
const iconQueue = new Map();

function updateIcon(tab) {
    if (!tab) {
        log('updateIcon: no tab');
        return Promise.resolve();
    }
    let next = (iconQueue.get(tab.id) || Promise.resolve())
        .then(() => renderIcon(tab))
        .catch(e => logError('updateIcon failed', e));
    iconQueue.set(tab.id, next);
    next.then(() => {
        if (iconQueue.get(tab.id) === next) {
            iconQueue.delete(tab.id);
        }
    });
    return next;
}

async function renderIcon(tab) {
    if (!tab) {
        log('updateIcon: no tab');
        return;
    }

    let states = await getStates(tab);
    let triggers = await getTriggerSettings();
    let colors = await getColors();
    let enabled = triggers.filter(t => states[t.id]);
    let badge = enabled.map(t => t.badge).join('');

    let title = 'Xdebug: ' + (enabled.length ? enabled.map(t => t.label + ' (' + t.name + ')').join(', ') : 'off');
    if (!isSupportedUrl(tab.url)) {
        title = 'Xdebug cookies (not available on this page)';
    } else if (!await hasHostPermission()) {
        title = 'Xdebug cookies: click to grant access to sites';
    }

    log('updateIcon: tab', tab.id, tab.url, 'enabled:', badge || '-');
    try {
        await api.action.setIcon({ path: getIcons(enabled.length ? colors.on : colors.off), tabId: tab.id });
        await api.action.setTitle({ title: title, tabId: tab.id });
        await api.action.setBadgeText({ text: badge, tabId: tab.id });
        await api.action.setBadgeBackgroundColor({ color: '#c0392b', tabId: tab.id });
    } catch (e) {
        // The tab may be closed between query and update
        logError('updateIcon failed', e);
    }
}

// Service worker has no persistent state, so active tabs are always queried
async function updateActiveTabs() {
    let tabs = await api.tabs.query({ active: true });
    for (let tab of tabs) {
        await updateIcon(tab);
    }
}

// Removes cookies with the old name after it has been changed in options,
// otherwise they stay in the browser and keep triggering Xdebug.
async function removeCookiesByName(name, value) {
    let stores = await api.cookies.getAllCookieStores();
    for (let store of stores) {
        let query = { name: name, storeId: store.id };
        if (IS_FIREFOX) {
            query.firstPartyDomain = null;
        }
        let cookies = [];
        try {
            cookies = await api.cookies.getAll(query);
        } catch (e) {
            logError('removeCookiesByName: getAll failed for store', store.id, e);
            continue;
        }
        for (let cookie of cookies) {
            if (cookie.value != value) {
                continue;
            }
            try {
                await removeCookie(cookie);
            } catch (e) {
                logError('removeCookiesByName: remove failed for', cookie.domain, e);
            }
        }
    }
}

async function onSettingsChanged(changes, area) {
    log('settings changed in', area, changes);
    if (area === 'sync') {
        let triggers = await getTriggerSettings();
        for (let trigger of TRIGGERS) {
            let nameChange = changes[trigger.key];
            let valueChange = changes[trigger.key + '_value'];
            if (!nameChange && !valueChange) {
                continue;
            }
            let current = triggers.find(t => t.id === trigger.id);
            // Empty/missing values mean defaults
            let oldName = (nameChange ? nameChange.oldValue : current.name) || trigger.defaultName;
            let oldValue = (valueChange ? valueChange.oldValue : current.value) || trigger.defaultValue;
            if (oldName !== current.name || oldValue !== current.value) {
                log('trigger', trigger.id, 'changed from', oldName + '=' + oldValue, 'to', current.name + '=' + current.value);
                await removeCookiesByName(oldName, oldValue);
            }
        }
    }
    await updateActiveTabs();
}

// Updates all tabs the changed cookie belongs to (not only active ones: popup may be open in another tab)
async function onCookieChanged(changeInfo) {
    let triggers = await getTriggerSettings();
    if (!triggers.some(t => t.name === changeInfo.cookie.name)) {
        return;
    }
    log('cookie changed:', changeInfo.cookie.name, changeInfo.cookie.domain, 'removed:', changeInfo.removed, 'cause:', changeInfo.cause);
    let domain = changeInfo.cookie.domain.replace(/^\./, '');
    let tabs = await api.tabs.query({});
    for (let tab of tabs) {
        let host = getHost(tab.url);
        if (host === domain || host.endsWith('.' + domain)) {
            await updateIcon(tab);
        }
    }
}

function onTabUpdated(tabId, changeInfo, tab) {
    // React only to navigation, not to title/favicon/audio updates.
    // Tab-specific badge is reset by the browser on navigation, so background tabs are updated too.
    if (changeInfo.url || changeInfo.status === 'complete') {
        updateIcon(tab);
    }
}

async function onTabActivated(activeInfo) {
    try {
        updateIcon(await api.tabs.get(activeInfo.tabId));
    } catch (e) {
        logError('onTabActivated: tabs.get failed', e);
    }
}

// Keyboard shortcuts toggle triggers without opening the popup
async function onCommand(command) {
    let triggerId = command.replace(/^toggle-/, '');
    let tab = await getActiveTab();
    log('command', command, 'tab', tab && tab.url);
    try {
        await toggleTrigger(tab, triggerId);
    } catch (e) {
        logError('command', command, 'failed', e);
    }
    await updateIcon(tab);
}

// Firefox MV3 treats host permissions as optional: open options with "Grant access" button if needed
async function onInstalled(details) {
    log('installed:', details.reason);
    if (!await hasHostPermission()) {
        api.runtime.openOptionsPage();
    }
    await updateActiveTabs();
}

// Listeners must be registered synchronously at top level (service worker requirement)
api.tabs.onUpdated.addListener(onTabUpdated);
api.tabs.onActivated.addListener(onTabActivated);
api.windows.onFocusChanged.addListener(updateActiveTabs);
api.cookies.onChanged.addListener(onCookieChanged);
api.storage.onChanged.addListener(onSettingsChanged);
api.commands.onCommand.addListener(onCommand);
api.runtime.onInstalled.addListener(onInstalled);
api.permissions.onAdded.addListener(updateActiveTabs);

updateActiveTabs();
