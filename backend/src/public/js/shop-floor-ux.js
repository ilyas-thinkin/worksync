/**
 * WorkSync Shop Floor UX Utilities
 * Enhanced visual feedback and touch interactions for factory floor use
 */

const ShopFloorUX = {
    // Configuration
    config: {
        feedbackDuration: 500,
        rippleDuration: 600,
        confirmTimeout: 3000,
        vibrateOnAction: true
    },

    /**
     * Initialize shop floor UX enhancements
     */
    init() {
        this.setupTouchRipple();
        this.setupHapticFeedback();
        this.setupQuantitySteppers();
        this.setupHttpsBanner();
        this.initClientErrorLogging();
        document.body.classList.add('shop-floor-mode');
        console.log('[ShopFloorUX] Initialized');
    },

    /**
     * Setup touch ripple effect on buttons
     */
    setupTouchRipple() {
        document.addEventListener('pointerdown', (e) => {
            const target = e.target.closest('.touch-ripple, .btn, .quick-action-btn');
            if (!target) return;

            const rect = target.getBoundingClientRect();
            target.style.setProperty('--ripple-x', `${e.clientX - rect.left}px`);
            target.style.setProperty('--ripple-y', `${e.clientY - rect.top}px`);

            target.classList.remove('rippling');
            void target.offsetWidth; // Force reflow
            target.classList.add('rippling');

            setTimeout(() => {
                target.classList.remove('rippling');
            }, this.config.rippleDuration);
        });
    },

    /**
     * Setup haptic feedback for supported devices
     */
    setupHapticFeedback() {
        if (!this.config.vibrateOnAction) return;

        document.addEventListener('click', (e) => {
            const target = e.target.closest('.btn, .selection-card, .quick-action-btn');
            if (target && navigator.vibrate) {
                navigator.vibrate(10);
            }
        });
    },

    /**
     * Setup quantity stepper buttons
     */
    setupQuantitySteppers() {
        document.querySelectorAll('.quantity-stepper').forEach(stepper => {
            const input = stepper.querySelector('.input-quantity');
            const minusBtn = stepper.querySelector('[data-action="minus"]');
            const plusBtn = stepper.querySelector('[data-action="plus"]');

            if (!input) return;

            const min = parseInt(input.min) || 0;
            const max = parseInt(input.max) || 9999;
            const step = parseInt(input.step) || 1;

            if (minusBtn) {
                minusBtn.addEventListener('click', () => {
                    const current = parseInt(input.value) || 0;
                    const newVal = Math.max(min, current - step);
                    input.value = newVal;
                    input.dispatchEvent(new Event('change'));
                    this.vibrate(10);
                });
            }

            if (plusBtn) {
                plusBtn.addEventListener('click', () => {
                    const current = parseInt(input.value) || 0;
                    const newVal = Math.min(max, current + step);
                    input.value = newVal;
                    input.dispatchEvent(new Event('change'));
                    this.vibrate(10);
                });
            }
        });
    },

    /**
     * Show HTTPS banner when running on non-secure context (except localhost)
     */
    setupHttpsBanner() {
        const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (window.isSecureContext || isLocalhost) return;

        const banner = document.createElement('div');
        banner.className = 'https-banner';
        const host = location.hostname;
        const port = location.port ? parseInt(location.port, 10) : null;
        const httpsPort = port && port !== 443 ? '3443' : '';
        const httpsUrl = `https://${host}${httpsPort ? `:${httpsPort}` : ''}${location.pathname}`;
        banner.innerHTML = `
            <div class="https-banner__content">
                <strong>Secure connection required.</strong>
                <span>Open the HTTPS link to enable camera and secure features.</span>
            </div>
            <div class="https-banner__actions">
                <a class="btn btn-primary btn-sm" href="${httpsUrl}">Open HTTPS</a>
                <button class="btn btn-secondary btn-sm" type="button" id="https-banner-close">Dismiss</button>
            </div>
        `;
        document.body.appendChild(banner);
        const closeBtn = banner.querySelector('#https-banner-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => banner.remove());
        }
    },

    /**
     * Initialize lightweight client error logging
     */
    initClientErrorLogging() {
        let lastSentAt = 0;
        const send = (payload) => {
            const now = Date.now();
            if (now - lastSentAt < 3000) return;
            lastSentAt = now;
            try {
                const body = JSON.stringify(payload);
                if (navigator.sendBeacon) {
                    const blob = new Blob([body], { type: 'application/json' });
                    navigator.sendBeacon('/api/client-error', blob);
                } else {
                    fetch('/api/client-error', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body
                    }).catch(() => {});
                }
            } catch (err) {
                // swallow
            }
        };

        window.addEventListener('error', (event) => {
            if (!event) return;
            send({
                errorType: 'error',
                message: String(event.message || 'Unknown error').slice(0, 2000),
                source: String(event.filename || '').slice(0, 500),
                line: event.lineno || null,
                column: event.colno || null,
                stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 4000) : null,
                url: location.href
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event && event.reason;
            send({
                errorType: 'unhandledrejection',
                message: String(reason && reason.message ? reason.message : reason || 'Unhandled rejection').slice(0, 2000),
                stack: reason && reason.stack ? String(reason.stack).slice(0, 4000) : null,
                url: location.href
            });
        });
    },

    /**
     * Show success feedback on element
     * @param {HTMLElement} element - Target element
     * @param {number} duration - Animation duration in ms
     */
    showSuccess(element, duration = this.config.feedbackDuration) {
        element.classList.remove('feedback-error', 'feedback-warning');
        element.classList.add('feedback-success');
        this.vibrate([10, 50, 10]);

        setTimeout(() => {
            element.classList.remove('feedback-success');
        }, duration);
    },

    /**
     * Show error feedback on element
     * @param {HTMLElement} element - Target element
     * @param {number} duration - Animation duration in ms
     */
    showError(element, duration = this.config.feedbackDuration) {
        element.classList.remove('feedback-success', 'feedback-warning');
        element.classList.add('feedback-error');
        this.vibrate([50, 30, 50, 30, 50]);

        setTimeout(() => {
            element.classList.remove('feedback-error');
        }, duration);
    },

    /**
     * Show warning feedback on element
     * @param {HTMLElement} element - Target element
     * @param {number} duration - Animation duration in ms
     */
    showWarning(element, duration = this.config.feedbackDuration) {
        element.classList.remove('feedback-success', 'feedback-error');
        element.classList.add('feedback-warning');
        this.vibrate([30, 20, 30]);

        setTimeout(() => {
            element.classList.remove('feedback-warning');
        }, duration);
    },

    /**
     * Show loading state on element
     * @param {HTMLElement} element - Target element
     */
    showLoading(element) {
        element.classList.add('feedback-loading');
    },

    /**
     * Hide loading state on element
     * @param {HTMLElement} element - Target element
     */
    hideLoading(element) {
        element.classList.remove('feedback-loading');
    },

    /**
     * Flash screen for scan success
     */
    flashScanSuccess() {
        const flash = document.createElement('div');
        flash.className = 'scan-success-animation';
        document.body.appendChild(flash);
        this.vibrate([10, 30, 10]);

        setTimeout(() => {
            flash.remove();
        }, 500);
    },

    /**
     * Flash screen for scan error
     */
    flashScanError() {
        const flash = document.createElement('div');
        flash.className = 'scan-error-animation';
        document.body.appendChild(flash);
        this.vibrate([100, 50, 100, 50, 100]);

        setTimeout(() => {
            flash.remove();
        }, 600);
    },

    /**
     * Show action confirmation dialog
     * @param {Object} options - Confirmation options
     * @returns {Promise<boolean>} - User's choice
     */
    confirm(options = {}) {
        const {
            title = 'Confirm Action',
            message = 'Are you sure?',
            type = 'warning', // 'success', 'danger', 'warning'
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            confirmClass = 'btn-primary'
        } = options;

        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'action-confirm-overlay';

            const iconSvg = type === 'danger'
                ? '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
                : type === 'success'
                ? '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
                : '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

            overlay.innerHTML = `
                <div class="action-confirm-card">
                    <div class="action-confirm-icon ${type}">${iconSvg}</div>
                    <h3 class="action-confirm-title">${title}</h3>
                    <p class="action-confirm-message">${message}</p>
                    <div class="action-confirm-buttons">
                        <button class="btn btn-secondary btn-xl" data-action="cancel">${cancelText}</button>
                        <button class="btn ${confirmClass} btn-xl" data-action="confirm">${confirmText}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            this.vibrate(20);

            // Animate in
            requestAnimationFrame(() => {
                overlay.classList.add('active');
            });

            const cleanup = (result) => {
                overlay.classList.remove('active');
                setTimeout(() => {
                    overlay.remove();
                }, 300);
                resolve(result);
            };

            overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
                this.vibrate(10);
                cleanup(true);
            });

            overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => {
                this.vibrate(10);
                cleanup(false);
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    cleanup(false);
                }
            });
        });
    },

    /**
     * Show quick toast notification
     * @param {string} message - Toast message
     * @param {string} type - 'success', 'error', 'warning'
     * @param {number} duration - Display duration in ms
     */
    toast(message, type = 'success', duration = 3000) {
        const container = document.getElementById('toast-container') || this.createToastContainer();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const iconSvg = type === 'success'
            ? '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
            : type === 'error'
            ? '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>'
            : '<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';

        toast.innerHTML = `${iconSvg}<span>${message}</span>`;
        container.appendChild(toast);

        if (type === 'success') {
            this.vibrate([10, 30, 10]);
        } else if (type === 'error') {
            this.vibrate([50, 30, 50]);
        }

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    /**
     * Create toast container if not exists
     */
    createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    },

    /**
     * Vibrate device if supported
     * @param {number|number[]} pattern - Vibration pattern
     */
    vibrate(pattern) {
        if (this.config.vibrateOnAction && navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    },

    /**
     * Update number display with animation
     * @param {HTMLElement} element - Number display element
     * @param {number} newValue - New value to display
     * @param {number} duration - Animation duration in ms
     */
    animateNumber(element, newValue, duration = 500) {
        const startValue = parseInt(element.textContent) || 0;
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(startValue + (newValue - startValue) * eased);

            element.textContent = current.toLocaleString();

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    },

    /**
     * Create selection card group (single select)
     * @param {HTMLElement} container - Container element
     * @param {Function} onChange - Callback when selection changes
     */
    createSelectionGroup(container, onChange) {
        container.querySelectorAll('.selection-card').forEach(card => {
            card.addEventListener('click', () => {
                // Deselect all
                container.querySelectorAll('.selection-card').forEach(c => {
                    c.classList.remove('selected');
                });

                // Select this one
                card.classList.add('selected');
                this.vibrate(10);

                if (onChange) {
                    onChange(card.dataset.value, card);
                }
            });
        });
    },

    /**
     * Create multi-selection card group
     * @param {HTMLElement} container - Container element
     * @param {Function} onChange - Callback when selection changes
     */
    createMultiSelectionGroup(container, onChange) {
        container.querySelectorAll('.selection-card').forEach(card => {
            card.addEventListener('click', () => {
                card.classList.toggle('selected');
                this.vibrate(10);

                if (onChange) {
                    const selected = Array.from(container.querySelectorAll('.selection-card.selected'))
                        .map(c => c.dataset.value);
                    onChange(selected);
                }
            });
        });
    },

    /**
     * Show offline banner
     */
    showOfflineBanner() {
        if (document.querySelector('.offline-banner-large')) return;

        const banner = document.createElement('div');
        banner.className = 'offline-banner-large';
        banner.innerHTML = `
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3"/>
            </svg>
            <span>You are offline - Changes will sync when connected</span>
        `;
        document.body.prepend(banner);
        document.body.style.paddingTop = `${banner.offsetHeight}px`;
    },

    /**
     * Hide offline banner
     */
    hideOfflineBanner() {
        const banner = document.querySelector('.offline-banner-large');
        if (banner) {
            document.body.style.paddingTop = '';
            banner.remove();
        }
    },

    /**
     * Mark element as having optimistic update pending
     * @param {HTMLElement} element - Target element
     * @param {string} updateId - Unique ID for this update
     */
    markOptimisticPending(element, updateId) {
        element.classList.add('optimistic-pending');
        element.dataset.optimisticId = updateId;
    },

    /**
     * Mark optimistic update as successful
     * @param {HTMLElement} element - Target element
     */
    markOptimisticSuccess(element) {
        element.classList.remove('optimistic-pending');
        element.classList.add('optimistic-success');
        delete element.dataset.optimisticId;

        setTimeout(() => {
            element.classList.remove('optimistic-success');
        }, 300);
    },

    /**
     * Rollback optimistic update
     * @param {HTMLElement} element - Target element
     * @param {Function} rollbackFn - Function to restore previous state
     */
    rollbackOptimistic(element, rollbackFn) {
        element.classList.remove('optimistic-pending');
        element.classList.add('optimistic-rollback');
        delete element.dataset.optimisticId;

        if (rollbackFn) {
            rollbackFn();
        }

        setTimeout(() => {
            element.classList.remove('optimistic-rollback');
        }, 300);
    }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopFloorUX.init());
} else {
    ShopFloorUX.init();
}

// Listen for online/offline events
window.addEventListener('online', () => ShopFloorUX.hideOfflineBanner());
window.addEventListener('offline', () => ShopFloorUX.showOfflineBanner());

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ShopFloorUX;
}
