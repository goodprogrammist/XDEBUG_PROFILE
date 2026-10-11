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

    // Calls a function of the extension page by its path (e.g. 'browser.tabs.query') with JSON arguments.
    // The current tab must be an extension page. CSP of extension pages forbids eval/new Function,
    // so only existing functions are called.
    async function inExtension(fnPath, ...args) {
        const json = await driver.executeAsyncScript(`
            const done = arguments[arguments.length - 1];
            const win = window.wrappedJSObject || window;
            const parts = arguments[0].split('.');
            let context = win;
            for (const part of parts.slice(0, -1)) {
                context = context[part];
            }
            const fn = context[parts[parts.length - 1]];
            Promise.resolve(fn.apply(context, win.JSON.parse(arguments[1]))).then(
                r => done(win.JSON.stringify(r === undefined ? null : r)),
                e => done(JSON.stringify({ __error: String(e) }))
            );
        `, fnPath, JSON.stringify(args));
        const result = JSON.parse(json);
        if (result && result.__error) {
            throw new Error(fnPath + ': ' + result.__error);
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
        await openExtensionPage(`${BASE}popup.html?tabId=${tabId}`);
        await eventually(async () => {
            const rows = await driver.findElements(By.css('.trigger input'));
            assert.ok(rows.length > 0 || await isVisible('.unsupported'));
        });
    }

    // WebDriver can't navigate content to moz-extension:// URLs, so the page is loaded
    // from the browser (chrome) context with the system principal
    async function openExtensionPage(url) {
        await driver.setContext(firefox.Context.CHROME);
        await driver.executeScript(`
            const win = Services.wm.getMostRecentWindow('navigator:browser');
            win.gBrowser.selectedBrowser.fixupAndLoadURIString(arguments[0], {
                triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
            });`, url);
        await driver.setContext(firefox.Context.CONTENT);
        await eventually(async () => assert.equal(await driver.getCurrentUrl(), url));
        await eventually(async () => assert.equal(await driver.executeScript('return document.readyState'), 'complete'));
    }

    async function isVisible(selector) {
        const elements = await driver.findElements(By.css(selector));
        return elements.length > 0 && await elements[0].isDisplayed();
    }

    const badge = () => inExtension('browser.action.getBadgeText', { tabId: siteTabId });
    const cookies = async name => (await inExtension('browser.cookies.getAll', { name: name, firstPartyDomain: null }))
        .map(c => c.domain + '=' + c.value);
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
            .setPreference('dom.security.https_first_schemeless', false)
            // Direct connection: test hosts must not go through a system proxy
            .setPreference('network.proxy.type', 0);
        // Custom Firefox / geckodriver, otherwise they are found by Selenium Manager
        if (process.env.FIREFOX_PATH) {
            options.setBinary(process.env.FIREFOX_PATH);
        }
        // --allow-system-access: needed for the chrome context used by openExtensionPage()
        const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_PATH || undefined)
            .addArguments('--allow-system-access');
        driver = await new Builder().forBrowser('firefox')
            .setFirefoxOptions(options)
            .setFirefoxService(service)
            .build();
        const caps = await driver.getCapabilities();
        console.log('[test] Firefox', caps.get('browserVersion'));

        await driver.installAddon(findPackage(), true);
        // The addon opens its options (about:addons) after install and Firefox may reuse
        // the current blank tab for it, so the site is opened in a new tab after that
        await eventually(async () => {
            let found = false;
            for (const handle of await driver.getAllWindowHandles()) {
                await driver.switchTo().window(handle);
                found = found || (await driver.getCurrentUrl()).startsWith('about:addons');
            }
            assert.ok(found, 'options page is not opened yet');
        }, 10000);
        await driver.switchTo().newWindow('tab');
        siteHandle = await driver.getWindowHandle();
        await driver.get(SITE);
        await driver.switchTo().newWindow('tab');
        popupHandle = await driver.getWindowHandle();
        await openExtensionPage(BASE + 'options.html');
        siteTabId = await eventually(async () => {
            const tabs = await inExtension('browser.tabs.query', { url: 'http://app.example.co.uk/*' });
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
        assert.equal((await inExtension('browser.runtime.getBrowserInfo')).name, 'Firefox');
        assert.equal(await inExtension('hasHostPermission'), true);
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
        await openExtensionPage(BASE + 'options.html');
        await eventually(async () => assert.ok(await isVisible('.trigger-ide')));
        assert.ok(await isVisible('.welcome-row'));
        await select('.trigger-ide', 'PHPSTORM');
        await driver.findElement(By.css('button[type=submit]')).click();
        await eventually(async () => assert.equal(
            (await inExtension('browser.storage.sync.get', 'cookie_XDEBUG_SESSION_value')).cookie_XDEBUG_SESSION_value, 'PHPSTORM'));
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
