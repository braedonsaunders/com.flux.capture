/**
 * Flux Capture - Upload View Controller
 */
(function() {
    'use strict';

    var UploadController = {
        files: [],
        docType: 'auto',

        init: function() {
            renderTemplate('tpl-upload', 'view-container');
            this.bindEvents();
        },

        bindEvents: function() {
            var self = this;

            // Dropzone
            var dropzone = el('#upload-zone');
            var fileInput = el('#file-input');

            if (dropzone && fileInput) {
                dropzone.addEventListener('click', function() {
                    fileInput.click();
                });

                dropzone.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    dropzone.classList.add('dragover');
                });

                dropzone.addEventListener('dragleave', function() {
                    dropzone.classList.remove('dragover');
                });

                dropzone.addEventListener('drop', function(e) {
                    e.preventDefault();
                    dropzone.classList.remove('dragover');
                    self.handleFiles(e.dataTransfer.files);
                });

                fileInput.addEventListener('change', function(e) {
                    self.handleFiles(e.target.files);
                });
            }

            // Type selector
            var typeSelector = el('#type-selector');
            if (typeSelector) {
                typeSelector.addEventListener('click', function(e) {
                    var card = e.target.closest('.type-card');
                    if (card) {
                        els('.type-card').forEach(function(c) { c.classList.remove('active'); });
                        card.classList.add('active');
                        var input = card.querySelector('input');
                        if (input) {
                            input.checked = true;
                            self.docType = input.value;
                        }
                    }
                });
            }

            // Queue buttons
            var clearBtn = el('#btn-clear-queue');
            if (clearBtn) {
                clearBtn.addEventListener('click', function() {
                    self.clearQueue();
                });
            }

            var addMoreBtn = el('#btn-add-more');
            if (addMoreBtn) {
                addMoreBtn.addEventListener('click', function() {
                    fileInput.click();
                });
            }

            var processBtn = el('#btn-process');
            if (processBtn) {
                processBtn.addEventListener('click', function() {
                    self.processQueue();
                });
            }
        },

        handleFiles: function(fileList) {
            var self = this;
            var newFiles = Array.from(fileList);

            // Filter valid file types
            var validTypes = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif'];
            newFiles = newFiles.filter(function(f) {
                var ext = f.name.split('.').pop().toLowerCase();
                return validTypes.indexOf(ext) >= 0;
            });

            if (newFiles.length === 0) {
                UI.toast('No valid files selected', 'warning');
                return;
            }

            this.files = this.files.concat(newFiles);
            this.renderQueue();
        },

        renderQueue: function() {
            var self = this;
            var dropzone = el('#upload-zone');
            var queue = el('#upload-queue');
            var list = el('#queue-list');
            var countEl = el('#file-count');

            if (this.files.length === 0) {
                if (dropzone) dropzone.style.display = 'block';
                if (queue) queue.style.display = 'none';
                return;
            }

            if (dropzone) dropzone.style.display = 'none';
            if (queue) queue.style.display = 'block';
            if (countEl) countEl.textContent = this.files.length;

            if (list) {
                list.innerHTML = this.files.map(function(f, i) {
                    var ext = f.name.split('.').pop().toUpperCase();
                    var isPdf = ext === 'PDF';
                    return '<div class="queue-file-item">' +
                        '<div class="file-icon" style="background:' + (isPdf ? 'var(--color-danger-bg);color:var(--color-danger)' : 'var(--color-primary-bg);color:var(--color-primary)') + '">' +
                            '<i class="fas fa-file-' + (isPdf ? 'pdf' : 'image') + '"></i>' +
                        '</div>' +
                        '<div class="file-info">' +
                            '<span class="file-name">' + escapeHtml(f.name) + '</span>' +
                            '<span class="file-size">' + (f.size / 1024 / 1024).toFixed(2) + ' MB</span>' +
                        '</div>' +
                        '<button class="btn btn-icon btn-ghost" data-remove="' + i + '" title="Remove">' +
                            '<i class="fas fa-xmark"></i>' +
                        '</button>' +
                    '</div>';
                }).join('');

                // Bind remove buttons
                list.querySelectorAll('[data-remove]').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var idx = parseInt(this.dataset.remove);
                        self.files.splice(idx, 1);
                        self.renderQueue();
                    });
                });
            }
        },

        clearQueue: function() {
            this.files = [];
            this.renderQueue();
        },

        processQueue: function() {
            var self = this;
            if (this.files.length === 0) return;

            var dropzone = el('#upload-zone');
            var queue = el('#upload-queue');
            var progress = el('#upload-progress');
            var progressTitle = el('#progress-title');
            var progressText = el('#progress-text');
            var progressBar = el('#progress-bar');

            if (queue) queue.style.display = 'none';
            if (progress) progress.style.display = 'block';

            var files = this.files.slice();
            var total = files.length;
            var current = 0;

            function processNext() {
                if (current >= total) {
                    if (progressTitle) progressTitle.textContent = 'Complete!';
                    if (progressText) progressText.textContent = 'All files uploaded successfully';
                    self.files = [];

                    setTimeout(function() {
                        Router.navigate('queue');
                    }, 1500);
                    return;
                }

                var f = files[current];
                if (progressTitle) progressTitle.textContent = 'Uploading...';
                if (progressText) progressText.textContent = 'Processing ' + (current + 1) + ' of ' + total + ': ' + f.name;
                if (progressBar) progressBar.style.width = ((current + 1) / total * 100) + '%';

                var reader = new FileReader();
                reader.onload = function() {
                    var base64 = reader.result.split(',')[1];
                    API.post('upload', {
                        fileName: f.name,
                        fileContent: base64,
                        documentType: self.docType
                    })
                    .then(function() {
                        current++;
                        processNext();
                    })
                    .catch(function(err) {
                        console.error('[Upload] Error:', err);
                        current++;
                        processNext();
                    });
                };
                reader.readAsDataURL(f);
            }

            processNext();
        },

        cleanup: function() {
            this.files = [];
            this.docType = 'auto';
        }
    };

    Router.register('upload',
        function(params) { UploadController.init(params); },
        function() { UploadController.cleanup(); }
    );

    console.log('[View.Upload] Loaded');

})();
