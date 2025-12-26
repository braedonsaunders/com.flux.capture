/**
 * Flux Capture - Core Framework
 * Router, API client, utilities
 */
(function() {
    'use strict';

    // ==========================================
    // LICENSE ENFORCEMENT
    // ==========================================

    var LICENSE_CACHE_KEY = '_fc_lic';
    var LICENSE_CACHE_TTL = 3600000; // 1 hour in ms

    var License = {
        _data: null,
        _checked: false,
        _unlicensedMode: false,

        /**
         * Initialize license check on app load
         * Uses server-side license status from FC_CONFIG
         */
        init: function() {
            var self = this;

            // Server already checked license - use that status
            var serverLicenseValid = window.FC_CONFIG && window.FC_CONFIG.licenseValid === true;

            if (serverLicenseValid) {
                // License is valid - cache and proceed normally
                self._data = { valid: true };
                self._checked = true;
                try {
                    localStorage.setItem(LICENSE_CACHE_KEY, JSON.stringify({
                        valid: true,
                        _expires: Date.now() + LICENSE_CACHE_TTL
                    }));
                } catch (e) {
                    // Cache write failed
                }
                return Promise.resolve(self._data);
            }

            // License invalid - enter unlicensed mode (allows Settings only)
            self._data = { valid: false };
            self._checked = true;
            self._unlicensedMode = true;

            console.warn('[License] No valid license - Settings access only');
            return Promise.resolve(self._data);
        },

        /**
         * Check if current route is allowed without license
         * @param {string} route - Route name
         * @returns {boolean}
         */
        isRouteAllowed: function(route) {
            // Settings is always allowed for license configuration
            if (route === 'settings') return true;
            // All other routes require license
            return this.isValid();
        },

        /**
         * Show license required overlay (doesn't block Settings)
         * Called when trying to access protected routes
         */
        showLicenseOverlay: function() {
            // Don't add multiple overlays
            if (document.getElementById('fc-license-overlay')) return;

            var overlay = document.createElement('div');
            overlay.id = 'fc-license-overlay';
            overlay.innerHTML =
                '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;">' +
                    '<div style="text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.2);max-width:500px;margin:20px;">' +
                        '<div style="width:64px;height:64px;background:#fee2e2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">' +
                            '<svg style="width:32px;height:32px;color:#ef4444;" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>' +
                            '</svg>' +
                        '</div>' +
                        '<h1 style="color:#1f2937;margin:0 0 12px;font-size:24px;font-weight:600;">License Required</h1>' +
                        '<p style="color:#6b7280;margin:0 0 24px;font-size:16px;">A valid Flux Capture license is required to use this feature.</p>' +
                        '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
                            '<button id="fc-license-settings-btn" style="background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;border:none;cursor:pointer;font-weight:500;font-size:14px;">Go to Settings</button>' +
                            '<a href="https://flux-com.vercel.app" target="_blank" style="display:inline-block;background:#e5e7eb;color:#374151;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;font-size:14px;">Get Licensed</a>' +
                        '</div>' +
                        '<p style="color:#9ca3af;margin:16px 0 0;font-size:12px;">Contact: sales@gantry.finance</p>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            // Handle Settings button click
            document.getElementById('fc-license-settings-btn').addEventListener('click', function() {
                License.hideLicenseOverlay();
                if (window.Router) {
                    Router.navigate('settings');
                }
            });
        },

        /**
         * Hide license overlay
         */
        hideLicenseOverlay: function() {
            var overlay = document.getElementById('fc-license-overlay');
            if (overlay) {
                overlay.remove();
            }
        },

        /**
         * Check if license is valid
         */
        isValid: function() {
            return this._data && this._data.valid === true;
        },

        /**
         * Check if in unlicensed mode (Settings only)
         */
        isUnlicensedMode: function() {
            return this._unlicensedMode === true;
        },

        /**
         * Check if specific module is enabled (not used for flat pricing)
         */
        hasModule: function(moduleName) {
            if (!this.isValid()) return false;
            return this._data.modules && this._data.modules.indexOf(moduleName) !== -1;
        },

        /**
         * Get current tier (not used for flat pricing)
         */
        getTier: function() {
            return this._data && this._data.valid ? this._data.tier : null;
        },

        /**
         * Refresh license status (reloads page to get fresh server check)
         */
        refresh: function() {
            // Clear cache and reload to get fresh server-side check
            try {
                localStorage.removeItem(LICENSE_CACHE_KEY);
            } catch (e) {}
            window.location.reload();
        }
    };

    // ==========================================
    // LOADING & TIMING
    // ==========================================
    var LOADING_START_TIME = Date.now();
    var MINIMUM_LOADING_TIME = 1800; // ms - minimum time to show loading animation

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================

    function el(selector) {
        return document.querySelector(selector);
    }

    function els(selector) {
        return document.querySelectorAll(selector);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatNumber(num, decimals) {
        decimals = decimals !== undefined ? decimals : 2;
        return (num || 0).toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    function formatCompact(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return String(num || 0);
    }

    function formatDate(date) {
        if (!date) return '';
        var d = new Date(date);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatDateInput(date) {
        if (!date) return '';
        var d = new Date(date);
        return d.toISOString().split('T')[0];
    }

    // ==========================================
    // STATUS HELPERS
    // ==========================================

    var StatusLabels = {
        1: 'Pending',
        2: 'Processing',
        3: 'Extracted',
        4: 'Needs Review',
        5: 'Rejected',
        6: 'Completed',
        7: 'Error'
    };

    var StatusClasses = {
        1: 'pending',
        2: 'processing',
        3: 'extracted',
        4: 'review',
        5: 'rejected',
        6: 'completed',
        7: 'error'
    };

    function getStatusLabel(status) {
        return StatusLabels[status] || 'Unknown';
    }

    function getStatusClass(status) {
        return StatusClasses[status] || 'pending';
    }

    function getConfidenceClass(confidence) {
        if (confidence >= 85) return 'high';
        if (confidence >= 60) return 'medium';
        return 'low';
    }

    // ==========================================
    // API CLIENT
    // ==========================================

    var API = {
        // Session state
        sessionExpired: false,

        // Interval registry for polling management
        _intervals: {},

        /**
         * Register an interval for centralized management
         * @param {string} id - Unique identifier for the interval
         * @param {number} intervalId - The interval ID from setInterval
         */
        registerInterval: function(id, intervalId) {
            this._intervals[id] = intervalId;
        },

        /**
         * Clear a specific registered interval
         * @param {string} id - Unique identifier for the interval
         */
        clearInterval: function(id) {
            if (this._intervals[id]) {
                clearInterval(this._intervals[id]);
                delete this._intervals[id];
            }
        },

        /**
         * Stop all registered polling intervals
         */
        stopAllPolling: function() {
            var self = this;
            Object.keys(this._intervals).forEach(function(id) {
                clearInterval(self._intervals[id]);
            });
            this._intervals = {};
            FCDebug.log('[API] All polling stopped');
        },

        /**
         * Handle API response and detect auth errors
         * @param {Response} response - Fetch response object
         * @returns {Promise} - Resolves with parsed data or rejects with error
         */
        _handleResponse: function(response) {
            var self = this;

            // Check for auth error status codes
            if (response.status === 401 || response.status === 403) {
                return self._handleSessionExpired('Authentication required');
            }

            return response.text().then(function(text) {
                // Check if response is HTML (login redirect)
                if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
                    return self._handleSessionExpired('Session expired');
                }

                try {
                    return JSON.parse(text);
                } catch (e) {
                    // JSON parse error might indicate login page redirect
                    if (text.indexOf('login') !== -1 || text.indexOf('Login') !== -1) {
                        return self._handleSessionExpired('Session expired');
                    }
                    throw new Error('Invalid JSON response: ' + text.substring(0, 100));
                }
            }).then(function(data) {
                // Check for auth error in response data
                if (data.error && (data.error.code === 'SESSION_EXPIRED' ||
                    data.error.code === 'INVALID_LOGIN' ||
                    data.error.code === 'SSS_AUTHORIZATION_REQUIRED')) {
                    return self._handleSessionExpired(data.error.message || 'Session expired');
                }

                // Check for license error
                if (data.error && (data.error.code === 'FLUX_LICENSE_REQUIRED' ||
                    data.error.code === 'FLUX_MODULE_REQUIRED')) {
                    License._lockUI(data.error.message || 'License required');
                    return Promise.reject(new Error(data.error.message));
                }

                if (data.success === false) {
                    var err = new Error(data.error ? data.error.message : 'API Error');
                    // Preserve full error structure for validation errors etc.
                    if (data.error) {
                        err.code = data.error.code;
                        err.details = data.error.details;
                    }
                    throw err;
                }
                return data.data;
            });
        },

        /**
         * Handle session expiration
         * @param {string} message - Error message
         * @returns {Promise} - Rejected promise
         */
        _handleSessionExpired: function(message) {
            if (!this.sessionExpired) {
                this.sessionExpired = true;
                this.stopAllPolling();
                UI.toast('Session expired. Please refresh and log in again.', 'error');
                FCDebug.log('[API] Session expired:', message);
            }
            return Promise.reject(new Error(message));
        },

        /**
         * Check if session is expired before making request
         * @returns {Promise|null} - Rejected promise if expired, null otherwise
         */
        _checkSession: function() {
            if (this.sessionExpired) {
                return Promise.reject(new Error('Session expired'));
            }
            return null;
        },

        /**
         * Make GET request to Router
         * @param {string} action - Action name
         * @param {object} params - Additional URL parameters
         * @returns {Promise}
         */
        get: function(action, params) {
            var sessionCheck = this._checkSession();
            if (sessionCheck) return sessionCheck;

            var self = this;
            params = params || {};
            var url = new URL(window.FC_CONFIG.apiUrl, window.location.origin);
            url.searchParams.append('action', action);

            Object.keys(params).forEach(function(key) {
                if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
                    url.searchParams.append(key, params[key]);
                }
            });

            return fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            })
            .then(function(response) {
                return self._handleResponse(response);
            });
        },

        /**
         * Make POST request to Router
         * @param {string} action - Action name
         * @param {object} body - Request body
         * @returns {Promise}
         */
        post: function(action, body) {
            var sessionCheck = this._checkSession();
            if (sessionCheck) return sessionCheck;

            var self = this;
            body = body || {};
            body.action = action;

            return fetch(window.FC_CONFIG.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            .then(function(response) {
                return self._handleResponse(response);
            });
        },

        /**
         * Make PUT request to Router
         * @param {string} action - Action name
         * @param {object} body - Request body
         * @returns {Promise}
         */
        put: function(action, body) {
            var sessionCheck = this._checkSession();
            if (sessionCheck) return sessionCheck;

            var self = this;
            body = body || {};
            body.action = action;

            return fetch(window.FC_CONFIG.apiUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            .then(function(response) {
                return self._handleResponse(response);
            });
        },

        /**
         * Make DELETE request to Router
         * NetSuite RESTlets don't reliably parse DELETE body, so we use URL params
         * @param {string} action - Action name
         * @param {object} params - Request parameters
         * @returns {Promise}
         */
        delete: function(action, params) {
            var sessionCheck = this._checkSession();
            if (sessionCheck) return sessionCheck;

            var self = this;
            params = params || {};
            params.action = action;

            // Build URL with query parameters (NetSuite RESTlets parse these reliably)
            var queryString = Object.keys(params).map(function(key) {
                return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
            }).join('&');

            var url = window.FC_CONFIG.apiUrl + (window.FC_CONFIG.apiUrl.indexOf('?') === -1 ? '?' : '&') + queryString;

            return fetch(url, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            })
            .then(function(response) {
                return self._handleResponse(response);
            });
        }
    };

    // ==========================================
    // ROUTER
    // ==========================================

    var VIEW_TRANSITION_DURATION = 250; // ms for view transitions
    var isFirstNavigation = true;

    var Router = {
        routes: {},
        currentRoute: null,
        currentParams: {},
        isTransitioning: false,

        /**
         * Register a route handler
         * @param {string} route - Route name
         * @param {function} init - Init function
         * @param {function} cleanup - Cleanup function (optional)
         */
        register: function(route, init, cleanup) {
            this.routes[route] = {
                init: init,
                cleanup: cleanup || null
            };
        },

        /**
         * Navigate to a route with smooth transitions
         * @param {string} route - Route name
         * @param {object} params - Route parameters
         */
        navigate: function(route, params) {
            var self = this;
            FCDebug.log('[Router] navigate called:', route, params);
            params = params || {};

            // License check - block non-settings routes if unlicensed
            if (!License.isRouteAllowed(route)) {
                FCDebug.log('[Router] Route blocked - license required:', route);
                License.showLicenseOverlay();
                return;
            }

            // Hide license overlay if navigating to allowed route
            License.hideLicenseOverlay();

            // Prevent navigation during transition
            if (this.isTransitioning) {
                FCDebug.log('[Router] Navigation blocked - transition in progress');
                return;
            }

            var container = el('#view-container');
            if (!container) {
                console.error('[Router] view-container not found');
                return;
            }

            // Update active topbar tab immediately
            els('.topbar-tab').forEach(function(tab) {
                tab.classList.toggle('active', tab.dataset.route === route);
            });

            // Call cleanup for previous route
            if (this.currentRoute && this.routes[this.currentRoute] && this.routes[this.currentRoute].cleanup) {
                try {
                    this.routes[this.currentRoute].cleanup();
                } catch (e) {
                    console.error('[Router] Cleanup error:', e);
                }
            }

            // First navigation - no exit animation needed
            if (isFirstNavigation || !container.innerHTML.trim()) {
                isFirstNavigation = false;
                this._renderView(container, route, params);
                return;
            }

            // Subsequent navigations - animate out then in
            this.isTransitioning = true;

            // Animate out current view
            container.classList.add('view-exiting');

            setTimeout(function() {
                // Clear container
                container.innerHTML = '';
                container.classList.remove('view-exiting');

                // Render new view with enter animation
                self._renderView(container, route, params);

                self.isTransitioning = false;
            }, VIEW_TRANSITION_DURATION);
        },

        /**
         * Render view into container with enter animation
         * @private
         */
        _renderView: function(container, route, params) {
            // Start with entering state
            container.classList.add('view-entering');

            // Execute handler for new route
            var routeConfig = this.routes[route];
            if (routeConfig && routeConfig.init) {
                try {
                    routeConfig.init(params);
                } catch (e) {
                    console.error('[Router] Init error:', e);
                    container.innerHTML = '<div class="empty-state"><div class="empty-icon error"><i class="fas fa-exclamation-triangle"></i></div><h4>Error Loading View</h4><p>' + escapeHtml(e.message) + '</p></div>';
                }
            } else {
                console.warn('[Router] No handler for route:', route);
                container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-question"></i></div><h4>View Not Found</h4><p>The requested view does not exist.</p></div>';
            }

            // Trigger enter animation on next frame
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    container.classList.remove('view-entering');
                    container.classList.add('view-entered');

                    // Clean up class after animation
                    setTimeout(function() {
                        container.classList.remove('view-entered');
                    }, VIEW_TRANSITION_DURATION);
                });
            });

            this.currentRoute = route;
            this.currentParams = params;
        }
    };

    // ==========================================
    // TEMPLATE HELPER
    // ==========================================

    /**
     * Render a template into a container
     * @param {string} templateId - Template element ID (without #)
     * @param {string} containerId - Container element ID (without #)
     */
    function renderTemplate(templateId, containerId) {
        FCDebug.log('[renderTemplate] Called:', templateId, '->', containerId);
        var template = el('#' + templateId);
        var container = el('#' + containerId);
        FCDebug.log('[renderTemplate] template:', template, 'container:', container);

        if (template && container) {
            var content = template.innerHTML;
            FCDebug.log('[renderTemplate] Content length:', content.length);
            container.innerHTML = content;
            FCDebug.log('[renderTemplate] Done, container.innerHTML length:', container.innerHTML.length);
        } else {
            console.warn('[Template] Not found:', templateId, containerId);
        }
    }

    // ==========================================
    // UI HELPERS
    // ==========================================

    var UI = {
        /**
         * Show toast notification
         * @param {string} message - Message text
         * @param {string} type - Toast type (success, error, warning, info)
         */
        toast: function(message, type) {
            type = type || 'info';
            var container = el('#toast-container');
            if (!container) return;

            var toast = document.createElement('div');
            toast.className = 'toast toast-' + type;

            var icons = {
                success: 'check-circle',
                error: 'exclamation-circle',
                warning: 'exclamation-triangle',
                info: 'info-circle'
            };

            toast.innerHTML = '<i class="fas fa-' + (icons[type] || 'info-circle') + '"></i><span>' + escapeHtml(message) + '</span>';
            container.appendChild(toast);

            // Trigger animation
            requestAnimationFrame(function() {
                toast.classList.add('visible');
            });

            // Remove after delay
            setTimeout(function() {
                toast.classList.remove('visible');
                setTimeout(function() {
                    toast.remove();
                }, 300);
            }, 4000);
        },

        /**
         * Update review badge count in topbar navigation
         * @param {number} count - Badge count
         */
        updateBadge: function(count) {
            var badge = el('#review-badge');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline-flex' : 'none';
            }
        },

        /**
         * Show loading state
         */
        showLoading: function() {
            var loading = el('#loading-screen');
            if (loading) loading.style.display = 'flex';
        },

        /**
         * Hide loading state with premium fade animation
         * Respects minimum display time for animation to complete
         */
        hideLoading: function() {
            FCDebug.log('[UI] hideLoading called');
            var loading = el('#loading-screen');
            FCDebug.log('[UI] loading-screen element:', loading);
            if (!loading) return;

            var elapsedTime = Date.now() - LOADING_START_TIME;
            var remainingTime = Math.max(0, MINIMUM_LOADING_TIME - elapsedTime);

            FCDebug.log('[UI] Loading elapsed:', elapsedTime, 'remaining:', remainingTime);

            function performHide() {
                // Add hidden class to trigger CSS fade animation
                loading.classList.add('hidden');

                // Remove from DOM after animation completes
                setTimeout(function() {
                    if (loading.parentNode) {
                        loading.parentNode.removeChild(loading);
                    }
                    FCDebug.log('[UI] Loading screen removed');
                }, 500);
            }

            if (remainingTime > 0) {
                // Wait for remaining time before hiding
                setTimeout(performHide, remainingTime);
            } else {
                // Already past minimum time, hide immediately
                performHide();
            }
        },

        /**
         * Show confirmation modal
         * @param {Object} options - Modal options
         * @param {string} options.title - Modal title
         * @param {string} options.message - Modal message
         * @param {string} options.confirmText - Confirm button text (default: 'Confirm')
         * @param {string} options.cancelText - Cancel button text (default: 'Cancel')
         * @param {string} options.type - Modal type: 'danger', 'warning', 'info' (default: 'info')
         * @returns {Promise} - Resolves true if confirmed, false if cancelled
         */
        confirm: function(options) {
            options = options || {};
            var title = options.title || 'Confirm';
            var message = options.message || 'Are you sure?';
            var confirmText = options.confirmText || 'Confirm';
            var cancelText = options.cancelText || 'Cancel';
            var type = options.type || 'info';

            return new Promise(function(resolve) {
                var modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.innerHTML =
                    '<div class="modal modal-' + type + '">' +
                        '<div class="modal-header">' +
                            '<h3>' + escapeHtml(title) + '</h3>' +
                            '<button class="btn btn-ghost btn-icon modal-close"><i class="fas fa-times"></i></button>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<p>' + escapeHtml(message) + '</p>' +
                        '</div>' +
                        '<div class="modal-footer">' +
                            '<button class="btn btn-secondary modal-cancel">' + escapeHtml(cancelText) + '</button>' +
                            '<button class="btn btn-' + (type === 'danger' ? 'danger' : 'primary') + ' modal-confirm">' + escapeHtml(confirmText) + '</button>' +
                        '</div>' +
                    '</div>';

                function close(result) {
                    modal.classList.remove('visible');
                    setTimeout(function() { modal.remove(); }, 200);
                    resolve(result);
                }

                modal.querySelector('.modal-close').addEventListener('click', function() { close(false); });
                modal.querySelector('.modal-cancel').addEventListener('click', function() { close(false); });
                modal.querySelector('.modal-confirm').addEventListener('click', function() { close(true); });
                modal.addEventListener('click', function(e) {
                    if (e.target === modal) close(false);
                });

                document.body.appendChild(modal);
                requestAnimationFrame(function() { modal.classList.add('visible'); });
            });
        },

        /**
         * Show prompt modal with input field
         * @param {string} message - Prompt message
         * @param {string} defaultValue - Default input value
         * @returns {Promise} - Resolves with input value or null if cancelled
         */
        prompt: function(message, defaultValue) {
            defaultValue = defaultValue || '';

            return new Promise(function(resolve) {
                var modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.innerHTML =
                    '<div class="modal">' +
                        '<div class="modal-header">' +
                            '<h3>Input Required</h3>' +
                            '<button class="btn btn-ghost btn-icon modal-close"><i class="fas fa-times"></i></button>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<p>' + escapeHtml(message) + '</p>' +
                            '<input type="text" class="prompt-input" value="' + escapeHtml(defaultValue) + '" style="width:100%; padding:8px 12px; border:1px solid var(--border-color); border-radius:6px; margin-top:12px; font-size:14px;">' +
                        '</div>' +
                        '<div class="modal-footer">' +
                            '<button class="btn btn-secondary modal-cancel">Cancel</button>' +
                            '<button class="btn btn-primary modal-confirm">OK</button>' +
                        '</div>' +
                    '</div>';

                var input = modal.querySelector('.prompt-input');

                function close(result) {
                    modal.classList.remove('visible');
                    setTimeout(function() { modal.remove(); }, 200);
                    resolve(result);
                }

                modal.querySelector('.modal-close').addEventListener('click', function() { close(null); });
                modal.querySelector('.modal-cancel').addEventListener('click', function() { close(null); });
                modal.querySelector('.modal-confirm').addEventListener('click', function() { close(input.value); });
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') close(input.value);
                    if (e.key === 'Escape') close(null);
                });
                modal.addEventListener('click', function(e) {
                    if (e.target === modal) close(null);
                });

                document.body.appendChild(modal);
                requestAnimationFrame(function() {
                    modal.classList.add('visible');
                    input.focus();
                    input.select();
                });
            });
        },

        /**
         * Show keyboard shortcuts help modal
         * Shared modal used across views
         */
        showKeyboardShortcuts: function() {
            var html = '<div class="shortcuts-modal">' +
                '<div class="shortcuts-content">' +
                    '<h3><i class="fas fa-keyboard"></i> Keyboard Shortcuts</h3>' +
                    '<div class="shortcuts-grid">' +
                        '<div class="shortcut-section">' +
                            '<div class="shortcut-section-title">Actions</div>' +
                            '<div class="shortcut-item"><kbd>A</kbd> <span>Approve & create</span></div>' +
                            '<div class="shortcut-item"><kbd>R</kbd> <span>Reject document</span></div>' +
                            '<div class="shortcut-item"><kbd>S</kbd> <span>Skip to next</span></div>' +
                            '<div class="shortcut-item"><kbd>Esc</kbd> <span>Back to documents</span></div>' +
                        '</div>' +
                        '<div class="shortcut-section">' +
                            '<div class="shortcut-section-title">Navigation</div>' +
                            '<div class="shortcut-item"><kbd>←</kbd> <span>Previous document</span></div>' +
                            '<div class="shortcut-item"><kbd>→</kbd> <span>Next document</span></div>' +
                            '<div class="shortcut-item"><kbd>Tab</kbd> <span>Next field</span></div>' +
                            '<div class="shortcut-item"><kbd>Shift+Tab</kbd> <span>Previous field</span></div>' +
                        '</div>' +
                        '<div class="shortcut-section">' +
                            '<div class="shortcut-section-title">Preview</div>' +
                            '<div class="shortcut-item"><kbd>+</kbd> <span>Zoom in</span></div>' +
                            '<div class="shortcut-item"><kbd>-</kbd> <span>Zoom out</span></div>' +
                            '<div class="shortcut-item"><kbd>Ctrl+0</kbd> <span>Reset zoom</span></div>' +
                        '</div>' +
                        '<div class="shortcut-section">' +
                            '<div class="shortcut-section-title">Other</div>' +
                            '<div class="shortcut-item"><kbd>Ctrl+S</kbd> <span>Save changes</span></div>' +
                            '<div class="shortcut-item"><kbd>Ctrl+Shift+V</kbd> <span>Quick assign palette</span></div>' +
                            '<div class="shortcut-item"><kbd>?</kbd> <span>Show this help</span></div>' +
                        '</div>' +
                    '</div>' +
                    '<button class="btn btn-primary btn-block" onclick="this.closest(\'.shortcuts-modal\').remove()">Got it!</button>' +
                '</div>' +
            '</div>';

            var modal = document.createElement('div');
            modal.innerHTML = html;
            document.body.appendChild(modal.firstChild);
        }
    };

    // ==========================================
    // EXPOSE TO GLOBAL SCOPE
    // ==========================================

    window.el = el;
    window.els = els;
    window.escapeHtml = escapeHtml;
    window.formatNumber = formatNumber;
    window.formatCompact = formatCompact;
    window.formatDate = formatDate;
    window.formatDateInput = formatDateInput;
    window.getStatusLabel = getStatusLabel;
    window.getStatusClass = getStatusClass;
    window.getConfidenceClass = getConfidenceClass;
    window.API = API;
    window.Router = Router;
    window.renderTemplate = renderTemplate;
    window.UI = UI;
    window.License = License;

    // Initialize license check on DOM ready
    document.addEventListener('DOMContentLoaded', function() {
        License.init().catch(function(error) {
            console.error('[License] Initialization error:', error);
        });
    });

    FCDebug.log('[FC.Core] Loaded');

})();
