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
