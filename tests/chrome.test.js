// End-to-end tests in Chromium: the unpacked addon is loaded into a real browser.
// Run: npm run test:chrome (CHROMIUM_PATH can point to a custom Chromium binary)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { SITE, OTHER_SITE, startServer, eventually } = require('./helpers');

const EXT_DIR = path.resolve(__dirname, '..');

async function launch(lang, extraArgs) {
    const args = [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        '--host-resolver-rules=MAP * 127.0.0.1',
        // Extensions work only in the new headless mode
        '--headless=new'
    ];
    if (lang) {
        args.push('--lang=' + lang);
    }
    args.push(...(extraArgs || []));
    const context = await chromium.launchPersistentContext('', {
        executablePath: process.env.CHROMIUM_PATH || undefined,
        headless: false,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: args,
        locale: lang || 'en-US'
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2];
    console.log('[test] extension id', extensionId, 'lang', lang || 'default');
    // The addon opens options page after install: Chrome may reuse a fresh blank tab for it,
    // so tests open their pages only after that
    await eventually(() => assert.ok(context.pages().some(p => p.url().includes('options'))), 10000);
    return { context, worker, extensionId };
}

describe('Chromium', () => {
    let server, context, worker, extensionId, site, popup, siteTabId;
    const errors = [];

    const pageText = async (page = site) => {
        await page.reload();
        return page.textContent('body');
    };
    const badge = () => worker.evaluate(tabId => api.action.getBadgeText({ tabId }), siteTabId);
    const cookieDomains = name => worker.evaluate(n => api.cookies.getAll({ name: n }), name)
        .then(cookies => cookies.map(c => c.domain + '=' + c.value));
    const openPopup = async () => {
        await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${siteTabId}`);
        await popup.waitForSelector('.trigger input');
    };

    before(async () => {
        server = await startServer();
        ({ context, worker, extensionId } = await launch());
        site = await context.newPage();
        await site.goto(SITE);
        siteTabId = await worker.evaluate(async () => (await api.tabs.query({ url: 'http://app.example.co.uk/*' }))[0].id);
        popup = await context.newPage();
        popup.on('console', m => m.type() === 'error' && errors.push(m.text()));
        await openPopup();
    });

    after(async () => {
        console.log('[test] console errors:', errors);
        await context.close();
        server.close();
    });

    it('opens options page after install', async () => {
        const urls = context.pages().map(p => p.url());
        assert.ok(urls.some(u => u.includes('options')), 'pages: ' + urls.join(', '));
    });

    it('keyboard shortcuts are assigned (not reserved by Chrome)', async () => {
        const commands = await worker.evaluate(() => api.commands.getAll());
        const shortcuts = Object.fromEntries(commands.map(c => [c.name, c.shortcut]));
        console.log('[test] shortcuts', shortcuts);
        assert.equal(shortcuts._execute_action, 'Alt+Shift+K');
        assert.equal(shortcuts['toggle-profile'], 'Alt+Shift+F');
        assert.equal(shortcuts['toggle-debug'], 'Alt+Shift+D');
    });

    it('has host permission and shows three triggers', async () => {
        assert.ok(await popup.isHidden('.no-permission'));
        const rows = await popup.$$eval('.trigger', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
        assert.deepEqual(rows, [
            'Debug VS Code (vsc) XDEBUG_SESSION=vsc',
            'Profile XDEBUG_PROFILE=Y',
            'Trace XDEBUG_TRACE=Y'
        ]);
    });

    it('popup opened as a tab (as on Firefox for Android) works for the last used site tab', async () => {
        await site.bringToFront();
        const asTab = await context.newPage();
        await asTab.goto(`chrome-extension://${extensionId}/popup.html`);
        await eventually(async () => assert.equal(await asTab.textContent('.host'), 'app.example.co.uk'));
        await asTab.waitForSelector('.trigger input');
        assert.ok(await asTab.isHidden('.unsupported'));
        await asTab.close();
    });

    it('toggles profile cookie and badge', async () => {
        await popup.check('.trigger input[data-trigger=profile]');
        // Popup sets the cookie asynchronously after the click
        await eventually(async () => assert.match(await pageText(), /XDEBUG_PROFILE=Y/));
        await eventually(async () => assert.equal(await badge(), 'P'));
    });

    it('sets cookie for parent domain and subdomains', async () => {
        await popup.selectOption('.scope', 'example.co.uk');
        await eventually(async () => assert.deepEqual(await cookieDomains('XDEBUG_PROFILE'), ['.example.co.uk=Y']));
        const other = await context.newPage();
        await other.goto(OTHER_SITE);
        assert.match(await other.textContent('body'), /XDEBUG_PROFILE=Y/);
        await other.close();
    });

    it('rolls back when the browser rejects public suffix domain', async () => {
        await popup.selectOption('.scope', 'co.uk');
        await eventually(async () => assert.notEqual(await popup.textContent('.error'), ''));
        assert.deepEqual(await cookieDomains('XDEBUG_PROFILE'), ['.example.co.uk=Y']);
        assert.equal(await popup.inputValue('.scope'), 'example.co.uk');
        await popup.selectOption('.scope', '');
        await eventually(async () => assert.deepEqual(await cookieDomains('XDEBUG_PROFILE'), ['app.example.co.uk=Y']));
    });

    it('toggles debug cookie by keyboard command', async () => {
        await site.bringToFront();
        await worker.evaluate(() => onCommand('toggle-debug'));
        assert.match(await pageText(), /XDEBUG_SESSION=vsc/);
        await eventually(async () => assert.equal(await badge(), 'DP'));
    });

    it('updates badge after external cookie removal', async () => {
        await worker.evaluate(() => api.cookies.remove({ url: 'http://app.example.co.uk/', name: 'XDEBUG_SESSION' }));
        await eventually(async () => assert.equal(await badge(), 'P'));
    });

    it('uses per-site IDE key', async () => {
        await openPopup();
        await popup.check('.trigger input[data-trigger=debug]');
        await eventually(async () => assert.match(await pageText(), /XDEBUG_SESSION=vsc/));
        await popup.click('.trigger-ide');
        assert.ok(await popup.isVisible('.site-ide'));
        await popup.selectOption('.site-ide', 'PHPSTORM');
        // Enabled debug cookie is re-set with the site key
        await eventually(async () => assert.match(await pageText(), /XDEBUG_SESSION=PHPSTORM/));
        await popup.waitForSelector('.trigger-ide');
        assert.match(await popup.textContent('.trigger-ide'), /PhpStorm \(PHPSTORM\) - for this site/);

        await popup.selectOption('.site-ide', '__custom__');
        await popup.fill('.site-ide-custom', 'VSCODE');
        await popup.click('.site-ide-custom-row button');
        await eventually(async () => assert.match(await pageText(), /XDEBUG_SESSION=VSCODE/));

        // Other sites still use the global key
        const other = await context.newPage();
        await other.goto(OTHER_SITE);
        const otherTabId = await worker.evaluate(async () => (await api.tabs.query({ url: 'http://other.example.co.uk/*' }))[0].id);
        await worker.evaluate(id => api.tabs.update(id, { active: true }), otherTabId);
        await worker.evaluate(() => onCommand('toggle-debug'));
        await other.reload();
        assert.match(await other.textContent('body'), /XDEBUG_SESSION=vsc/);
        await worker.evaluate(() => onCommand('toggle-debug'));
        await other.close();

        await openPopup();
        await popup.selectOption('.site-ide', '');
        await eventually(async () => assert.match(await pageText(), /XDEBUG_SESSION=vsc/));
        await popup.uncheck('.trigger input[data-trigger=debug]');
        await eventually(async () => assert.doesNotMatch(await pageText(), /XDEBUG_SESSION/));
    });

    it('options: IDE choice, custom key and rename cleanup', async () => {
        const options = await context.newPage();
        options.on('console', m => m.type() === 'error' && errors.push('options: ' + m.text()));
        await options.goto(`chrome-extension://${extensionId}/options.html`);
        await options.waitForSelector('.trigger-name');
        assert.ok(await options.isHidden('.permission-row'));
        assert.ok(await options.isVisible('.welcome-row'));
        assert.equal(await options.inputValue('.trigger-ide'), 'vsc');
        assert.ok(await options.isHidden('.trigger-value[data-key=cookie_XDEBUG_SESSION]'));

        await options.selectOption('.trigger-ide', '');
        await options.fill('.trigger-value[data-key=cookie_XDEBUG_SESSION]', 'VSCODE');
        await options.fill('.trigger-name[data-key=cookie_XDEBUG_PROFILE]', 'XDEBUG_TRIGGER');
        await options.click('button[type=submit]');
        await eventually(async () => assert.ok(await options.isVisible('.saved-successfully')));
        assert.ok(await options.isHidden('.welcome-row'));

        // Old XDEBUG_PROFILE cookie is removed after rename
        await eventually(async () => assert.doesNotMatch(await pageText(), /XDEBUG_PROFILE/));

        await options.reload();
        await options.waitForSelector('.trigger-name');
        assert.equal(await options.inputValue('.trigger-ide'), '');
        assert.equal(await options.inputValue('.trigger-value[data-key=cookie_XDEBUG_SESSION]'), 'VSCODE');

        // Restore defaults
        await options.selectOption('.trigger-ide', 'vsc');
        await options.fill('.trigger-name[data-key=cookie_XDEBUG_PROFILE]', 'XDEBUG_PROFILE');
        await options.click('button[type=submit]');
        await eventually(async () => assert.equal(
            (await worker.evaluate(() => api.storage.sync.get('cookie_XDEBUG_SESSION_value'))).cookie_XDEBUG_SESSION_value, 'vsc'));
        await options.close();
    });

    it('options: invalid and duplicate cookie names are not saved', async () => {
        const options = await context.newPage();
        await options.goto(`chrome-extension://${extensionId}/options.html`);
        await options.waitForSelector('.trigger-name');
        const stored = () => worker.evaluate(() => api.storage.sync.get(null));
        const before = await stored();

        await options.fill('.trigger-name[data-key=cookie_XDEBUG_TRACE]', 'XDEBUG TRACE');
        await options.click('button[type=submit]');
        await eventually(async () => assert.match(await options.textContent('.saved-error'), /XDEBUG TRACE/));
        assert.ok(await options.isVisible('.saved-error'));
        assert.equal(await options.getAttribute('.trigger-name[data-key=cookie_XDEBUG_TRACE]', 'class'), 'trigger-name invalid');

        await options.fill('.trigger-name[data-key=cookie_XDEBUG_TRACE]', 'XDEBUG_PROFILE');
        await options.click('button[type=submit]');
        await eventually(async () => assert.match(await options.textContent('.saved-error'), /twice: "XDEBUG_PROFILE"/));

        await options.fill('.trigger-name[data-key=cookie_XDEBUG_TRACE]', 'XDEBUG_TRACE');
        await options.fill('.trigger-value[data-key=cookie_XDEBUG_PROFILE]', 'a;b');
        await options.click('button[type=submit]');
        await eventually(async () => assert.match(await options.textContent('.saved-error'), /"a;b"/));
        assert.deepEqual(await stored(), before, 'invalid options must not be saved');

        await options.fill('.trigger-value[data-key=cookie_XDEBUG_PROFILE]', 'Y');
        await options.click('button[type=submit]');
        await eventually(async () => assert.ok(await options.isVisible('.saved-successfully')));
        assert.equal(await options.$$eval('.invalid', els => els.length), 0);
        await options.close();
    });

    it('popup: invalid custom IDE key is rejected', async () => {
        await openPopup();
        await popup.click('.trigger-ide');
        await popup.selectOption('.site-ide', '__custom__');
        await popup.fill('.site-ide-custom', 'my key');
        await popup.click('.site-ide-custom-row button');
        await eventually(async () => assert.match(await popup.textContent('.error'), /"my key"/));
        assert.equal(await worker.evaluate(() => getSiteIdeKey('app.example.co.uk')), '');
    });

    it('shows unsupported message on browser pages', async () => {
        // Without the "tabs" permission non-http tabs can't be found by URL, so the site tab is reused
        await site.goto('about:blank');
        await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${siteTabId}`);
        await eventually(async () => assert.ok(await popup.isVisible('.unsupported')));
    });

    it('has no unexpected console errors', () => {
        // The public suffix rejection is expected and logged by popup
        const unexpected = errors.filter(e => !e.includes('scope change failed'));
        assert.deepEqual(unexpected, []);
    });
});

for (const [lang, debugLabel, settingsLabel] of [['ru', 'Отладка', 'Настройки'], ['kk', 'Жөндеу', 'Баптаулар']]) {
    describe('Chromium UI language: ' + lang, () => {
        let server, context, extensionId;

        before(async () => {
            server = await startServer();
            ({ context, extensionId } = await launch(lang));
        });

        after(async () => {
            await context.close();
            server.close();
        });

        it('popup and options are translated', async () => {
            const site = await context.newPage();
            await site.goto(SITE);
            const page = await context.newPage();
            const worker = context.serviceWorkers()[0];
            const tabId = await worker.evaluate(async () => (await api.tabs.query({ url: 'http://app.example.co.uk/*' }))[0].id);
            await page.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
            await page.waitForSelector('.trigger input');
            assert.equal(await page.textContent('.trigger[class] .trigger-label'), debugLabel);
            assert.equal(await page.textContent('.open-options'), settingsLabel);
            await eventually(async () => {
                const title = await worker.evaluate(id => api.action.getTitle({ tabId: id }), tabId);
                console.log('[test]', lang, 'action title:', title);
                assert.match(title, /^Xdebug: /);
            });
        });
    });
}

describe('Chromium incognito', () => {
    let server, context, extensionId;

    before(async () => {
        server = await startServer();
        // Incognito tries https:// first (HTTPS-First mode) and the http-only test server makes
        // the page load wait for that attempt; Playwright's own HttpsUpgrades switch is kept
        ({ context, extensionId } = await launch(undefined, ['--disable-features=HttpsUpgrades,HttpsFirstModeIncognito']));
    });

    after(async () => {
        await context.close();
        server.close();
    });

    it('works in incognito after the user allows it (own cookie store)', async () => {
        // Same switches as on chrome://extensions: developer mode (unpacked addon) and "Allow in Incognito"
        const page = await context.newPage();
        await page.goto('chrome://extensions/');
        const info = id => page.evaluate(i => new Promise(r => chrome.developerPrivate.getExtensionInfo(i, r)), id);
        assert.equal((await info(extensionId)).incognitoAccess.isActive, false, 'not allowed in incognito by default');
        await page.evaluate(() => new Promise(r => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, r)));
        await page.evaluate(id => new Promise(r => chrome.developerPrivate.updateExtensionConfiguration(
            { extensionId: id, incognitoAccess: true }, r)), extensionId);
        await eventually(async () => assert.equal((await info(extensionId)).state, 'ENABLED'), 10000);

        // The addon is reloaded, its functions are called from an extension page
        const extPage = await context.newPage();
        await eventually(() => extPage.goto(`chrome-extension://${extensionId}/options.html`), 10000);
        const result = await extPage.evaluate(async site => {
            const win = await api.windows.create({ incognito: true, url: site });
            let tab;
            for (let i = 0; i < 50; i++) {
                tab = (await api.tabs.query({ windowId: win.id }))[0];
                // A new window first reports "complete" for about:blank, so wait for the site itself
                if (tab.status === 'complete' && tab.url === site) {
                    break;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            const count = async storeId => (await api.cookies.getAll({ name: 'XDEBUG_PROFILE', storeId: storeId })).length;
            const out = { incognito: tab.incognito, store: await getStoreId(tab) };
            out.enabled = await toggleTrigger(tab, 'profile');
            out.inIncognito = await count('1');
            out.inNormal = await count('0');
            out.disabled = await toggleTrigger(tab, 'profile');
            out.afterOff = await count('1');
            await api.windows.remove(win.id);
            return out;
        }, SITE);
        assert.deepEqual(result, { incognito: true, store: '1', enabled: true, inIncognito: 1, inNormal: 0, disabled: false, afterOff: 0 });
    });
});
