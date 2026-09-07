// --- API Configuration ---
const API_URLS = [
    'http://wpm.com/Backend/api.php',
    'https://ortho.bot.nu/api.php',
    'http://ortho.bot.nu/api.php'
];
// -------------------------

/**
 * Attempts to call API with fallback to secondary API if primary fails
 * @param {Object} requestData - The data to send in the request body
 * @returns {Promise<Object>} - The response data from the API
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
            // Continue to next API URL
        }
    }
    
    if (lastResult) return lastResult;
    // All APIs failed, throw the last error
    throw lastError || new Error('All API endpoints failed');
}

// Function to create and append the preloader element
function createPreloader() {
    const preloaderDiv = document.createElement('div');
    preloaderDiv.id = 'custom-preloader';
    const spinnerDiv = document.createElement('div');
    spinnerDiv.id = 'preloader-spinner';
    preloaderDiv.appendChild(spinnerDiv);
    // Append to documentElement since body might not be loaded yet
    document.documentElement.appendChild(preloaderDiv); 
}

// Function to hide the preloader with a fade-out animation
function hidePreloader() {
    const preloader = document.getElementById('custom-preloader');
    if (preloader) {
        // Start fade-out animation
        preloader.classList.add('fade-out');
        // Remove the element after the CSS transition ends
        setTimeout(() => {
            preloader.remove();
        }, 500); 
    }
}

/**
 * Gets an element by XPath
 * @param {string} xpath - XPath expression
 * @returns {Element|null} - The element or null if not found
 */
function getElementByXPath(xpath) {
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue;
}

/**
 * Elements hidden for premium users:
 * Instead of removing them from DOM (which is permanent), we hide/show them using CSS
 * so we can switch back and forth dynamically without page reload.
 */
const XPATHS_TO_HIDE = [
    "/html/body/div[1]/main/div/form[1]/div[2]/div[1]/div[2]/div/div/div[1]",
    "/html/body/div[1]/main/div/div[1]/div[1]/span",
    "/html/body/div[1]/main/div/form[1]/div[2]/div[2]",
    "/html/body/div[1]/main/div/form[2]/div[1]/div[1]/p[3]",
    "/html/body/div[1]/main/div/div[1]/section",
    "/html/body/div[1]/main/div/form[1]/div[2]/section",
    "/html/body/div[1]/main/div/form[1]/div[2]/div[1]/div[2]/div/div/div[3]/div[3]",
    "/html/body/div[1]/main/div/form[1]/div[2]/div[1]/div[2]/div/div/div[4]/div[3]",
    "/html/body/div[1]/main/div/form[2]/div[2]",
    "/html/body/div[1]/main/div/form[2]/div[1]/div[2]"
];

const GENERATE_BUTTON_XPATHS = [
    '/html/body/div[1]/main/div/btn',
    '/html/body/div[1]/main/div/div[1]/div[3]/div/div[3]/div[1]/div[2]/div/div[4]/div/div/div/div[1]/div[2]/div/div/button[1]',
    '/html/body/div[1]/main/div[2]/div[1]/div[3]/div[1]/div/div[3]/div[1]/div[2]/div/div[4]/div/div/div/div[1]/div[2]/div/div/button[1]'
];

const DOWNLOAD_KMZ_XPATH = '/html/body/div[1]/main/div/form[2]/div[1]/div[1]/button';

let isFeaturesEnabled = false;

/**
 * Injects a small dynamic style tag to cleanly hide promotional / watermark blocks
 */
function ensureCustomStyleSheet() {
    if (!document.getElementById('wpm-premium-dynamic-style')) {
        const style = document.createElement('style');
        style.id = 'wpm-premium-dynamic-style';
        style.textContent = `
            .wpm-premium-hidden {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                height: 0 !important;
                overflow: hidden !important;
            }
            .wpm-notice-banner {
                background: #fee2e2;
                border: 1px solid #ef4444;
                color: #b91c1c;
                padding: 10px 16px;
                border-radius: 8px;
                font-weight: 600;
                margin: 10px 0;
                text-align: center;
                font-family: sans-serif;
                animation: fadeIn 0.3s ease-in-out;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }
}

/**
 * Sweep DOM and unlock all inputs/buttons/selects when subscription is active
 */
function unlockAllFields() {
    const disabledElements = document.querySelectorAll(
        'input[disabled], textarea[disabled], select[disabled], button[disabled]'
    );
    disabledElements.forEach(element => {
        // Tag them so we can re-disable if subscription expires
        element.setAttribute('data-wpm-unlocked', 'true');
        element.disabled = false;
    });

    // Also remove any disabled classes or pointer-events block if used by framework
    const disabledClassElements = document.querySelectorAll('.disabled, [aria-disabled="true"]');
    disabledClassElements.forEach(element => {
        if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'BUTTON' || element.tagName === 'A') {
            element.classList.remove('disabled');
            element.removeAttribute('aria-disabled');
            element.setAttribute('data-wpm-unlocked-class', 'true');
        }
    });

    // Ensure KMZ button is unlocked
    const kmzBtn = getElementByXPath(DOWNLOAD_KMZ_XPATH);
    if (kmzBtn) {
        kmzBtn.disabled = false;
        kmzBtn.removeAttribute('title');
    }
}

/**
 * Sweep DOM and hide promotional / watermark elements
 */
function hidePromotionalElements() {
    XPATHS_TO_HIDE.forEach(xpath => {
        const el = getElementByXPath(xpath);
        if (el) {
            el.classList.add('wpm-premium-hidden');
            el.style.setProperty('display', 'none', 'important');
        }
    });
}

/**
 * Sweep DOM and re-lock elements when subscription is expired/inactive.
 * NOTE: As requested, promotional elements remain HIDDEN as long as extension is ON.
 */
function lockAllFields() {
    const unlockedElements = document.querySelectorAll('[data-wpm-unlocked="true"]');
    unlockedElements.forEach(element => {
        element.disabled = true;
    });

    const unlockedClassElements = document.querySelectorAll('[data-wpm-unlocked-class="true"]');
    unlockedClassElements.forEach(element => {
        element.classList.add('disabled');
        element.setAttribute('aria-disabled', 'true');
    });

    // Disable Download KMZ button
    const kmzBtn = getElementByXPath(DOWNLOAD_KMZ_XPATH);
    if (kmzBtn) {
        kmzBtn.disabled = true;
        kmzBtn.setAttribute('title', 'Subscription required to download KMZ');
    }

    // Always ensure promotional elements stay hidden when extension is enabled
    hidePromotionalElements();
}

/**
 * Restores promotional elements when extension is explicitly turned OFF
 */
function restorePromotionalElements() {
    XPATHS_TO_HIDE.forEach(xpath => {
        const el = getElementByXPath(xpath);
        if (el) {
            el.classList.remove('wpm-premium-hidden');
            el.style.removeProperty('display');
        }
    });
}

/**
 * Enables all premium features on the page without reloading
 */
function enablePremiumFeatures() {
    ensureCustomStyleSheet();
    isFeaturesEnabled = true;

    // 1. Sweep and unlock
    unlockAllFields();

    // 2. Hide promotional blocks
    hidePromotionalElements();

    // 3. Remove any expired notice banner if present
    const existingBanner = document.getElementById('wpm-expired-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    hidePreloader();
}

/**
 * Disables premium features dynamically on the page without reloading
 */
function disablePremiumFeatures(showBanner = false) {
    ensureCustomStyleSheet();
    isFeaturesEnabled = false;

    // 1. Lock fields (promotional elements remain hidden)
    lockAllFields();

    // 2. Optionally show inline warning banner
    if (showBanner && !document.getElementById('wpm-expired-banner')) {
        const banner = document.createElement('div');
        banner.id = 'wpm-expired-banner';
        banner.className = 'wpm-notice-banner';
        banner.innerHTML = '⚠️ Your WaypointMap Premium subscription has expired or is inactive. Premium features have been locked.';
        const targetContainer = document.querySelector('main') || document.body;
        if (targetContainer) {
            targetContainer.insertBefore(banner, targetContainer.firstChild);
        }
    }

    hidePreloader();
}

/**
 * Checks if user is active and subscription has not expired via server API
 * @returns {Promise<boolean>} - True if user is active and subscription valid
 */
async function checkUserActiveLive() {
    return new Promise((resolve) => {
        chrome.storage.local.get('extension_enabled', (extData) => {
            if (extData.extension_enabled === false) {
                resolve(false);
                return;
            }

            chrome.runtime.sendMessage({ action: 'verify_token' }, (response) => {
                if (chrome.runtime.lastError || !response) {
                    // Background communication error: check local storage cached state
                    chrome.storage.local.get('is_expired', (cache) => {
                        resolve(cache.is_expired === false);
                    });
                    return;
                }

                // If network error occurred in background, resolve based on cached state
                if (response.network_error) {
                    resolve(response.subscription_active === true);
                    return;
                }

                const isActive = (response.subscription_active === true && response.is_expired === false);
                resolve(isActive);
            });
        });
    });
}

/**
 * Determines if an element is any Generate button on WaypointMap
 */
function isGenerateButtonElement(el) {
    if (!el || !(el instanceof Element)) return false;
    const btn = el.closest('button, btn, a.btn, input[type="button"], input[type="submit"]');
    if (!btn) return false;

    // Check onclick attribute
    const onclickAttr = (btn.getAttribute('onclick') || '').toLowerCase();
    if (onclickAttr.includes('submitformfetch') || onclickAttr.includes('generate')) {
        return btn;
    }

    // Check button text
    const text = (btn.innerText || btn.textContent || btn.value || '').trim().toLowerCase();
    if (text === 'generate' || text.startsWith('generate ') || text.includes('generate waypoint')) {
        return btn;
    }

    // Check explicit XPaths
    for (const xpath of GENERATE_BUTTON_XPATHS) {
        if (getElementByXPath(xpath) === btn) {
            return btn;
        }
    }

    return false;
}

/**
 * Intercepts click on Generate button using event capturing.
 * Checks subscription status with server BEFORE allowing waypoint generation.
 */
async function handleGenerateButtonClickCapture(e) {
    // If extension is disabled/OFF, do not intercept or block waypoint generation (let default site behavior run)
    const storageData = await new Promise((resolve) => {
        chrome.storage.local.get('extension_enabled', resolve);
    });
    if (storageData.extension_enabled === false) {
        return;
    }

    const targetElement = e.target;
    const btn = isGenerateButtonElement(targetElement) || (e.currentTarget && isGenerateButtonElement(e.currentTarget));

    if (!btn) {
        return;
    }

    // If the click is synthetic (already verified by our handler), let it proceed
    if (btn.getAttribute('data-wpm-verified') === 'true') {
        return;
    }

    // Stop event immediately so the page's waypoint generation script does NOT run yet
    e.stopImmediatePropagation();
    e.preventDefault();

    const originalText = btn.textContent;
    
    // Provide user feedback that verification is in progress
    if (btn.tagName === 'BUTTON' || btn.tagName === 'BTN') {
        btn.textContent = 'Verifying...';
    }

    try {
        const isActive = await checkUserActiveLive();

        if (isActive) {
            // Restore text and re-trigger genuine click
            if (btn.tagName === 'BUTTON' || btn.tagName === 'BTN') {
                btn.textContent = originalText;
            }
            btn.setAttribute('data-wpm-verified', 'true');
            btn.click();
            setTimeout(() => {
                btn.removeAttribute('data-wpm-verified');
            }, 500);
        } else {
            // Subscription expired or inactive! Lock features immediately without reload.
            if (btn.tagName === 'BUTTON' || btn.tagName === 'BTN') {
                btn.textContent = originalText;
            }
            disablePremiumFeatures(true);
            alert('Your WaypointMap Premium subscription is expired or inactive. Waypoint generation is disabled.');
        }
    } catch (err) {
        if (btn.tagName === 'BUTTON' || btn.tagName === 'BTN') {
            btn.textContent = originalText;
        }
        disablePremiumFeatures(true);
    }
}

/**
 * Sets up Generate button click listeners and DOM mutation observer
 */
function setupGenerateButtonListeners() {
    function attachListenersAndFixes() {
        // 1. Attach interception listeners to specific XPath buttons
        GENERATE_BUTTON_XPATHS.forEach(xpath => {
            const button = getElementByXPath(xpath);
            if (button && !button.hasAttribute('data-waypoint-listener')) {
                button.setAttribute('data-waypoint-listener', 'true');
                button.addEventListener('click', handleGenerateButtonClickCapture, true);
            }
        });

        // 2. Attach interception listeners to any matching querySelector buttons
        const potentialButtons = document.querySelectorAll('button[onclick*="submitFormFetch"], button.btn-success, btn, button');
        potentialButtons.forEach(button => {
            if (isGenerateButtonElement(button) && !button.hasAttribute('data-waypoint-listener')) {
                button.setAttribute('data-waypoint-listener', 'true');
                button.addEventListener('click', handleGenerateButtonClickCapture, true);
            }
        });

        // 3. Always keep promotional/watermark elements hidden as long as extension is ON
        hidePromotionalElements();

        // 4. If premium subscription features are currently active, unlock disabled fields
        if (isFeaturesEnabled) {
            unlockAllFields();
        }
    }

    // Global document-level capturing click listener as a bulletproof failsafe for all Generate buttons
    if (!window.__wpm_global_click_listening) {
        window.__wpm_global_click_listening = true;
        document.addEventListener('click', handleGenerateButtonClickCapture, true);
    }

    attachListenersAndFixes();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachListenersAndFixes);
    }

    // High-frequency polling during initial page load to catch asynchronous framework renderings
    let initialSweepCount = 0;
    const initialInterval = setInterval(() => {
        attachListenersAndFixes();
        initialSweepCount++;
        if (initialSweepCount > 20) { // Poll every 300ms for 6 seconds
            clearInterval(initialInterval);
        }
    }, 300);

    // Continuous MutationObserver with debouncing to catch user interaction DOM changes
    let checkTimeout;
    const observer = new MutationObserver(function() {
        clearTimeout(checkTimeout);
        checkTimeout = setTimeout(attachListenersAndFixes, 100);
    });

    const startObserving = () => {
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class'] });
        }
    };

    if (document.body) {
        startObserving();
    } else {
        document.addEventListener('DOMContentLoaded', startObserving);
    }
}

/**
 * Listen for storage changes:
 * When user logs in/out, rechecks status in popup, changes extension power switch,
 * enable or disable features IMMEDIATELY without page reload!
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if ('extension_enabled' in changes) {
        const isEnabled = changes.extension_enabled.newValue;
        if (isEnabled === false) {
            disablePremiumFeatures(false);
            return;
        } else {
            chrome.storage.local.get(['token', 'is_expired'], (data) => {
                if (data.token && data.is_expired === false) {
                    enablePremiumFeatures();
                }
            });
        }
    }

    if ('token' in changes) {
        if (!changes.token.newValue) {
            // Logged out -> disable features immediately
            disablePremiumFeatures(false);
            return;
        }
    }

    if ('is_expired' in changes) {
        const isExpired = changes.is_expired.newValue;
        chrome.storage.local.get('extension_enabled', (ext) => {
            if (ext.extension_enabled === false) return;
            if (isExpired === true) {
                disablePremiumFeatures(true);
            } else if (isExpired === false) {
                enablePremiumFeatures();
            }
        });
    }
});

// Also listen for direct messages from popup (e.g. forced recheck button click)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'apply_subscription_status') {
        if (request.is_active === true) {
            enablePremiumFeatures();
        } else {
            disablePremiumFeatures(false);
        }
        sendResponse({ success: true });
    }
});

// Main function to check user authorization before executing fixes
async function checkAuthAndExecute() {
    setupGenerateButtonListeners();

    // Check version via background script
    try {
        const manifest = chrome.runtime.getManifest();
        const result = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'check_version',
                extension_version: manifest.version
            }, (res) => {
                if (chrome.runtime.lastError || !res) resolve({ success: true });
                else resolve(res);
            });
        });
        if (result && result.success === false) {
            hidePreloader();
            return;
        }
    } catch (e) {
        // Fail open on version check error
    }

    chrome.storage.local.get(['token', 'is_expired', 'extension_enabled'], function(data) {
        // If user toggled extension OFF, do nothing
        if (data.extension_enabled === false) {
            hidePreloader();
            return;
        }

        const token = data.token;
        if (!token) {
            hidePreloader();
            return;
        }

        // Apply cached status immediately for instant responsiveness
        if (data.is_expired === false) {
            enablePremiumFeatures();
        } else if (data.is_expired === true) {
            disablePremiumFeatures(false);
            return;
        }

        // Live check via background service worker (avoids HTTPS/Mixed Content blocking)
        chrome.runtime.sendMessage({ action: 'verify_token' }, (response) => {
            if (chrome.runtime.lastError || !response) {
                hidePreloader();
                return;
            }

            if (response.network_error) {
                // Keep current state on network/server unreachable error
                hidePreloader();
                return;
            }

            if (response.success && response.subscription_active === true && response.is_expired === false) {
                enablePremiumFeatures();
            } else if (response.is_expired === true) {
                disablePremiumFeatures(false);
            } else {
                hidePreloader();
            }
        });
    });
}

// Create the preloader immediately when the script runs
createPreloader();

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAuthAndExecute);
} else {
    checkAuthAndExecute();
}