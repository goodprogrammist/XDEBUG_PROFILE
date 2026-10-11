const visibilityClass = 'is-visible';
const OPTIONS_LOG_PREFIX = '[XDEBUG_PROFILE options]';

async function saveOptions(e) {
    e.preventDefault();
    hideMessages();

    let onColor = document.querySelector(".cookie-XDEBUG_PROFILE-on-color:checked");
    let offColor = document.querySelector(".cookie-XDEBUG_PROFILE-off-color:checked");
    let options = {
        cookie_XDEBUG_PROFILE_on_color: onColor ? onColor.value : DEFAULT_ON_COLOR,
        cookie_XDEBUG_PROFILE_off_color: offColor ? offColor.value : DEFAULT_OFF_COLOR
    };
    for (let trigger of TRIGGERS) {
        options[trigger.key] = document.querySelector(".trigger-name[data-key=" + trigger.key + "]").value.trim();
        options[trigger.key + '_value'] = document.querySelector(".trigger-value[data-key=" + trigger.key + "]").value.trim();
    }
    console.debug(OPTIONS_LOG_PREFIX, 'saving', options);

    let saved = api.storage.sync.set(options);
    saved.then(showSuccess, showError);
}

async function restoreOptions() {
    let triggers = await getTriggerSettings();
    let colors = await getColors();
    console.debug(OPTIONS_LOG_PREFIX, 'restored', triggers, colors);

    let container = document.querySelector(".triggers");
    let template = document.querySelector(".trigger-template");
    container.textContent = '';
    for (let trigger of triggers) {
        let rows = template.content.cloneNode(true);
        rows.querySelector(".trigger-name-label").textContent = trigger.label + ' cookie name (usually: ' + trigger.defaultName + ')';
        rows.querySelector(".trigger-value-label").textContent = trigger.label + ' cookie value (must match xdebug.trigger_value, default: ' + trigger.defaultValue + ')';
        let name = rows.querySelector(".trigger-name");
        let value = rows.querySelector(".trigger-value");
        name.dataset.key = value.dataset.key = trigger.key;
        name.placeholder = trigger.defaultName;
        value.placeholder = trigger.defaultValue;
        name.value = trigger.name;
        value.value = trigger.value;
        container.appendChild(rows);
    }

    document.querySelector(".cookie-XDEBUG_PROFILE-on-color[value="+ colors.on +"]").checked = true;
    document.querySelector(".cookie-XDEBUG_PROFILE-off-color[value="+ colors.off +"]").checked = true;

    await renderPermission();
}

async function renderPermission() {
    let permitted = await hasHostPermission();
    console.debug(OPTIONS_LOG_PREFIX, 'host permission:', permitted);
    document.querySelector(".permission-row").hidden = permitted;
}

async function onGrantClick() {
    try {
        await requestHostPermission();
    } catch (err) {
        console.error(OPTIONS_LOG_PREFIX, 'permission request failed', err);
    }
    await renderPermission();
}

function showSuccess() {
    let messageClass = document.querySelector(".saved-successfully").classList;

    messageClass.add(visibilityClass);
    setTimeout(function() {
        hideMessages();
    }, 2000);
}

function showError(error) {
    console.error(OPTIONS_LOG_PREFIX, 'save failed', error);
    let messageClass = document.querySelector(".saved-error").classList;
    messageClass.add(visibilityClass);
}

function hideMessages() {
    document.querySelectorAll(".message").forEach(function(message) {
        message.classList.remove(visibilityClass);
    });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.querySelector("form").addEventListener("submit", saveOptions);
document.querySelector(".grant").addEventListener("click", onGrantClick);
