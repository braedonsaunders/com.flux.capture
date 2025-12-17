/**
 * Flux Capture - Core Framework
 * Router, API client, utilities
 */
(function() {
    'use strict';

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
        /**
         * Make GET request to Router
         * @param {string} action - Action name
         * @param {object} params - Additional URL parameters
         * @returns {Promise}
         */
        get: function(action, params) {
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
                return response.text();
            })
            .then(function(text) {
                try {
                    return JSON.parse(text);
                } catch (e) {
                    throw new Error('Invalid JSON response: ' + text.substring(0, 100));
                }
            })
            .then(function(data) {
                if (data.success === false) {
                    throw new Error(data.error ? data.error.message : 'API Error');
                }
                return data.data;
            });
        },

        /**
         * Make POST request to Router
         * @param {string} action - Action name
         * @param {object} body - Request body
         * @returns {Promise}
         */
        post: function(action, body) {
            body = body || {};
            body.action = action;

            return fetch(window.FC_CONFIG.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            .then(function(response) {
                return response.text();
            })
            .then(function(text) {
                try {
                    return JSON.parse(text);
                } catch (e) {
                    throw new Error('Invalid JSON response: ' + text.substring(0, 100));
                }
            })
            .then(function(data) {
                if (data.success === false) {
                    throw new Error(data.error ? data.error.message : 'API Error');
                }
                return data.data;
            });
        },

        /**
         * Make PUT request to Router
         * @param {string} action - Action name
         * @param {object} body - Request body
         * @returns {Promise}
         */
        put: function(action, body) {
            body = body || {};
            body.action = action;

            return fetch(window.FC_CONFIG.apiUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            .then(function(response) {
                return response.text();
            })
            .then(function(text) {
                try {
                    return JSON.parse(text);
                } catch (e) {
                    throw new Error('Invalid JSON response: ' + text.substring(0, 100));
                }
            })
            .then(function(data) {
                if (data.success === false) {
                    throw new Error(data.error ? data.error.message : 'API Error');
                }
                return data.data;
            });
        },

        /**
         * Make DELETE request to Router
         * @param {string} action - Action name
         * @param {object} body - Request body
         * @returns {Promise}
         */
        delete: function(action, body) {
            body = body || {};
            body.action = action;

            return fetch(window.FC_CONFIG.apiUrl, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            .then(function(response) {
                return response.text();
            })
            .then(function(text) {
                try {
                    return JSON.parse(text);
                } catch (e) {
                    throw new Error('Invalid JSON response: ' + text.substring(0, 100));
                }
            })
            .then(function(data) {
                if (data.success === false) {
                    throw new Error(data.error ? data.error.message : 'API Error');
                }
                return data.data;
            });
        }
    };

    // ==========================================
    // ROUTER
    // ==========================================

    var Router = {
        routes: {},
        currentRoute: null,
        currentParams: {},

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
         * Navigate to a route
         * @param {string} route - Route name
         * @param {object} params - Route parameters
         */
        navigate: function(route, params) {
            params = params || {};

            // Call cleanup for previous route
            if (this.currentRoute && this.routes[this.currentRoute] && this.routes[this.currentRoute].cleanup) {
                try {
                    this.routes[this.currentRoute].cleanup();
                } catch (e) {
                    console.error('[Router] Cleanup error:', e);
                }
            }

            // Update active nav link
            els('.nav-link').forEach(function(link) {
                link.classList.toggle('active', link.dataset.route === route);
            });

            // Clear view container
            var container = el('#view-container');
            if (container) {
                container.innerHTML = '';
            }

            // Execute handler for new route
            var routeConfig = this.routes[route];
            if (routeConfig && routeConfig.init) {
                try {
                    routeConfig.init(params);
                } catch (e) {
                    console.error('[Router] Init error:', e);
                    if (container) {
                        container.innerHTML = '<div class="empty-state"><div class="empty-icon error"><i class="fas fa-exclamation-triangle"></i></div><h4>Error Loading View</h4><p>' + escapeHtml(e.message) + '</p></div>';
                    }
                }
            } else {
                console.warn('[Router] No handler for route:', route);
                if (container) {
                    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-question"></i></div><h4>View Not Found</h4><p>The requested view does not exist.</p></div>';
                }
            }

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
        var template = el('#' + templateId);
        var container = el('#' + containerId);

        if (template && container) {
            container.innerHTML = template.innerHTML;
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
         * Update queue badge count
         * @param {number} count - Badge count
         */
        updateBadge: function(count) {
            var badge = el('#queue-badge');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'flex' : 'none';
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
         * Hide loading state
         */
        hideLoading: function() {
            var loading = el('#loading-screen');
            if (loading) loading.style.display = 'none';
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

    console.log('[FC.Core] Loaded');

})();
