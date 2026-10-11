const visibilityClass = 'is-visible';
const LOG_PREFIX = '[XDEBUG_PROFILE options]';

async function saveOptions(e) {
    e.preventDefault();
    hideMessages();

    let onColor = document.querySelector(".cookie-XDEBUG_PROFILE-on-color:checked");
    let offColor = document.querySelector(".cookie-XDEBUG_PROFILE-off-color:checked");
    let options = {
        cookie_XDEBUG_PROFILE: document.querySelector(".cookie_XDEBUG_PROFILE").value.trim(),
        cookie_XDEBUG_PROFILE_value: document.querySelector(".cookie_XDEBUG_PROFILE_value").value.trim(),
        cookie_XDEBUG_PROFILE_on_color: onColor ? onColor.value : 'red',
        cookie_XDEBUG_PROFILE_off_color: offColor ? offColor.value : 'light'
    };
    console.debug(LOG_PREFIX, 'saving', options);

    let saved = browser.storage.sync.set(options);
    saved.then(showSuccess, showError);
}

async function restoreOptions() {
    const items = [
        'cookie_XDEBUG_PROFILE',
        'cookie_XDEBUG_PROFILE_value',
        'cookie_XDEBUG_PROFILE_on_color',
        'cookie_XDEBUG_PROFILE_off_color'
    ];
    let sessionKey = await browser.storage.sync.get(items);
    console.debug(LOG_PREFIX, 'restored', sessionKey);

    document.querySelector(".cookie_XDEBUG_PROFILE").value = sessionKey.cookie_XDEBUG_PROFILE || 'XDEBUG_PROFILE';
    document.querySelector(".cookie_XDEBUG_PROFILE_value").value = sessionKey.cookie_XDEBUG_PROFILE_value || 'Y';

    let onColor = sessionKey.cookie_XDEBUG_PROFILE_on_color || 'red';
    let offColor = sessionKey.cookie_XDEBUG_PROFILE_off_color || 'light';
    document.querySelector(".cookie-XDEBUG_PROFILE-on-color[value="+ onColor +"]").checked = true;
    document.querySelector(".cookie-XDEBUG_PROFILE-off-color[value="+ offColor +"]").checked = true;
}

function showSuccess() {
    let messageClass = document.querySelector(".saved-successfully").classList;

    messageClass.add(visibilityClass);
    setTimeout(function() {
        hideMessages();
    }, 2000);
}

function showError(error) {
    console.error(LOG_PREFIX, 'save failed', error);
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
