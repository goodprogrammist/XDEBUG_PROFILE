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
        let value = document.querySelector(".trigger-value[data-key=" + trigger.key + "]").value.trim();
        let ide = document.querySelector(".trigger-ide[data-key=" + trigger.key + "]");
        if (trigger.ide && ide.value) {
            // Preset selected, custom input is ignored
            value = ide.value;
        }
        options[trigger.key + '_value'] = value;
        if (trigger.ide) {
            options[IDE_CHOSEN_KEY] = true;
        }
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
        localizePage(rows);
        rows.querySelector(".trigger-name-label").textContent = t('optCookieName', trigger.label, trigger.defaultName);
        rows.querySelector(".trigger-value-label").textContent = trigger.ide
            ? t('optCustomIdeKey')
            : t('optCookieValue', trigger.label, trigger.defaultValue);
        let name = rows.querySelector(".trigger-name");
        let value = rows.querySelector(".trigger-value");
        name.dataset.key = value.dataset.key = trigger.key;
        name.placeholder = trigger.defaultName;
        value.placeholder = trigger.defaultValue;
        name.value = trigger.name;
        value.value = trigger.value;
        if (trigger.ide) {
            setupIdeSelect(rows, trigger);
        }
        container.appendChild(rows);
    }

    let config = await api.storage.sync.get(IDE_CHOSEN_KEY);
    document.querySelector(".welcome-row").hidden = !!config[IDE_CHOSEN_KEY];

    document.querySelector(".cookie-XDEBUG_PROFILE-on-color[value="+ colors.on +"]").checked = true;
    document.querySelector(".cookie-XDEBUG_PROFILE-off-color[value="+ colors.off +"]").checked = true;

    await renderPermission();
}

// IDE presets select; "Custom key" shows the text input for the value
function setupIdeSelect(rows, trigger) {
    let select = rows.querySelector(".trigger-ide");
    let valueRow = rows.querySelector(".trigger-value-row");
    select.dataset.key = trigger.key;
    for (let preset of IDE_PRESETS) {
        select.appendChild(new Option(preset.label + ' (' + preset.key + ')', preset.key));
    }
    select.appendChild(new Option(t('optCustomKeyOption'), ''));
    let preset = getIdePreset(trigger.value);
    select.value = preset ? preset.key : '';
    rows.querySelector(".ide-row").hidden = false;
    rows.querySelector(".ide-hint-row").hidden = false;
    valueRow.hidden = !!select.value;
    select.addEventListener("change", function() {
        console.debug(OPTIONS_LOG_PREFIX, 'IDE selected:', select.value || '(custom)');
        valueRow.hidden = !!select.value;
        if (!select.value) {
            let input = valueRow.querySelector(".trigger-value");
            input.placeholder = t('placeholderCustom');
            input.focus();
        }
    });
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
    document.querySelector(".welcome-row").hidden = true;
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

localizePage();
document.addEventListener('DOMContentLoaded', restoreOptions);
document.querySelector("form").addEventListener("submit", saveOptions);
document.querySelector(".grant").addEventListener("click", onGrantClick);
