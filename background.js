// Background service worker to handle dynamic popup, icon badges, and extension messages

const API_URLS = [
    'http://wpm.com/Backend/api.php',
    'https://ortho.bot.nu/api.php',
    'http://ortho.bot.nu/api.php'
];

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
            if (response.ok) {
                const res = await response.json();
                if (res && res.success === false && (res.message === 'Invalid API action.' || res.message === 'Invalid session token.' || res.message === 'Invalid token.')) {
                    lastResult = res;
                    continue;
                }
                return res;
            }
        } catch (error) {
            lastError = error;
        }
    }
    if (lastResult) return lastResult;
    throw lastError || new Error('All API endpoints failed');
}

/**
 * Updates the extension icon & badge according to login and subscription status:
 * - Not logged in: Default Icon, no badge, setPopup empty
 * - Logged in & Subscription Active: Default Icon, badge cleared or green, setPopup 'popup.html'
 * - Logged in & Subscription Expired/None: Red-bordered Icon, Red Badge '! / EXP', setPopup 'popup.html'
 */
async function updateActionBehavior() {
    try {
        const data = await chrome.storage.local.get(['token', 'is_expired', 'extension_enabled']);
        
        if (!data.token) {
            // Not logged in -> clicking opens new tab
            await chrome.action.setPopup({ popup: '' });
            await chrome.action.setIcon({
                path: {
                    "48": "images/icon48.png",
                    "128": "images/icon128.png"
                }
            });
            await chrome.action.setBadgeText({ text: '' });
            return;
        }

        // Logged in -> clicking opens popup.html
        await chrome.action.setPopup({ popup: 'popup.html' });

        // If extension is disabled (paused by user toggle)
        if (data.extension_enabled === false) {
            await chrome.action.setIcon({
                path: {
                    "48": "images/icon48.png",
                    "128": "images/icon128.png"
                }
            });
            await chrome.action.setBadgeText({ text: 'OFF' });
            await chrome.action.setBadgeBackgroundColor({ color: '#64748B' });
            return;
        }

        // Check cached status first
        let isExpired = (data.is_expired === true);

        // If is_expired is not yet set in cache, query server once and cache it
        if (data.is_expired === undefined) {
            try {
                const res = await callAPIWithFallback({ action: 'verify_token', token: data.token });
                if (res.success) {
                    isExpired = (res.subscription_active === false || res.subscription_active == 0 || res.is_expired === true);
                } else {
                    isExpired = true;
                }
                await chrome.storage.local.set({ is_expired: isExpired, subscription_expiry: res.subscription_expiry !== undefined ? res.subscription_expiry : null });
            } catch (e) {
                // offline fallback: keep cached is_expired
            }
        }

        if (isExpired) {
            // Expired or No Subscription: Show thick red-bordered icon + red alert badge
            await chrome.action.setIcon({
                path: {
                    "48": "images/icon48_expired.png",
                    "128": "images/icon128_expired.png"
                }
            });
            await chrome.action.setBadgeText({ text: 'EXP' });
            await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
        } else {
            // Active Subscription: Show thick green-bordered icon + green 'ACT' badge
            await chrome.action.setIcon({
                path: {
                    "48": "images/icon48_active.png",
                    "128": "images/icon128_active.png"
                }
            });
            await chrome.action.setBadgeText({ text: 'ACT' });
            await chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
        }
    } catch (e) {
        console.error('Error updating action behavior:', e);
    }
}

/**
 * Opens or focuses the extension login page in a tab
 */
async function openLoginPage() {
    const loginUrl = chrome.runtime.getURL('login.html');
    const tabs = await chrome.tabs.query({});
    const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(loginUrl));

    if (existingTab && existingTab.id) {
        await chrome.tabs.update(existingTab.id, { active: true });
        if (existingTab.windowId) {
            await chrome.windows.update(existingTab.windowId, { focused: true });
        }
    } else {
        await chrome.tabs.create({ url: loginUrl });
    }
}

/**
 * Reloads all tabs that have waypointmap.com domain open
 */
async function reloadWaypointMapTabs() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.url && tab.url.includes('waypointmap.com')) {
            chrome.tabs.reload(tab.id);
        }
    }
}

// When extension action icon is clicked (fires ONLY when setPopup is empty, i.e., logged out)
chrome.action.onClicked.addListener(async (tab) => {
    const data = await chrome.storage.local.get('token');
    if (!data.token) {
        await openLoginPage();
    } else {
        await chrome.action.setPopup({ popup: 'popup.html' });
    }
});

// Listen to storage changes to keep popup and icon state in sync immediately
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && ('token' in changes || 'is_expired' in changes || 'extension_enabled' in changes)) {
        updateActionBehavior();
    }
});

// Extension lifecycle listeners
chrome.runtime.onInstalled.addListener(() => {
    updateActionBehavior();
});

chrome.runtime.onStartup.addListener(() => {
    updateActionBehavior();
});

// Listen for runtime messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'reloadWaypointMapTabs') {
        reloadWaypointMapTabs();
        sendResponse({ success: true });
    } else if (request.action === 'toggle_extension') {
        updateActionBehavior();
        sendResponse({ success: true });
    } else if (request.action === 'login_success' || request.action === 'logout_success' || request.action === 'check_status') {
        updateActionBehavior();
        sendResponse({ success: true });
    } else if (request.action === 'open_login_tab') {
        openLoginPage();
        sendResponse({ success: true });
    } else if (request.action === 'check_version') {
        (async () => {
            try {
                const manifest = chrome.runtime.getManifest();
                const result = await callAPIWithFallback({
                    action: 'check_version',
                    extension_version: request.extension_version || manifest.version
                });
                sendResponse(result);
            } catch (err) {
                sendResponse({ success: true, fail_open: true });
            }
        })();
        return true;
    } else if (request.action === 'verify_token') {
        (async () => {
            try {
                const data = await chrome.storage.local.get(['token', 'is_expired']);
                const token = request.token || data.token;
                if (!token) {
                    sendResponse({ success: false, is_expired: true, message: 'No token found' });
                    return;
                }
                const result = await callAPIWithFallback({ action: 'verify_token', token: token });
                if (result.success) {
                    const isExpired = (result.is_expired === true || result.subscription_active === false || result.subscription_active == 0);
                    const toSet = { is_expired: isExpired };
                    if (result.subscription_expiry !== undefined) {
                        toSet.subscription_expiry = result.subscription_expiry;
                    }
                    await chrome.storage.local.set(toSet);
                    sendResponse({
                        success: true,
                        subscription_active: !isExpired,
                        is_expired: isExpired,
                        subscription_expiry: result.subscription_expiry
                    });
                } else {
                    // Token invalid or expired on server
                    await chrome.storage.local.set({ is_expired: true });
                    sendResponse({
                        success: false,
                        subscription_active: false,
                        is_expired: true,
                        message: result.message || 'Token verification failed'
                    });
                }
            } catch (err) {
                // If network/API error, do NOT overwrite active subscription as expired!
                const cache = await chrome.storage.local.get(['is_expired', 'subscription_expiry']);
                const cachedExpired = (cache.is_expired === true);
                sendResponse({
                    success: false,
                    network_error: true,
                    subscription_active: !cachedExpired,
                    is_expired: cachedExpired,
                    subscription_expiry: cache.subscription_expiry
                });
            }
        })();
        return true; // Keep message channel open for async response
    }
    return true; // Keep message channel open for async response
});

// Run initial check on service worker start
updateActionBehavior();
