/**
 * Flux Capture - Main Application
 * Initialization and navigation setup
 */
(function() {
    'use strict';

    /**
     * Fetch and update review badge count on page load
     * Status values: 3=EXTRACTED, 4=NEEDS_REVIEW, 7=ERROR
     */
    function updateReviewBadge() {
        API.get('queue', { page: 1, pageSize: 500 }).then(function(data) {
            var documents = (data && data.queue) || [];
            var reviewCount = documents.filter(function(d) {
                var s = String(d.status);
                return s === '4' || s === '3' || s === '7'; // NEEDS_REVIEW, EXTRACTED, ERROR
            }).length;
            UI.updateBadge(reviewCount);
        }).catch(function(err) {
            FCDebug.log('[FC.Main] Failed to update review badge:', err);
        });
    }

    // Expose globally for use by other modules
    window.updateReviewBadge = updateReviewBadge;

    /**
     * Initialize navigation click handlers
     */
    function initNavigation() {
        // Topbar tabs
        els('.topbar-tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                e.preventDefault();
                var route = this.dataset.route;
                if (route) {
                    Router.navigate(route);
                }
            });
        });

        // Topbar control buttons with data-route (settings)
        els('.topbar-control[data-route]').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                var route = this.dataset.route;
                if (route) {
                    Router.navigate(route);
                }
            });
        });

        // Handle other card action links with data-route
        document.addEventListener('click', function(e) {
            var link = e.target.closest('[data-route]');
            if (link && !link.classList.contains('topbar-tab') && !link.classList.contains('topbar-control')) {
                e.preventDefault();
                var route = link.dataset.route;
                if (route) {
                    Router.navigate(route);
                }
            }
        });
    }

    /**
     * Initialize UI controls (dark mode, fullscreen)
     */
    function initUIControls() {
        // Load saved dark mode preference
        var darkMode = localStorage.getItem('fc_darkMode') === 'true';

        if (darkMode) {
            document.body.classList.add('dark-mode');
            var btn = el('#btn-dark-mode');
            if (btn) {
                btn.classList.add('active');
                var icon = btn.querySelector('i');
                if (icon) icon.className = 'fas fa-sun';
            }
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

        // Fullscreen toggle - with iframe support
        var fullscreenBtn = el('#btn-fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', function() {
                var btn = this;
                var isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

                if (!isFullscreen) {
                    // Try to enter fullscreen
                    var elem = document.documentElement;
                    var requestFS = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.mozRequestFullScreen || elem.msRequestFullscreen;

                    if (requestFS) {
                        requestFS.call(elem).then(function() {
                            document.body.classList.add('fullscreen-mode');
                            btn.classList.add('active');
                            var icon = btn.querySelector('i');
                            if (icon) icon.className = 'fas fa-compress';
                        }).catch(function(err) {
                            FCDebug.log('[Fullscreen] Failed:', err.message);
                            UI.toast('Fullscreen not available in this context', 'warning');
                        });
                    }
                } else {
                    // Exit fullscreen
                    var exitFS = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
                    if (exitFS) {
                        exitFS.call(document).catch(function() {});
                    }
                    document.body.classList.remove('fullscreen-mode');
                    btn.classList.remove('active');
                    var icon = btn.querySelector('i');
                    if (icon) icon.className = 'fas fa-expand';
                }
            });

            // Listen for fullscreen change (user pressed Esc)
            var fsChangeHandler = function() {
                var isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
                if (!isFullscreen) {
                    document.body.classList.remove('fullscreen-mode');
                    fullscreenBtn.classList.remove('active');
                    var icon = fullscreenBtn.querySelector('i');
                    if (icon) icon.className = 'fas fa-expand';
                }
            };
            document.addEventListener('fullscreenchange', fsChangeHandler);
            document.addEventListener('webkitfullscreenchange', fsChangeHandler);
        }

        // Minimize topbar toggle
        var minimizeBtn = el('#btn-minimize-topbar');
        if (minimizeBtn) {
            // Restore from localStorage
            if (localStorage.getItem('fc_topbarMinimized') === 'true') {
                document.body.classList.add('topbar-minimized');
                minimizeBtn.classList.add('active');
            }

            minimizeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var willMinimize = !document.body.classList.contains('topbar-minimized');
                document.body.classList.toggle('topbar-minimized');
                this.classList.toggle('active');
                localStorage.setItem('fc_topbarMinimized', willMinimize);

                // Force immediate minimize by temporarily disabling hover
                if (willMinimize) {
                    var topbar = document.querySelector('.app-topbar');
                    if (topbar) {
                        topbar.classList.add('no-hover');
                        this.blur();
                        setTimeout(function() {
                            topbar.classList.remove('no-hover');
                        }, 300);
                    }
                }
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

        // Initialize UI controls (dark mode, fullscreen)
        initUIControls();

        // Update review badge count on page load
        updateReviewBadge();

        // Navigate to default route (Ingest)
        Router.navigate('ingest');

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
