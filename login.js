const API_URLS = [
    'http://wpm.com/Backend/api.php',
    'https://ortho.bot.nu/api.php',
    'http://ortho.bot.nu/api.php'
];

/**
 * Attempts to call API with fallback to secondary API if primary fails
 */
async function callAPIWithFallback(requestData) {
    let lastError = null;
    let lastResult = null;
    
    for (const apiUrl of API_URLS) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            if (result && result.success === false && (result.message === 'Invalid API action.' || result.message === 'Invalid session token.' || result.message === 'Invalid token.')) {
                lastResult = result;
                continue;
            }
            return result;
        } catch (error) {
            lastError = error;
        }
    }
    
    if (lastResult) return lastResult;
    throw lastError || new Error('All API endpoints failed');
}

const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submit-btn');
const alertBox = document.getElementById('alert-box');
const successView = document.getElementById('success-view');
const updateView = document.getElementById('update-view');
const userGreeting = document.getElementById('user-greeting');
const expiryText = document.getElementById('expiry-text');
const closeTabBtn = document.getElementById('close-tab-btn');
const updateMsg = document.getElementById('update-msg');

function showAlert(message, type = 'danger') {
    alertBox.textContent = message;
    alertBox.className = `alert-box ${type}`;
    alertBox.style.display = 'block';
}

function hideAlert() {
    alertBox.style.display = 'none';
}

function reloadWaypointMapTabs() {
    chrome.tabs.query({}, function(tabs) {
        tabs.forEach(function(tab) {
            if (tab.url && tab.url.includes('waypointmap.com')) {
                chrome.tabs.reload(tab.id);
            }
        });
    });
}

/**
 * Check if extension is outdated
 */
async function checkExtensionVersion() {
    try {
        const manifest = chrome.runtime.getManifest();
        const extensionVersion = manifest.version;
        
        const result = await callAPIWithFallback({
            action: 'check_version',
            extension_version: extensionVersion
        });
        
        if (!result.success) {
            loginForm.style.display = 'none';
            updateView.style.display = 'block';
            updateMsg.textContent = result.message || 'Extension update is required.';
            return false;
        }
        return true;
    } catch (error) {
        return true; // fail open to allow local test
    }
}

// Initial check on load
(async function() {
    // Focus username
    usernameInput.focus();

    // Check version
    const isVersionValid = await checkExtensionVersion();
    if (!isVersionValid) return;

    // Check if user is already logged in
    chrome.storage.local.get(['token', 'username', 'subscription_expiry'], async function(data) {
        if (data.token) {
            try {
                const res = await callAPIWithFallback({ action: 'verify_token', token: data.token });
                const isExp = (res.is_expired === true || res.subscription_active === false);
                showSuccessState(data.username, res.subscription_expiry || data.subscription_expiry, isExp);
            } catch (e) {
                // If offline but token exists
                showSuccessState(data.username, data.subscription_expiry, true);
            }
        }
    });
})();

function showSuccessState(user, expiry, isExpired = false) {
    loginForm.style.display = 'none';
    hideAlert();
    successView.style.display = 'block';
    userGreeting.textContent = user;
    if (expiry) {
        expiryText.textContent = isExpired ? `Subscription Expired: ${expiry} (Features paused)` : `Subscription Expiry: ${expiry}`;
        expiryText.style.color = isExpired ? '#fca5a5' : '#a7f3d0';
    } else {
        expiryText.textContent = 'Active Subscription (Lifetime Access)';
        expiryText.style.color = '#a7f3d0';
    }
}

// Handle login submission
loginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    hideAlert();

    const isVersionValid = await checkExtensionVersion();
    if (!isVersionValid) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        showAlert('Please enter both username and password.');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Verifying credentials...</span>';

    try {
        const result = await callAPIWithFallback({
            action: 'login',
            username: username,
            password: password,
            remember: true
        });

        if (result.success) {
            const storageData = {
                token: result.token,
                username: username,
                subscription_expiry: result.subscription_expiry || null,
                is_expired: (result.is_expired === true || result.subscription_active === false)
            };

            await chrome.storage.local.set(storageData);

            // Inform background to switch popup state and update icon
            chrome.runtime.sendMessage({ action: 'login_success' });

            showSuccessState(username, result.subscription_expiry, result.is_expired === true);
            reloadWaypointMapTabs();

            // Auto close after 2.5 seconds
            setTimeout(() => {
                window.close();
            }, 2500);
        } else {
            showAlert(result.message || 'Login failed. Please check your credentials.', 'danger');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Log In to Extension</span>';
        }
    } catch (error) {
        showAlert('Cannot connect to authentication server. Please check your internet connection.', 'danger');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Log In to Extension</span>';
    }
});

// Close tab button
closeTabBtn.addEventListener('click', function() {
    window.close();
});
