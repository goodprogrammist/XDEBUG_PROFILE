let cookieName = 'XDEBUG_PROFILE';
let currentTab;

async function updateIcon() {
    let cookie = await getCookie();
    let icons = await getIcons(cookie);

    browser.browserAction.setIcon({
        path: icons,
        tabId: currentTab.id
    });
    browser.browserAction.setTitle({
        title: cookie ? 'XDEBUG_PROFILE cookie (on)' : 'XDEBUG_PROFILE cookie (off)',
        tabId: currentTab.id
    });
}

async function toggleCookie() {
    let cookie = await getCookie();
    let currentUrl = currentTab.url;
    let cookieName = await getValueToSet();
    if (cookie) {
        browser.cookies.remove({
            url: currentUrl.replace(/:{1}[0-9]{1}\d*/, ''),
            name: cookieName,
            storeId: currentTab.cookieStoreId
        });
        updateIcon();
        return null;
    }
    browser.cookies.set({
        url: currentUrl.replace(/:{1}[0-9]{1}\d*/, ''),
        name: cookieName,
        value: "Y",
        path: "/",
        storeId: currentTab.cookieStoreId
    });
    updateIcon();
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

async function getValueToSet() {
    let config = await browser.storage.sync.get('cookie_XDEBUG_PROFILE');

    return config.cookie_XDEBUG_PROFILE || 'XDEBUG_PROFILE';
}

async function getCookie() {
    let currentUrl = currentTab.url;
    let cookieName = await getValueToSet();

    let cookie = await browser.cookies.get({
        url: currentUrl.replace(/:{1}[0-9]{1}\d*/, ''),
        name: cookieName,
        storeId: currentTab.cookieStoreId
    });

    if (cookie && cookie.value == "Y") {
        return cookie;
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

updateActiveTab();

browser.browserAction.onClicked.addListener(toggleCookie);
browser.tabs.onUpdated.addListener(updateActiveTab);
browser.tabs.onActivated.addListener(updateActiveTab);
browser.windows.onFocusChanged.addListener(updateActiveTab);