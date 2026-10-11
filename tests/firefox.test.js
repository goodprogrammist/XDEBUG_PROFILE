// End-to-end tests in Firefox via WebDriver (geckodriver): the built addon is installed as temporary.
// Run: npm run test:firefox (needs Firefox; geckodriver is found or downloaded by Selenium Manager)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Builder, By } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const { Select } = require('selenium-webdriver/lib/select');
const { SITE, OTHER_SITE, startServer, eventually } = require('./helpers');

const ADDON_ID = 'XDEBUG_PROFILE_cookie_setup@goodprogrammist.ru';
// Fixed internal UUID, so extension pages have a known moz-extension:// URL
const ADDON_UUID = '3e0c1f0a-6b1d-4a52-9d6c-7a5b0f1c2d3e';
const BASE = `moz-extension://${ADDON_UUID}/`;

function findPackage() {
    const dir = path.resolve(__dirname, '..', 'web-ext-artifacts');
    const zip = fs.readdirSync(dir).find(f => f.endsWith('.zip'));
    assert.ok(zip, 'run `npm run build` first');
    return path.join(dir, zip);
}

describe('Firefox', () => {
    let server, driver, siteHandle, popupHandle, siteTabId;

    // Runs a function in the extension page context (the current tab must be an extension page)
    async function inExtension(fnSource, arg) {
        const json = await driver.executeAsyncScript(`
            const done = arguments[arguments.length - 1];
            const win = window.wrappedJSObject || window;
            const fn = new win.Function('arg', ${JSON.stringify('return (' + fnSource + ')(arg)')});
            Promise.resolve(fn(${JSON.stringify(arg === undefined ? null : arg)})).then(
                r => done(JSON.stringify(r === undefined ? null : r)),
                e => done(JSON.stringify({ __error: String(e) }))
            );
        `);
        const result = JSON.parse(json);
        if (result && result.__error) {
            throw new Error(result.__error);
        }
        return result;
    }

    async function sitePageText() {
        await driver.switchTo().window(siteHandle);
        await driver.navigate().refresh();
        const text = await driver.findElement(By.css('body')).getText();
        await driver.switchTo().window(popupHandle);
        return text;
    }

    async function openPopup(tabId = siteTabId) {
        await driver.switchTo().window(popupHandle);
        await driver.get(`${BASE}popup.html?tabId=${tabId}`);
        await eventually(async () => {
            const rows = await driver.findElements(By.css('.trigger input'));
            assert.ok(rows.length > 0 || await isVisible('.unsupported'));
        });
    }

    async function isVisible(selector) {
        const elements = await driver.findElements(By.css(selector));
        return elements.length > 0 && await elements[0].isDisplayed();
    }

    const badge = () => inExtension('id => api.action.getBadgeText({ tabId: id })', siteTabId);
    const cookies = name => inExtension(
        'n => api.cookies.getAll({ name: n, firstPartyDomain: null }).then(list => list.map(c => c.domain + "=" + c.value))', name);
    const select = async (selector, value) => {
        await new Select(await driver.findElement(By.css(selector))).selectByValue(value);
    };

    before(async () => {
        server = await startServer();
        const options = new firefox.Options()
            .addArguments('-headless')
            .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: ADDON_UUID }))
            // Test hosts are resolved to 127.0.0.1
            .setPreference('network.dns.localDomains', 'app.example.co.uk,other.example.co.uk')
            .setPreference('dom.security.https_first', false)
            .setPreference('dom.security.https_first_schemeless', false);
        driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
        const caps = await driver.getCapabilities();
        console.log('[test] Firefox', caps.get('browserVersion'));

        await driver.installAddon(findPackage(), true);
        siteHandle = await driver.getWindowHandle();
        await driver.get(SITE);
        await driver.switchTo().newWindow('tab');
        popupHandle = await driver.getWindowHandle();
        await driver.get(BASE + 'options.html');
        siteTabId = await eventually(async () => {
            const tabs = await inExtension('() => api.tabs.query({ url: "http://app.example.co.uk/*" })');
            assert.equal(tabs.length, 1);
            return tabs[0].id;
        });
        console.log('[test] site tab id', siteTabId);
        await openPopup();
    });

    after(async () => {
        if (driver) {
            await driver.quit();
        }
        server.close();
    });

    it('runs as Firefox and has host permission', async () => {
        assert.equal(await inExtension('() => typeof api.runtime.getBrowserInfo'), 'function');
        assert.equal(await inExtension('() => hasHostPermission()'), true);
        assert.ok(!await isVisible('.no-permission'));
    });

    it('shows three triggers', async () => {
        const labels = [];
        for (const el of await driver.findElements(By.css('.trigger-label'))) {
            labels.push(await el.getText());
        }
        assert.deepEqual(labels, ['Debug', 'Profile', 'Trace']);
    });

    it('toggles profile cookie and badge', async () => {
        await driver.findElement(By.css('.trigger input[data-trigger=profile]')).click();
        await eventually(async () => assert.match(await sitePageText(), /XDEBUG_PROFILE=Y/));
        await eventually(async () => assert.equal(await badge(), 'P'));
    });

    it('sets cookie for parent domain', async () => {
        await select('.scope', 'example.co.uk');
        await eventually(async () => assert.deepEqual(await cookies('XDEBUG_PROFILE'), ['.example.co.uk=Y']));
        await driver.switchTo().window(siteHandle);
        await driver.get(OTHER_SITE);
        assert.match(await driver.findElement(By.css('body')).getText(), /XDEBUG_PROFILE=Y/);
        await driver.get(SITE);
        await openPopup();
    });

    it('rolls back when the browser rejects public suffix domain', async () => {
        await select('.scope', 'co.uk');
        await eventually(async () => assert.ok(await isVisible('.error')));
        console.log('[test] error:', await driver.findElement(By.css('.error')).getText());
        assert.deepEqual(await cookies('XDEBUG_PROFILE'), ['.example.co.uk=Y']);
        await select('.scope', '');
        await eventually(async () => assert.deepEqual(await cookies('XDEBUG_PROFILE'), ['app.example.co.uk=Y']));
    });

    it('debug cookie with global and per-site IDE key', async () => {
        await openPopup();
        await driver.findElement(By.css('.trigger input[data-trigger=debug]')).click();
        await eventually(async () => assert.match(await sitePageText(), /XDEBUG_SESSION=vsc/));
        await openPopup();
        await driver.findElement(By.css('.trigger-ide')).click();
        await select('.site-ide', 'PHPSTORM');
        await eventually(async () => assert.match(await sitePageText(), /XDEBUG_SESSION=PHPSTORM/));
        await openPopup();
        await select('.site-ide', '');
        await eventually(async () => assert.match(await sitePageText(), /XDEBUG_SESSION=vsc/));
        await eventually(async () => assert.equal(await badge(), 'DP'));
    });

    it('turns cookies off', async () => {
        await openPopup();
        await driver.findElement(By.css('.trigger input[data-trigger=debug]')).click();
        await eventually(async () => assert.doesNotMatch(await sitePageText(), /XDEBUG_SESSION/));
        await openPopup();
        await driver.findElement(By.css('.trigger input[data-trigger=profile]')).click();
        await eventually(async () => assert.doesNotMatch(await sitePageText(), /XDEBUG_PROFILE/));
        await eventually(async () => assert.equal(await badge(), ''));
    });

    it('options page: IDE choice is saved', async () => {
        await driver.get(BASE + 'options.html');
        await eventually(async () => assert.ok(await isVisible('.trigger-ide')));
        assert.ok(await isVisible('.welcome-row'));
        await select('.trigger-ide', 'PHPSTORM');
        await driver.findElement(By.css('button[type=submit]')).click();
        await eventually(async () => assert.equal(
            (await inExtension('() => api.storage.sync.get("cookie_XDEBUG_SESSION_value")')).cookie_XDEBUG_SESSION_value, 'PHPSTORM'));
        assert.ok(!await isVisible('.welcome-row'));
    });

    it('shows unsupported message on browser pages', async () => {
        await driver.switchTo().window(siteHandle);
        await driver.get('about:blank');
        // The site tab now shows about:blank
        await openPopup(siteTabId);
        assert.ok(await isVisible('.unsupported'));
    });
});
