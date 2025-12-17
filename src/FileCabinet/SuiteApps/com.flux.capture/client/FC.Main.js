/**
 * Flux Capture - Main Application
 * Initialization and navigation setup
 */
(function() {
    'use strict';

    /**
     * Initialize user info in sidebar
     */
    function initUserInfo() {
        if (!window.FC_CONFIG || !window.FC_CONFIG.user) return;

        var user = window.FC_CONFIG.user;
        var nameEl = el('#user-name');
        var avatarEl = el('#user-avatar');

        if (nameEl && user.name) {
            nameEl.textContent = user.name;
        }

        if (avatarEl && user.name) {
            var parts = user.name.split(' ');
            var initials = parts.length >= 2
                ? (parts[0][0] + parts[1][0]).toUpperCase()
                : user.name.substring(0, 2).toUpperCase();
            avatarEl.textContent = initials;
        }
    }

    /**
     * Initialize navigation click handlers
     */
    function initNavigation() {
        // Sidebar nav links
        els('.nav-link').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var route = this.dataset.route;
                if (route) {
                    Router.navigate(route);
                }
            });
        });

        // Handle card action links with data-route
        document.addEventListener('click', function(e) {
            var link = e.target.closest('[data-route]');
            if (link && !link.classList.contains('nav-link')) {
                e.preventDefault();
                var route = link.dataset.route;
                if (route) {
                    Router.navigate(route);
                }
            }
        });
    }

    /**
     * Start the application
     */
    function startApp() {
        console.log('[FC.Main] Starting application...');

        // Initialize user info
        initUserInfo();

        // Set up navigation
        initNavigation();

        // Navigate to default route
        Router.navigate('dashboard');

        // Hide loading screen
        UI.hideLoading();

        console.log('[FC.Main] Application started');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp);
    } else {
        startApp();
    }

})();
