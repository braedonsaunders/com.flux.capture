/**
 * Flux Capture - Settings View Controller
 */
(function() {
    'use strict';

    var SettingsController = {
        init: function() {
            renderTemplate('tpl-settings', 'view-container');
            this.bindEvents();
        },

        bindEvents: function() {
            var self = this;

            // Threshold slider
            var thresholdEl = el('#auto-threshold');
            var thresholdValue = el('#threshold-value');
            if (thresholdEl && thresholdValue) {
                thresholdEl.addEventListener('input', function() {
                    thresholdValue.textContent = this.value + '%';
                });
            }

            // Save button
            var saveBtn = el('#btn-save-settings');
            if (saveBtn) {
                saveBtn.addEventListener('click', function() {
                    UI.toast('Settings saved!', 'success');
                });
            }

            // Clear cache button
            var clearCacheBtn = el('#btn-clear-cache');
            if (clearCacheBtn) {
                clearCacheBtn.addEventListener('click', function() {
                    self.clearFormCache();
                });
            }
        },

        /**
         * Clear the server-side form layout cache
         */
        clearFormCache: function() {
            var btn = el('#btn-clear-cache');
            var statusRow = el('#cache-status');
            var statusText = el('#cache-status-text');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';
            }

            API.delete('clearcache', { cacheType: 'formlayout' })
                .then(function(result) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear Cache';
                    }
                    if (statusRow) statusRow.style.display = 'block';
                    if (statusText) {
                        statusText.innerHTML = '<i class="fas fa-check-circle" style="color:var(--color-success);"></i> ' +
                            'Cache cleared successfully. Form layouts will be re-extracted on next form load.';
                    }
                    UI.toast('Form layout cache cleared!', 'success');
                })
                .catch(function(err) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear Cache';
                    }
                    if (statusRow) statusRow.style.display = 'block';
                    if (statusText) {
                        statusText.innerHTML = '<i class="fas fa-exclamation-circle" style="color:var(--color-danger);"></i> ' +
                            'Error: ' + (err.message || 'Failed to clear cache');
                    }
                    UI.toast('Error clearing cache: ' + err.message, 'error');
                });
        },

        cleanup: function() {
            // Nothing to clean up
        }
    };

    Router.register('settings',
        function(params) { SettingsController.init(params); },
        function() { SettingsController.cleanup(); }
    );

    console.log('[View.Settings] Loaded');

})();
