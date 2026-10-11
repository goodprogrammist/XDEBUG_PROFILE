let popupTab;

function showError(message) {
    let el = document.querySelector('.error');
    el.textContent = message;
    el.hidden = !message;
}

async function render() {
    // popup.html?tabId=N opens the popup for a given tab (for debugging in a regular tab)
    let debugTabId = new URLSearchParams(location.search).get('tabId');
    popupTab = debugTabId ? await api.tabs.get(Number(debugTabId)) : await getActiveTab();
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

    let triggers = await getTriggerSettings();
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
        container.appendChild(row);
    }

    let select = document.querySelector('.scope');
    let scope = await getScope(host);
    select.textContent = '';
    select.appendChild(new Option(host + ' (this host only)', ''));
    for (let domain of getDomainCandidates(host)) {
        select.appendChild(new Option('.' + domain + ' (with subdomains)', domain));
    }
    select.value = scope;
    select.disabled = select.options.length < 2;
}

async function onTriggerChange(e) {
    showError('');
    let triggerId = e.target.dataset.trigger;
    try {
        let enabled = await toggleTrigger(popupTab, triggerId);
        log('popup: trigger', triggerId, enabled ? 'enabled' : 'disabled');
    } catch (err) {
        logError('popup: toggle failed', triggerId, err);
        showError('Failed: ' + (err && err.message || err));
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
        showError('Failed to set cookie for this domain: ' + (err && err.message || err));
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
        showError('Permission request failed: ' + (err && err.message || err));
    }
    await render();
}

document.querySelector('.scope').addEventListener('change', onScopeChange);
document.querySelector('.grant').addEventListener('click', onGrantClick);
document.querySelector('.open-options').addEventListener('click', function(e) {
    e.preventDefault();
    api.runtime.openOptionsPage();
    window.close();
});

render().catch(err => {
    logError('popup: render failed', err);
    showError(String(err && err.message || err));
});
