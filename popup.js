let popupTab;
const CUSTOM_IDE_OPTION = '__custom__';

function showError(message) {
    let el = document.querySelector('.error');
    el.textContent = message;
    el.hidden = !message;
}

async function render() {
    // popup.html?tabId=N opens the popup for a given tab (for debugging in a regular tab)
    let debugTabId = new URLSearchParams(location.search).get('tabId');
    popupTab = debugTabId ? await callApi('tabs.get', [Number(debugTabId)], undefined) : await getActiveTab();
    let host = popupTab ? getHost(popupTab.url) : '';
    log('popup: render for', popupTab && popupTab.url);

    document.querySelector('.host').textContent = host || (popupTab && popupTab.url) || '';

    let supported = popupTab && isSupportedUrl(popupTab.url);
    let permitted = supported && await hasHostPermission();
    document.querySelector('.unsupported').hidden = !!supported;
    document.querySelector('.no-permission').hidden = !supported || permitted;
    document.querySelector('.controls').hidden = !permitted;
    if (!permitted) {
        return;
    }

    let triggers = await getTriggerSettings(host);
    let states = await getStates(popupTab);
    let container = document.querySelector('.triggers');
    let template = document.querySelector('.trigger-template');
    container.textContent = '';
    for (let trigger of triggers) {
        let row = template.content.cloneNode(true);
        let checkbox = row.querySelector('input');
        checkbox.checked = !!states[trigger.id];
        checkbox.dataset.trigger = trigger.id;
        checkbox.addEventListener('change', onTriggerChange);
        row.querySelector('.trigger-label').textContent = trigger.label;
        row.querySelector('.trigger-cookie').textContent = trigger.name + '=' + trigger.value;
        if (trigger.ide) {
            let ide = row.querySelector('.trigger-ide');
            ide.hidden = false;
            ide.textContent = getIdeLabel(trigger.value) + (trigger.siteValue ? ' - ' + t('forThisSite') : '');
            ide.title = t('changeSiteIdeTitle');
            ide.addEventListener('click', toggleSiteIdeRow);
        }
        container.appendChild(row);
    }

    let select = document.querySelector('.scope');
    let scope = await getScope(host);
    select.textContent = '';
    select.appendChild(new Option(t('scopeHostOnly', host), ''));
    for (let domain of getDomainCandidates(host)) {
        select.appendChild(new Option(t('scopeWithSubdomains', domain), domain));
    }
    select.value = scope;
    select.disabled = select.options.length < 2;

    await renderSiteIde(host, triggers.find(t => t.ide));
}

// Per-site IDE key: "global" option, presets and custom key input
async function renderSiteIde(host, trigger) {
    let siteKey = await getSiteIdeKey(host);
    let global = (await getTriggerSettings()).find(t => t.ide).value;
    let select = document.querySelector('.site-ide');
    select.textContent = '';
    select.appendChild(new Option(t('asInSettings', getIdeLabel(global)), ''));
    for (let preset of IDE_PRESETS) {
        select.appendChild(new Option(preset.label + ' (' + preset.key + ')', preset.key));
    }
    select.appendChild(new Option(t('customKeyOption'), CUSTOM_IDE_OPTION));
    let custom = siteKey && !getIdePreset(siteKey);
    select.value = custom ? CUSTOM_IDE_OPTION : siteKey;
    document.querySelector('.site-ide-custom-row').hidden = !custom;
    document.querySelector('.site-ide-custom').value = custom ? siteKey : '';
    // The row is opened by click on IDE name, stays open when a site key is set
    if (siteKey) {
        document.querySelector('.site-ide-row').hidden = false;
    }
    log('popup: IDE key for', host, '=', trigger.value, trigger.siteValue ? '(site)' : '(global)');
}

function toggleSiteIdeRow(e) {
    e.preventDefault();
    let row = document.querySelector('.site-ide-row');
    row.hidden = !row.hidden;
}

async function applySiteIdeKey(ideKey) {
    showError('');
    let host = getHost(popupTab.url);
    let states = await getStates(popupTab);
    await setSiteIdeKey(host, ideKey);
    // Enabled debug cookie is re-set with the new IDE key
    if (states.debug) {
        try {
            await reapplyTriggers(popupTab, ['debug']);
        } catch (err) {
            logError('popup: IDE key change failed', err);
            showError(t('failed', err && err.message || err));
        }
    }
    await render();
}

async function onSiteIdeChange(e) {
    if (e.target.value === CUSTOM_IDE_OPTION) {
        document.querySelector('.site-ide-custom-row').hidden = false;
        document.querySelector('.site-ide-custom').focus();
        return;
    }
    await applySiteIdeKey(e.target.value);
}

async function onSiteIdeCustomSubmit(e) {
    e.preventDefault();
    let value = document.querySelector('.site-ide-custom').value.trim();
    if (!isValidCookieValue(value)) {
        showError(t('optInvalidValue', value));
        return;
    }
    await applySiteIdeKey(value);
}

async function onTriggerChange(e) {
    showError('');
    let triggerId = e.target.dataset.trigger;
    try {
        let enabled = await toggleTrigger(popupTab, triggerId);
        log('popup: trigger', triggerId, enabled ? 'enabled' : 'disabled');
    } catch (err) {
        logError('popup: toggle failed', triggerId, err);
        showError(t('failed', err && err.message || err));
    }
    await render();
}

async function onScopeChange(e) {
    showError('');
    let host = getHost(popupTab.url);
    let oldScope = await getScope(host);
    let states = await getStates(popupTab);
    let enabledIds = Object.keys(states).filter(id => states[id]);
    await setScope(host, e.target.value);
    try {
        await reapplyTriggers(popupTab, enabledIds);
    } catch (err) {
        // For example, the browser refuses to set a cookie for a public suffix (co.uk)
        logError('popup: scope change failed', err);
        showError(t('scopeFailed', err && err.message || err));
        await setScope(host, oldScope);
        await reapplyTriggers(popupTab, enabledIds).catch(err2 => logError('popup: rollback failed', err2));
    }
    await render();
}

async function onGrantClick() {
    try {
        await requestHostPermission();
    } catch (err) {
        logError('popup: permission request failed', err);
        showError(t('permissionFailed', err && err.message || err));
    }
    await render();
}

document.querySelector('.scope').addEventListener('change', onScopeChange);
document.querySelector('.site-ide').addEventListener('change', onSiteIdeChange);
document.querySelector('.site-ide-custom-row').addEventListener('submit', onSiteIdeCustomSubmit);
document.querySelector('.grant').addEventListener('click', onGrantClick);
function openOptions(e) {
    e.preventDefault();
    callApi('runtime.openOptionsPage', []);
    window.close();
}

document.querySelector('.open-options').addEventListener('click', openOptions);

localizePage();
render().catch(err => {
    logError('popup: render failed', err);
    showError(String(err && err.message || err));
});
