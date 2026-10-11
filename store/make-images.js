// Generates store images from the real addon UI: node store/make-images.js
// Screenshots 1280x800 (en, ru) and small promo tile 440x280 (Chrome Web Store requirements).
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { SITE, startServer, eventually } = require('../tests/helpers');

const EXT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'images');

const CAPTIONS = {
    en: {
        popup: ['Toggle Xdebug with one click', 'Debug, Profile and Trace cookies for the current site, badge shows what is on.'],
        site: ['Per-site settings', 'Cookie for the host or the whole domain, own IDE key for the site.'],
        options: ['Choose your IDE', 'VS Code, PhpStorm, NetBeans, Eclipse, MacGDBp or a custom IDE key.']
    },
    ru: {
        popup: ['Xdebug в один клик', 'Cookie для отладки, профилирования и трассировки текущего сайта, бейдж показывает, что включено.'],
        site: ['Настройки для сайта', 'Cookie для хоста или всего домена, свой IDE key для сайта.'],
        options: ['Выберите свою IDE', 'VS Code, PhpStorm, NetBeans, Eclipse, MacGDBp или свой IDE key.']
    }
};

async function launch(lang) {
    const context = await chromium.launchPersistentContext('', {
        executablePath: process.env.CHROMIUM_PATH || undefined,
        headless: false,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`,
            '--host-resolver-rules=MAP * 127.0.0.1', '--headless=new', '--lang=' + lang],
        locale: lang,
        deviceScaleFactor: 2
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await eventually(() => {
        if (!context.pages().some(p => p.url().includes('options'))) {
            throw new Error('options page is not opened yet');
        }
    }, 10000);
    return { context, worker, extensionId: worker.url().split('/')[2] };
}

const dataUrl = buffer => 'data:image/png;base64,' + buffer.toString('base64');

function frameHtml(title, text, image, imageWidth, host, badge, full) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        body { margin: 0; width: 1280px; height: 800px; font-family: system-ui, sans-serif;
               background: linear-gradient(135deg, #1f2a44, #3b4f7a); color: #fff; display: flex; align-items: center; }
        .text { width: 440px; padding: 0 40px 0 70px; }
        h1 { font-size: 44px; margin: 0 0 20px; line-height: 1.15; }
        p { font-size: 22px; line-height: 1.45; opacity: .85; margin: 0; }
        .window { width: 700px; background: #f9f9fb; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
        .bar { height: 44px; background: #e5e5ea; display: flex; align-items: center; padding: 0 14px; gap: 10px; color: #333; font-size: 15px; }
        .url { flex: 1; background: #fff; border-radius: 6px; padding: 6px 12px; }
        .icon { position: relative; width: 26px; height: 26px; }
        .icon img { width: 26px; height: 26px; }
        .badge { position: absolute; right: -8px; bottom: -6px; background: #c0392b; color: #fff; font-size: 11px; font-weight: 700; border-radius: 7px; padding: 0 4px; }
        .content { height: 560px; position: relative; background: #fff; }
        .shot { position: absolute; right: 16px; top: 0; width: ${imageWidth}px; border: 1px solid #ccc; border-radius: 0 0 8px 8px; box-shadow: 0 8px 24px rgba(0,0,0,.2); }
        .shot.full { position: static; width: 100%; border: 0; box-shadow: none; }
    </style></head><body>
        <div class="text"><h1>${title}</h1><p>${text}</p></div>
        <div class="window">
            <div class="bar"><div class="url">${host}</div>
                <div class="icon"><img src="${dataUrl(fs.readFileSync(path.join(EXT_DIR, 'icons', badge ? 'bug-red-32.png' : 'bug-light-32.png')))}">${badge ? `<span class="badge">${badge}</span>` : ''}</div></div>
            <div class="content"><img class="shot ${full ? 'full' : ''}" src="${image}"></div>
        </div>
    </body></html>`;
}

async function render(context, html, file, width, height) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    // deviceScaleFactor 2 is used for crisp UI shots, store images must have exact size
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width, height }, scale: 'css' });
    fs.writeFileSync(path.join(OUT_DIR, file), shot);
    console.log('[images] written', file);
    await page.close();
}

async function makeForLanguage(lang) {
    const { context, worker, extensionId } = await launch(lang);
    const site = await context.newPage();
    await site.goto(SITE);
    const tabId = await worker.evaluate(async () => (await api.tabs.query({ url: 'http://app.example.co.uk/*' }))[0].id);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 300, height: 400 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
    await popup.waitForSelector('.trigger input');
    await popup.check('.trigger input[data-trigger=debug]');
    await popup.waitForTimeout(300);
    await popup.check('.trigger input[data-trigger=profile]');
    await popup.waitForTimeout(300);
    const popupShot = await popup.locator('body').screenshot();

    await popup.selectOption('.scope', 'example.co.uk');
    await popup.waitForTimeout(300);
    await popup.click('.trigger-ide');
    await popup.selectOption('.site-ide', 'PHPSTORM');
    // The per-site IDE row stays open while a site key is set
    await popup.waitForTimeout(500);
    const siteShot = await popup.locator('body').screenshot();

    const options = await context.newPage();
    await options.setViewportSize({ width: 1000, height: 800 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForSelector('.trigger-ide');
    const optionsShot = await options.screenshot({ clip: { x: 0, y: 0, width: 1000, height: 800 } });

    const c = CAPTIONS[lang];
    await render(context, frameHtml(c.popup[0], c.popup[1], dataUrl(popupShot), 300, 'app.example.co.uk', 'DP'), `screenshot-1-popup-${lang}.png`, 1280, 800);
    await render(context, frameHtml(c.site[0], c.site[1], dataUrl(siteShot), 300, 'app.example.co.uk', 'DP'), `screenshot-2-site-${lang}.png`, 1280, 800);
    await render(context, frameHtml(c.options[0], c.options[1], dataUrl(optionsShot), 700, 'Xdebug Cookies', '', true), `screenshot-3-options-${lang}.png`, 1280, 800);

    if (lang === 'en') {
        const icon = dataUrl(fs.readFileSync(path.join(EXT_DIR, 'icons', 'bug-red-128.png')));
        await render(context, `<!doctype html><html><head><meta charset="utf-8"><style>
            body { margin: 0; width: 440px; height: 280px; display: flex; align-items: center; gap: 22px; padding: 0 30px; box-sizing: border-box;
                   font-family: system-ui, sans-serif; background: linear-gradient(135deg, #1f2a44, #3b4f7a); color: #fff; }
            img { width: 110px; height: 110px; }
            h1 { font-size: 30px; margin: 0 0 10px; }
            p { margin: 0; font-size: 17px; opacity: .85; line-height: 1.4; }
        </style></head><body><img src="${icon}"><div><h1>Xdebug Cookies</h1><p>Debug · Profile · Trace<br>Chrome &amp; Firefox</p></div></body></html>`,
        'promo-small-440x280.png', 440, 280);
    }
    await context.close();
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const server = await startServer();
    for (const lang of ['en', 'ru']) {
        await makeForLanguage(lang);
    }
    server.close();
})().catch(e => {
    console.error('[images] failed', e);
    process.exit(1);
});
