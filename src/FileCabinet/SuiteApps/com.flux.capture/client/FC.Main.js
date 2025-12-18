/**
 * Flux Capture - Main Application
 * Initialization and navigation setup
 */
(function() {
    'use strict';

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
     * Initialize UI controls (dark mode, sidebar, fullscreen)
     */
    function initUIControls() {
        // Load saved preferences
        var darkMode = localStorage.getItem('fc_darkMode') === 'true';
        var sidebarCollapsed = localStorage.getItem('fc_sidebarCollapsed') === 'true';

        if (darkMode) {
            document.body.classList.add('dark-mode');
            var btn = el('#btn-dark-mode');
            if (btn) btn.classList.add('active');
        }

        if (sidebarCollapsed) {
            document.body.classList.add('sidebar-collapsed');
        }

        // Dark mode toggle
        var darkModeBtn = el('#btn-dark-mode');
        if (darkModeBtn) {
            darkModeBtn.addEventListener('click', function() {
                document.body.classList.toggle('dark-mode');
                this.classList.toggle('active');
                var isDark = document.body.classList.contains('dark-mode');
                localStorage.setItem('fc_darkMode', isDark);

                // Update icon
                var icon = this.querySelector('i');
                if (icon) {
                    icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
                }
            });
        }

        // Fullscreen toggle
        var fullscreenBtn = el('#btn-fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', function() {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(function() {});
                    document.body.classList.add('fullscreen-mode');
                    this.classList.add('active');
                    var icon = this.querySelector('i');
                    if (icon) icon.className = 'fas fa-compress';
                } else {
                    document.exitFullscreen().catch(function() {});
                    document.body.classList.remove('fullscreen-mode');
                    this.classList.remove('active');
                    var icon = this.querySelector('i');
                    if (icon) icon.className = 'fas fa-expand';
                }
            });

            // Listen for fullscreen change (user pressed Esc)
            document.addEventListener('fullscreenchange', function() {
                if (!document.fullscreenElement) {
                    document.body.classList.remove('fullscreen-mode');
                    fullscreenBtn.classList.remove('active');
                    var icon = fullscreenBtn.querySelector('i');
                    if (icon) icon.className = 'fas fa-expand';
                }
            });
        }

        // Collapse sidebar
        var collapseBtn = el('#btn-collapse-sidebar');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', function() {
                document.body.classList.add('sidebar-collapsed');
                localStorage.setItem('fc_sidebarCollapsed', 'true');
            });
        }

        // Expand sidebar
        var expandBtn = el('#btn-expand-sidebar');
        if (expandBtn) {
            expandBtn.addEventListener('click', function() {
                document.body.classList.remove('sidebar-collapsed');
                localStorage.setItem('fc_sidebarCollapsed', 'false');
            });
        }
    }

    /**
     * Start the application
     */
    function startApp() {
        FCDebug.log('[FC.Main] Starting application...');

        // Set up navigation
        initNavigation();

        // Initialize UI controls (dark mode, sidebar, fullscreen)
        initUIControls();

        // Navigate to default route
        Router.navigate('dashboard');

        // Hide loading screen
        UI.hideLoading();

        FCDebug.log('[FC.Main] Application started');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp);
    } else {
        startApp();
    }

})();
