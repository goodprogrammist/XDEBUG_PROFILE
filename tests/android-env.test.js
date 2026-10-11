// Background script and API helpers in reduced environments, without a browser.
// Firefox for Android has no windows and commands APIs (@mdn/browser-compat-data:
// webextensions.api.windows / commands - firefox_android: false), other browsers may lack other APIs.
// Run: node --test tests/android-env.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function event(name, registered) {
    return { addListener: () => registered.push(name) };
}

// Loads common.js (+ background.js) into a sandbox with the given `browser` object
function load(browser, files) {
    const errors = [];
    const context = vm.createContext({
        browser: browser,
        console: { debug: () => {}, warn: () => {}, error: (...args) => errors.push(args.map(String).join(' ')) },
        URL: URL
    });
    context.globalThis = context;
    for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
    }
    return { context, errors };
}

// Firefox for Android: everything except windows and commands
function androidBrowser(registered, calls) {
    return {
        runtime: { getBrowserInfo: async () => ({ name: 'Firefox' }), onInstalled: event('runtime.onInstalled', registered), openOptionsPage: async () => {} },
        i18n: { getMessage: key => key },
        tabs: { query: async () => [], get: async () => ({}), onUpdated: event('tabs.onUpdated', registered), onActivated: event('tabs.onActivated', registered) },
        cookies: { onChanged: event('cookies.onChanged', registered), getAllCookieStores: async () => [], get: async () => null },
        storage: { onChanged: event('storage.onChanged', registered), sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
        permissions: { contains: async () => true, onAdded: event('permissions.onAdded', registered), onRemoved: event('permissions.onRemoved', registered) },
        action: {
            setIcon: async () => calls.push('setIcon'),
            setTitle: async () => calls.push('setTitle'),
            setBadgeText: async () => calls.push('setBadgeText'),
            setBadgeBackgroundColor: async () => calls.push('setBadgeBackgroundColor')
        }
    };
}

test('background script starts without windows and commands APIs (Firefox for Android)', async () => {
    const registered = [];
    const { errors } = load(androidBrowser(registered, []), ['common.js', 'background.js']);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(registered.sort(), [
        'cookies.onChanged', 'permissions.onAdded', 'permissions.onRemoved', 'runtime.onInstalled',
        'storage.onChanged', 'tabs.onActivated', 'tabs.onUpdated'
    ]);
    assert.deepEqual(errors, []);
});

test('icon is updated with a partial action API and without storage.sync and permissions', async () => {
    const registered = [];
    const calls = [];
    const browser = androidBrowser(registered, calls);
    delete browser.action.setBadgeBackgroundColor;
    delete browser.permissions;
    delete browser.storage.sync;
    let localGets = 0;
    browser.storage.local.get = async () => {
        localGets++;
        return {};
    };
    const { context, errors } = load(browser, ['common.js', 'background.js']);
    // Top-level const is not a property of the context, so it is read by an expression
    assert.equal(vm.runInContext('SETTINGS_AREA', context), 'local', 'settings fall back to storage.local');
    await context.updateIcon({ id: 1, url: 'http://app.example.com/' });
    assert.deepEqual(calls, ['setIcon', 'setTitle', 'setBadgeText']);
    assert.ok(localGets > 0, 'settings are read from storage.local');
    assert.deepEqual(errors, []);
});

test('API helpers: getApi, hasApi, callApi, requireApi, addApiListener', () => {
    const registered = [];
    const browser = {
        runtime: {},
        tabs: { query: function (info) { return { self: this === browser.tabs, info: info }; }, onUpdated: event('tabs.onUpdated', registered) }
    };
    const { context } = load(browser, ['common.js']);
    assert.equal(context.hasApi('tabs.query'), true);
    assert.equal(context.hasApi('tabs.getCurrent'), false);
    assert.equal(context.hasApi('windows.onFocusChanged'), false);
    assert.equal(context.getApi('nothing.at.all'), undefined);
    // Method is called with its namespace as `this`
    assert.deepEqual(JSON.parse(JSON.stringify(context.callApi('tabs.query', [{ active: true }], 'fallback'))), { self: true, info: { active: true } });
    assert.equal(context.callApi('tabs.getCurrent', [], 'fallback'), 'fallback');
    assert.throws(() => context.requireApi('cookies.set', [{}]), /API is not available in this browser: cookies\.set/);
    assert.equal(context.addApiListener('tabs.onUpdated', () => {}), true);
    assert.equal(context.addApiListener('commands.onCommand', () => {}), false);
    assert.deepEqual(registered, ['tabs.onUpdated']);
    assert.equal(vm.runInContext('IS_FIREFOX', context), false);
});

test('toggle shows a clear error when the cookies API is missing', async () => {
    const browser = androidBrowser([], []);
    delete browser.cookies.set;
    const { context } = load(browser, ['common.js']);
    await assert.rejects(context.toggleTrigger({ id: 1, url: 'http://app.example.com/' }, 'profile'), /API is not available in this browser: cookies\.set/);
});
