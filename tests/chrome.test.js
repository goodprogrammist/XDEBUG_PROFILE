// End-to-end tests in Chromium: the unpacked addon is loaded into a real browser.
// Run: npm run test:chrome (CHROMIUM_PATH can point to a custom Chromium binary)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { SITE, OTHER_SITE, startServer, eventually } = require('./helpers');

const EXT_DIR = path.resolve(__dirname, '..');

async function launch(lang) {
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

    it('has host permission and shows three triggers', async () => {
        assert.ok(await popup.isHidden('.no-permission'));
        const rows = await popup.$$eval('.trigger', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
        assert.deepEqual(rows, [
            'Debug VS Code (vsc) XDEBUG_SESSION=vsc',
            'Profile XDEBUG_PROFILE=Y',
            'Trace XDEBUG_TRACE=Y'
        ]);
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

    it('shows unsupported message on browser pages', async () => {
        const blank = await context.newPage();
        await blank.goto('about:blank');
        const blankTabId = await worker.evaluate(async () => (await api.tabs.query({ url: 'about:blank' }))[0].id);
        await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${blankTabId}`);
        await eventually(async () => assert.ok(await popup.isVisible('.unsupported')));
        await blank.close();
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
