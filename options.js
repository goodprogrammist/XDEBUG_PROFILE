const visiblityClass = 'is-visible';

async function saveOptions(e) {
    e.preventDefault();
    hideMessages();

    let saved = browser.storage.sync.set({
        cookie_ncc: document.querySelector(".cookie_ncc").value,
        cookie_ncc_on_color: document.querySelector(".cookie-ncc-on-color:checked").value,
        cookie_ncc_off_color: document.querySelector(".cookie-ncc-off-color:checked").value
    });
    saved.then(showSuccess, showError);
}

async function restoreOptions() {
    const items = [
        'cookie_ncc',
        'cookie_ncc_on_color',
        'cookie_ncc_off_color'
    ];
    let sessionKey = await browser.storage.sync.get(items);

    document.querySelector(".cookie_ncc").value = sessionKey.cookie_ncc || '?????_NCC';

    let onColor = sessionKey.cookie_ncc_on_color || 'red';
    let offColor = sessionKey.cookie_ncc_off_color || 'light';
    document.querySelector(".cookie-ncc-on-color[value="+ onColor +"]").checked = true;
    document.querySelector(".cookie-ncc-off-color[value="+ offColor +"]").checked = true;
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
