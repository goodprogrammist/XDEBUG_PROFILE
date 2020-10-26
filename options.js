const visiblityClass = 'is-visible';

async function saveOptions(e) {
    e.preventDefault();
    hideMessages();

    let saved = browser.storage.sync.set({
        cookie_XDEBUG_PROFILE: document.querySelector(".cookie_XDEBUG_PROFILE").value,
        cookie_XDEBUG_PROFILE_on_color: document.querySelector(".cookie-XDEBUG_PROFILE-on-color:checked").value,
        cookie_XDEBUG_PROFILE_off_color: document.querySelector(".cookie-XDEBUG_PROFILE-off-color:checked").value
    });
    saved.then(showSuccess, showError);
}

async function restoreOptions() {
    const items = [
        'cookie_XDEBUG_PROFILE',
        'cookie_XDEBUG_PROFILE_on_color',
        'cookie_XDEBUG_PROFILE_off_color'
    ];
    let sessionKey = await browser.storage.sync.get(items);

    document.querySelector(".cookie_XDEBUG_PROFILE").value = sessionKey.cookie_XDEBUG_PROFILE || '?????_XDEBUG_PROFILE';

    let onColor = sessionKey.cookie_XDEBUG_PROFILE_on_color || 'red';
    let offColor = sessionKey.cookie_XDEBUG_PROFILE_off_color || 'light';
    document.querySelector(".cookie-XDEBUG_PROFILE-on-color[value="+ onColor +"]").checked = true;
    document.querySelector(".cookie-XDEBUG_PROFILE-off-color[value="+ offColor +"]").checked = true;
}

function showSuccess() {
    let messageClass = document.querySelector(".saved-successfully").classList;

    messageClass.add(visiblityClass);
    setTimeout(function() {
        hideMessages();
    }, 2000);
}

function showError() {
    let messageClass = document.querySelector(".saved-error").classList;
    messageClass.add('is-visible');
}

function hideMessages() {
    let messages = document.querySelector(".message").classList;
    messages.remove(visiblityClass);
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.querySelector("form").addEventListener("submit", saveOptions);
