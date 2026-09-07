const API_URLS = [
    'http://wpm.com/Backend/api.php',
    'https://ortho.bot.nu/api.php',
    'http://ortho.bot.nu/api.php'
];
// -------------------------

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
            // If the server answered but reported invalid action/endpoint or invalid token (which could mean token exists on another server/db), try next API
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

const logoutButton = document.getElementById('logout-btn');
const openLoginButton = document.getElementById('open-login-btn');
const messageDiv = document.getElementById('message');
const loggedInContainer = document.getElementById('logged-in-container');
const loggedOutContainer = document.getElementById('logged-out-container');
const updateRequiredContainer = document.getElementById('update-required-container');
const updateText = document.getElementById('update-text');
const currentVersionDisplay = document.getElementById('current-version-display');
const requiredVersionDisplay = document.getElementById('required-version-display');
const displayUsername = document.getElementById('display-username');
const subscriptionStatus = document.getElementById('subscription-status');
const displayExpiry = document.getElementById('display-expiry');
const headerStatus = document.getElementById('header-status');

const expiredNotice = document.getElementById('expired-notice');

const extensionToggle = document.getElementById('extension-toggle');
const powerStatusText = document.getElementById('power-status-text');

function showMessage(text, isError = false) {
    messageDiv.textContent = text;
    messageDiv.className = isError ? 'error' : 'success';
    messageDiv.style.display = 'block';
}

function updateUI(isLoggedIn, user = '', expiry = null, isExpired = false, isEnabled = true) {
    if (extensionToggle) {
        extensionToggle.checked = (isEnabled !== false);
    }
    if (powerStatusText) {
        powerStatusText.textContent = (isEnabled !== false) ? 'Enabled' : 'Disabled (Paused)';
        powerStatusText.style.color = (isEnabled !== false) ? '#10b981' : '#94a3b8';
    }

    if (isLoggedIn) {
        loggedInContainer.style.display = 'block';
        loggedOutContainer.style.display = 'none';
        updateRequiredContainer.style.display = 'none';
        displayUsername.textContent = user;
        
        if (headerStatus) {
            headerStatus.style.display = 'inline-flex';
            if (isEnabled === false) {
                headerStatus.className = 'status-badge';
                headerStatus.style.background = 'rgba(148, 163, 184, 0.15)';
                headerStatus.style.color = '#94a3b8';
                headerStatus.innerHTML = '<div class="status-dot" style="background:#94a3b8;"></div> Disabled';
            } else if (isExpired) {
                headerStatus.className = 'status-badge expired';
                headerStatus.style.background = '';
                headerStatus.style.color = '';
                headerStatus.innerHTML = '<div class="status-dot"></div> Expired';
            } else {
                headerStatus.className = 'status-badge';
                headerStatus.style.background = '';
                headerStatus.style.color = '';
                headerStatus.innerHTML = '<div class="status-dot"></div> Active';
            }
        }
        
        if (expiredNotice) {
            expiredNotice.style.display = (isExpired && isEnabled !== false) ? 'block' : 'none';
        }

        if (subscriptionStatus && displayExpiry) {
            if (expiry) {
                displayExpiry.textContent = expiry;
                displayExpiry.className = isExpired ? 'expiry-date expired' : 'expiry-date';
                subscriptionStatus.style.display = 'block';
            } else {
                displayExpiry.textContent = 'Lifetime Access';
                displayExpiry.className = 'expiry-date';
                subscriptionStatus.style.display = 'block';
            }
        }
    } else {
        loggedInContainer.style.display = 'none';
        loggedOutContainer.style.display = 'block';
        updateRequiredContainer.style.display = 'none';
        if (headerStatus) headerStatus.style.display = 'none';
        if (expiredNotice) expiredNotice.style.display = 'none';
    }
}

function showUpdateRequired(message, currentVersion, requiredVersion) {
    loggedInContainer.style.display = 'none';
    loggedOutContainer.style.display = 'none';
    updateRequiredContainer.style.display = 'block';
    updateText.textContent = message;
    currentVersionDisplay.textContent = currentVersion;
    requiredVersionDisplay.textContent = requiredVersion;
    if (headerStatus) headerStatus.style.display = 'none';
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

async function checkExtensionVersion() {
    try {
        const manifest = chrome.runtime.getManifest();
        const extensionVersion = manifest.version;
        
        const result = await callAPIWithFallback({
            action: 'check_version',
            extension_version: extensionVersion
        });
        
        if (result.success) {
            return true;
        } else {
            showUpdateRequired(
                result.message || 'Extension update is required.',
                result.current_version || extensionVersion,
                result.required_version || 'N/A'
            );
            return false;
        }
    } catch (error) {
        return true;
    }
}

const recheckButton = document.getElementById('recheck-btn');

/**
 * Checks subscription status with server and updates cache
 */
async function checkSubscriptionStatus(forceServerFetch = false) {
    chrome.storage.local.get(['token', 'username', 'subscription_expiry', 'is_expired', 'extension_enabled'], async function(data) {
        const isEnabled = data.extension_enabled !== false;

        if (!data.token) {
            updateUI(false, '', null, false, isEnabled);
            return;
        }

        const cachedExpiry = data.subscription_expiry;
        const isCurrentlyExpired = (data.is_expired === true);

        // If not forced and we have cache, render instantly without hitting server
        if (!forceServerFetch && data.username) {
            updateUI(true, data.username, cachedExpiry, isCurrentlyExpired, isEnabled);
            return;
        }

        // Hit server to refresh cache
        if (recheckButton) {
            recheckButton.disabled = true;
            recheckButton.textContent = 'Checking...';
        }

        try {
            const result = await callAPIWithFallback({ action: 'verify_token', token: data.token });
            if (result.success) {
                const expiry = result.subscription_expiry || data.subscription_expiry;
                const isExpired = (result.is_expired === true || result.subscription_active === false);
                const toSet = { is_expired: isExpired };
                if (result.subscription_expiry !== undefined) {
                    toSet.subscription_expiry = result.subscription_expiry;
                }
                await chrome.storage.local.set(toSet);
                updateUI(true, data.username, expiry, isExpired, isEnabled);
                
                // Direct message active waypoint tabs to immediately unlock/lock UI
                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        if (tab.url && tab.url.includes('waypointmap.com')) {
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'apply_subscription_status',
                                is_active: !isExpired && isEnabled
                            }).catch(() => {});
                        }
                    });
                });

                if (forceServerFetch) {
                    showMessage(isExpired ? 'Status updated: Subscription is Expired.' : 'Status updated: Subscription is Active!', isExpired);
                    chrome.runtime.sendMessage({ action: 'check_status' });
                }
            } else {
                // If unrecognized, mark expired in cache
                await chrome.storage.local.set({ is_expired: true });
                updateUI(true, data.username, data.subscription_expiry, true, isEnabled);

                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        if (tab.url && tab.url.includes('waypointmap.com')) {
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'apply_subscription_status',
                                is_active: false
                            }).catch(() => {});
                        }
                    });
                });

                if (forceServerFetch) {
                    showMessage('Subscription is expired or inactive.', true);
                }
            }
        } catch (e) {
            // Offline / network issue: show cached
            updateUI(true, data.username, data.subscription_expiry, isCurrentlyExpired, isEnabled);
            if (forceServerFetch) {
                showMessage('Could not connect to server. Showing cached status.', true);
            }
        } finally {
            if (recheckButton) {
                recheckButton.disabled = false;
                recheckButton.textContent = '🔄 Recheck Status';
            }
        }
    });
}

// Initial load: Instant render from cache (0 server requests)
(async function() {
    // 1. Immediately render cached data without waiting for network
    checkSubscriptionStatus(false);

    // 2. Perform version check in background without blocking cached UI
    checkExtensionVersion();
})();

// Extension ON/OFF Toggle Switch handler
if (extensionToggle) {
    extensionToggle.addEventListener('change', async function() {
        const isEnabled = extensionToggle.checked;
        await chrome.storage.local.set({ extension_enabled: isEnabled });

        if (powerStatusText) {
            powerStatusText.textContent = isEnabled ? 'Enabled' : 'Disabled (Paused)';
            powerStatusText.style.color = isEnabled ? '#10b981' : '#94a3b8';
        }

        // Notify background to update badge and icon
        chrome.runtime.sendMessage({ action: 'toggle_extension', enabled: isEnabled });

        if (!isEnabled) {
            // When turning OFF, reload all open waypointmap.com tabs as requested
            reloadWaypointMapTabs();
            showMessage('Extension disabled. WaypointMap tabs reloaded.', false);
        } else {
            // When turning ON, update live tabs or notify them
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url && tab.url.includes('waypointmap.com')) {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'apply_subscription_status',
                            is_active: true
                        }).catch(() => {});
                    }
                });
            });
            showMessage('Extension enabled.', false);
        }

        // Refresh UI state
        checkSubscriptionStatus(false);
    });
}

// Recheck button click handler
if (recheckButton) {
    recheckButton.addEventListener('click', function() {
        checkSubscriptionStatus(true);
    });
}

// Open Login Tab Button handler
if (openLoginButton) {
    openLoginButton.addEventListener('click', function() {
        chrome.runtime.sendMessage({ action: 'open_login_tab' }, function() {
            window.close();
        });
    });
}

// Handle logout button click
if (logoutButton) {
    logoutButton.addEventListener('click', async function() {
        logoutButton.disabled = true;
        logoutButton.textContent = 'Logging out...';

        chrome.storage.local.get('token', async function(data) {
            if (data.token) {
                try {
                    await callAPIWithFallback({ action: 'logout', token: data.token });
                } catch (error) {
                    // ignore network errors on logout
                }
            }
            
            chrome.storage.local.remove(['token', 'username', 'subscription_expiry'], function() {
                chrome.runtime.sendMessage({ action: 'logout_success' });
                showMessage('You have been logged out.', false);
                updateUI(false);
                reloadWaypointMapTabs();
                setTimeout(() => {
                    window.close();
                }, 1000);
            });
        });
    });
}