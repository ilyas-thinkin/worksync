/**
 * WorkSync Optimistic UI Manager
 * Handles immediate UI updates with background sync and rollback capability
 */

const OptimisticUI = {
    // Store pending operations
    pendingOperations: new Map(),

    // Store operation history for rollback
    operationHistory: [],

    // Maximum history size
    maxHistorySize: 50,

    // Configuration
    config: {
        retryAttempts: 3,
        retryDelay: 1000,
        timeout: 10000
    },

    /**
     * Initialize optimistic UI manager
     */
    init() {
        // Listen for online/offline events
        window.addEventListener('online', () => this.processPendingOperations());
        console.log('[OptimisticUI] Initialized');
    },

    /**
     * Execute an operation with optimistic update
     * @param {Object} options - Operation configuration
     * @returns {Promise<any>} - Operation result
     */
    async execute(options) {
        const {
            // Required
            apiCall,           // Async function that makes the API call
            updateUI,          // Function to apply the optimistic update to UI
            rollbackUI,        // Function to revert the UI on failure

            // Optional
            element = null,    // Element to show loading/feedback states
            successMessage = null,
            errorMessage = 'Operation failed',
            queueIfOffline = true,
            operationType = 'generic',
            operationData = {}
        } = options;

        const operationId = this.generateOperationId();

        // Mark element as pending
        if (element && typeof ShopFloorUX !== 'undefined') {
            ShopFloorUX.markOptimisticPending(element, operationId);
        }

        // Apply optimistic UI update immediately
        const previousState = updateUI();

        // Store operation info
        const operation = {
            id: operationId,
            type: operationType,
            data: operationData,
            previousState,
            rollbackUI,
            element,
            timestamp: Date.now(),
            status: 'pending'
        };

        this.pendingOperations.set(operationId, operation);
        this.addToHistory(operation);

        // If offline, queue for later
        if (!navigator.onLine && queueIfOffline) {
            this.queueForSync(operation, apiCall);
            return { success: true, queued: true, operationId };
        }

        // Execute API call
        try {
            const result = await this.executeWithRetry(apiCall, this.config.retryAttempts);

            // Success - confirm the update
            operation.status = 'success';
            this.pendingOperations.delete(operationId);

            if (element && typeof ShopFloorUX !== 'undefined') {
                ShopFloorUX.markOptimisticSuccess(element);
            }

            if (successMessage && typeof ShopFloorUX !== 'undefined') {
                ShopFloorUX.toast(successMessage, 'success');
            }

            return { success: true, data: result, operationId };

        } catch (error) {
            // Failure - rollback
            operation.status = 'failed';
            operation.error = error.message;
            this.pendingOperations.delete(operationId);

            // Rollback UI
            if (rollbackUI) {
                rollbackUI(previousState);
            }

            if (element && typeof ShopFloorUX !== 'undefined') {
                ShopFloorUX.rollbackOptimistic(element);
            }

            if (typeof ShopFloorUX !== 'undefined') {
                ShopFloorUX.toast(errorMessage, 'error');
            }

            return { success: false, error: error.message, operationId };
        }
    },

    /**
     * Execute API call with retry logic
     * @param {Function} apiCall - The API call function
     * @param {number} retries - Number of retries remaining
     */
    async executeWithRetry(apiCall, retries) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

            const result = await apiCall(controller.signal);
            clearTimeout(timeoutId);

            return result;
        } catch (error) {
            if (retries > 1 && this.isRetryableError(error)) {
                await this.delay(this.config.retryDelay);
                return this.executeWithRetry(apiCall, retries - 1);
            }
            throw error;
        }
    },

    /**
     * Check if error is retryable
     */
    isRetryableError(error) {
        // Network errors or 5xx errors are retryable
        if (error.name === 'AbortError') return false;
        if (error.status && error.status >= 400 && error.status < 500) return false;
        return true;
    },

    /**
     * Queue operation for sync when back online
     */
    queueForSync(operation, apiCall) {
        operation.status = 'queued';
        operation.apiCall = apiCall;

        // Also add to offline sync queue if available
        if (typeof OfflineSync !== 'undefined') {
            OfflineSync.queueAction({
                type: operation.type,
                data: operation.data,
                timestamp: operation.timestamp
            });
        }

        if (typeof ShopFloorUX !== 'undefined') {
            ShopFloorUX.toast('Saved offline - will sync when connected', 'warning');
        }
    },

    /**
     * Process pending operations when back online
     */
    async processPendingOperations() {
        const queuedOperations = Array.from(this.pendingOperations.values())
            .filter(op => op.status === 'queued');

        for (const operation of queuedOperations) {
            if (operation.apiCall) {
                try {
                    await this.executeWithRetry(operation.apiCall, this.config.retryAttempts);
                    operation.status = 'success';

                    if (operation.element && typeof ShopFloorUX !== 'undefined') {
                        ShopFloorUX.markOptimisticSuccess(operation.element);
                    }
                } catch (error) {
                    operation.status = 'failed';

                    if (operation.rollbackUI) {
                        operation.rollbackUI(operation.previousState);
                    }

                    if (operation.element && typeof ShopFloorUX !== 'undefined') {
                        ShopFloorUX.rollbackOptimistic(operation.element);
                    }
                }
            }

            this.pendingOperations.delete(operation.id);
        }
    },

    /**
     * Generate unique operation ID
     */
    generateOperationId() {
        return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Add operation to history
     */
    addToHistory(operation) {
        this.operationHistory.unshift({
            id: operation.id,
            type: operation.type,
            data: operation.data,
            timestamp: operation.timestamp,
            status: operation.status
        });

        // Trim history
        if (this.operationHistory.length > this.maxHistorySize) {
            this.operationHistory = this.operationHistory.slice(0, this.maxHistorySize);
        }
    },

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Create optimistic list item update
     * @param {Object} options - Options for list update
     */
    updateListItem(options) {
        const {
            listSelector,
            itemSelector,
            itemId,
            updateFn,
            rollbackFn
        } = options;

        const list = document.querySelector(listSelector);
        const item = list?.querySelector(`${itemSelector}[data-id="${itemId}"]`);

        if (!item) return { updateUI: () => {}, rollbackUI: () => {} };

        // Clone for rollback
        const clone = item.cloneNode(true);

        return {
            updateUI: () => {
                updateFn(item);
                return clone;
            },
            rollbackUI: (previousState) => {
                if (rollbackFn) {
                    rollbackFn(item, previousState);
                } else {
                    item.replaceWith(previousState);
                }
            }
        };
    },

    /**
     * Create optimistic counter update
     * @param {Object} options - Options for counter update
     */
    updateCounter(options) {
        const {
            selector,
            delta = 1,
            animate = true
        } = options;

        const element = document.querySelector(selector);
        if (!element) return { updateUI: () => {}, rollbackUI: () => {} };

        const currentValue = parseInt(element.textContent) || 0;
        const newValue = currentValue + delta;

        return {
            updateUI: () => {
                if (animate && typeof ShopFloorUX !== 'undefined') {
                    ShopFloorUX.animateNumber(element, newValue);
                } else {
                    element.textContent = newValue;
                }
                return currentValue;
            },
            rollbackUI: (previousValue) => {
                if (animate && typeof ShopFloorUX !== 'undefined') {
                    ShopFloorUX.animateNumber(element, previousValue);
                } else {
                    element.textContent = previousValue;
                }
            }
        };
    },

    /**
     * Create optimistic form submission
     * @param {Object} options - Form submission options
     */
    async submitForm(options) {
        const {
            form,
            endpoint,
            method = 'POST',
            transformData = (data) => data,
            onSuccess,
            onError,
            successMessage = 'Saved successfully',
            errorMessage = 'Failed to save'
        } = options;

        const formData = new FormData(form);
        const data = transformData(Object.fromEntries(formData));

        // Disable form during submission
        const inputs = form.querySelectorAll('input, select, textarea, button');
        inputs.forEach(el => el.disabled = true);

        const submitBtn = form.querySelector('[type="submit"], .btn-primary');
        if (submitBtn) {
            submitBtn.classList.add('feedback-loading');
        }

        try {
            const response = await fetch(endpoint, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
                credentials: 'same-origin'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || errorMessage);
            }

            const result = await response.json();

            if (onSuccess) {
                onSuccess(result);
            }

            if (typeof ShopFloorUX !== 'undefined') {
                ShopFloorUX.toast(successMessage, 'success');
            }

            return { success: true, data: result };

        } catch (error) {
            if (onError) {
                onError(error);
            }

            if (typeof ShopFloorUX !== 'undefined') {
                ShopFloorUX.toast(error.message || errorMessage, 'error');
            }

            return { success: false, error: error.message };

        } finally {
            // Re-enable form
            inputs.forEach(el => el.disabled = false);
            if (submitBtn) {
                submitBtn.classList.remove('feedback-loading');
            }
        }
    },

    /**
     * Batch multiple optimistic operations
     * @param {Array} operations - Array of operation configs
     */
    async executeBatch(operations) {
        const results = [];
        const rollbacks = [];

        // Apply all UI updates first
        for (const op of operations) {
            const previousState = op.updateUI();
            rollbacks.push({ rollbackUI: op.rollbackUI, previousState });
            results.push({ ...op, previousState });
        }

        // Execute all API calls
        try {
            await Promise.all(operations.map(op => op.apiCall()));

            // All succeeded
            if (typeof ShopFloorUX !== 'undefined') {
                ShopFloorUX.toast('All changes saved', 'success');
            }

            return { success: true, results };

        } catch (error) {
            // Rollback all
            for (const rb of rollbacks) {
                if (rb.rollbackUI) {
                    rb.rollbackUI(rb.previousState);
                }
            }

            if (typeof ShopFloorUX !== 'undefined') {
                ShopFloorUX.toast('Failed to save changes', 'error');
            }

            return { success: false, error: error.message };
        }
    },

    /**
     * Create debounced optimistic update (for rapid changes)
     * @param {Function} updateFn - The update function
     * @param {number} delay - Debounce delay in ms
     */
    createDebouncedUpdate(updateFn, delay = 300) {
        let timeoutId = null;
        let pendingUpdate = null;

        return async (options) => {
            pendingUpdate = options;

            // Apply UI update immediately
            options.updateUI();

            // Clear previous timeout
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            // Schedule API call
            return new Promise((resolve) => {
                timeoutId = setTimeout(async () => {
                    const result = await this.execute(pendingUpdate);
                    resolve(result);
                }, delay);
            });
        };
    }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => OptimisticUI.init());
} else {
    OptimisticUI.init();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OptimisticUI;
}
