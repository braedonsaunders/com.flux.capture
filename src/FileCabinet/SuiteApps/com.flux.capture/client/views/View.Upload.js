/**
 * Flux Capture - Enhanced Upload View Controller
 * World-class upload experience with detailed progress tracking
 */
(function() {
    'use strict';

    var UploadController = {
        files: [],
        fileStatuses: [], // Track individual file upload status
        docType: 'auto',
        isUploading: false,
        isCancelled: false,
        uploadStartTime: null,
        successCount: 0,
        errorCount: 0,

        init: function() {
            renderTemplate('tpl-upload', 'view-container');
            this.bindEvents();
            this.reset();
            this.loadEmailInboxInfo();
        },

        reset: function() {
            this.files = [];
            this.fileStatuses = [];
            this.isUploading = false;
            this.isCancelled = false;
            this.uploadStartTime = null;
            this.successCount = 0;
            this.errorCount = 0;
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
            this.on('#btn-clear-queue', 'click', function() {
                self.clearQueue();
            });

            this.on('#btn-add-more', 'click', function() {
                fileInput.click();
            });

            this.on('#btn-process', 'click', function() {
                self.processQueue();
            });
        },

        on: function(selector, event, handler) {
            var element = el(selector);
            if (element) {
                element.addEventListener(event, handler);
            }
        },

        handleFiles: function(fileList) {
            var self = this;
            var newFiles = Array.from(fileList);

            // Filter valid file types
            var validTypes = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif'];
            var validFiles = [];
            var invalidFiles = [];

            newFiles.forEach(function(f) {
                var ext = f.name.split('.').pop().toLowerCase();
                if (validTypes.indexOf(ext) >= 0) {
                    validFiles.push(f);
                } else {
                    invalidFiles.push(f.name);
                }
            });

            if (invalidFiles.length > 0) {
                UI.toast('Skipped ' + invalidFiles.length + ' unsupported file(s)', 'warning');
            }

            if (validFiles.length === 0) {
                return;
            }

            // Add files with status tracking
            validFiles.forEach(function(f) {
                self.files.push(f);
                self.fileStatuses.push({
                    name: f.name,
                    size: f.size,
                    status: 'pending', // pending, uploading, processing, success, error
                    progress: 0,
                    error: null,
                    documentId: null
                });
            });

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
                list.innerHTML = this.fileStatuses.map(function(fs, i) {
                    var ext = fs.name.split('.').pop().toUpperCase();
                    var isPdf = ext === 'PDF';
                    var statusClass = 'status-' + fs.status;
                    var statusIcon = self.getStatusIcon(fs.status);

                    return '<div class="queue-file-item ' + statusClass + '" data-index="' + i + '">' +
                        '<div class="file-icon" style="background:' + (isPdf ? 'var(--color-danger-bg);color:var(--color-danger)' : 'var(--color-primary-bg);color:var(--color-primary)') + '">' +
                            '<i class="fas fa-file-' + (isPdf ? 'pdf' : 'image') + '"></i>' +
                        '</div>' +
                        '<div class="file-info">' +
                            '<span class="file-name">' + escapeHtml(fs.name) + '</span>' +
                            '<span class="file-meta">' +
                                '<span class="file-size">' + self.formatFileSize(fs.size) + '</span>' +
                                (fs.error ? '<span class="file-error">' + escapeHtml(fs.error) + '</span>' : '') +
                            '</span>' +
                            (fs.status === 'uploading' || fs.status === 'processing' ?
                                '<div class="file-progress"><div class="file-progress-bar" style="width:' + fs.progress + '%"></div></div>' : '') +
                        '</div>' +
                        '<div class="file-status-icon ' + statusClass + '">' +
                            statusIcon +
                        '</div>' +
                        (fs.status === 'pending' && !self.isUploading ?
                            '<button class="btn btn-icon btn-ghost" data-remove="' + i + '" title="Remove">' +
                                '<i class="fas fa-xmark"></i>' +
                            '</button>' : '') +
                    '</div>';
                }).join('');

                // Bind remove buttons
                list.querySelectorAll('[data-remove]').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var idx = parseInt(this.dataset.remove);
                        self.files.splice(idx, 1);
                        self.fileStatuses.splice(idx, 1);
                        self.renderQueue();
                    });
                });
            }
        },

        getStatusIcon: function(status) {
            switch (status) {
                case 'pending':
                    return '<i class="fas fa-clock"></i>';
                case 'uploading':
                    return '<i class="fas fa-arrow-up fa-spin"></i>';
                case 'processing':
                    return '<i class="fas fa-cog fa-spin"></i>';
                case 'success':
                    return '<i class="fas fa-check-circle"></i>';
                case 'error':
                    return '<i class="fas fa-exclamation-circle"></i>';
                default:
                    return '';
            }
        },

        formatFileSize: function(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / 1024 / 1024).toFixed(2) + ' MB';
        },

        clearQueue: function() {
            if (this.isUploading) {
                if (!confirm('Cancel current upload?')) return;
                this.isCancelled = true;
            }
            this.reset();
            this.renderQueue();
        },

        processQueue: function() {
            var self = this;
            if (this.files.length === 0 || this.isUploading) return;

            this.isUploading = true;
            this.isCancelled = false;
            this.uploadStartTime = Date.now();
            this.successCount = 0;
            this.errorCount = 0;

            // Show progress view
            var queue = el('#upload-queue');
            var progress = el('#upload-progress');
            var progressTitle = el('#progress-title');
            var progressText = el('#progress-text');
            var progressBar = el('#progress-bar');
            var progressDetails = el('#progress-details');

            if (queue) queue.style.display = 'none';
            if (progress) progress.style.display = 'block';

            // Create detailed progress UI
            if (progressDetails) {
                progressDetails.innerHTML = this.renderProgressDetails();
            }

            var files = this.files.slice();
            var total = files.length;
            var current = 0;

            function updateProgress() {
                var percent = total > 0 ? ((current / total) * 100) : 0;
                if (progressBar) progressBar.style.width = percent + '%';

                var elapsed = Date.now() - self.uploadStartTime;
                var avgTime = current > 0 ? elapsed / current : 0;
                var remaining = Math.round((total - current) * avgTime / 1000);

                if (progressTitle) progressTitle.textContent = 'Uploading ' + current + ' of ' + total;
                if (progressText) {
                    var text = self.successCount + ' successful, ' + self.errorCount + ' failed';
                    if (remaining > 0 && current < total) {
                        text += ' • ~' + self.formatTime(remaining) + ' remaining';
                    }
                    progressText.textContent = text;
                }

                if (progressDetails) {
                    progressDetails.innerHTML = self.renderProgressDetails();
                }
            }

            function processNext() {
                if (self.isCancelled) {
                    self.showUploadComplete('Upload cancelled', 'cancelled');
                    return;
                }

                if (current >= total) {
                    self.showUploadComplete();
                    return;
                }

                var f = files[current];
                var fileStatus = self.fileStatuses[current];

                // Update status to uploading
                fileStatus.status = 'uploading';
                fileStatus.progress = 0;
                updateProgress();

                var reader = new FileReader();
                reader.onload = function() {
                    var base64 = reader.result.split(',')[1];

                    // Simulate progress while waiting for API
                    fileStatus.progress = 30;
                    updateProgress();

                    API.post('upload', {
                        fileName: f.name,
                        fileContent: base64,
                        documentType: self.docType
                    })
                    .then(function(response) {
                        fileStatus.status = 'success';
                        fileStatus.progress = 100;
                        fileStatus.documentId = response.data ? response.data.documentId : null;
                        self.successCount++;
                        current++;
                        updateProgress();

                        // Small delay for visual feedback
                        setTimeout(processNext, 100);
                    })
                    .catch(function(err) {
                        console.error('[Upload] Error:', err);
                        fileStatus.status = 'error';
                        fileStatus.progress = 100;
                        fileStatus.error = err.message || 'Upload failed';
                        self.errorCount++;
                        current++;
                        updateProgress();

                        setTimeout(processNext, 100);
                    });
                };

                reader.onerror = function() {
                    fileStatus.status = 'error';
                    fileStatus.error = 'Failed to read file';
                    self.errorCount++;
                    current++;
                    updateProgress();
                    setTimeout(processNext, 100);
                };

                reader.onprogress = function(e) {
                    if (e.lengthComputable) {
                        fileStatus.progress = Math.round((e.loaded / e.total) * 30);
                        updateProgress();
                    }
                };

                reader.readAsDataURL(f);
            }

            processNext();
        },

        renderProgressDetails: function() {
            var self = this;
            return this.fileStatuses.map(function(fs, i) {
                var statusClass = 'file-status-' + fs.status;
                var icon = self.getStatusIcon(fs.status);

                return '<div class="progress-file-item ' + statusClass + '">' +
                    '<span class="progress-file-icon">' + icon + '</span>' +
                    '<span class="progress-file-name">' + escapeHtml(fs.name) + '</span>' +
                    (fs.status === 'uploading' || fs.status === 'processing' ?
                        '<span class="progress-file-percent">' + fs.progress + '%</span>' : '') +
                    (fs.status === 'error' ?
                        '<span class="progress-file-error" title="' + escapeHtml(fs.error || '') + '"><i class="fas fa-triangle-exclamation"></i></span>' : '') +
                '</div>';
            }).join('');
        },

        formatTime: function(seconds) {
            if (seconds < 60) return seconds + 's';
            var mins = Math.floor(seconds / 60);
            var secs = seconds % 60;
            return mins + 'm ' + secs + 's';
        },

        showUploadComplete: function(customTitle, status) {
            var self = this;
            var progressTitle = el('#progress-title');
            var progressText = el('#progress-text');
            var progressBar = el('#progress-bar');
            var progressSpinner = el('#progress-spinner');
            var progressComplete = el('#progress-complete');

            var isSuccess = this.errorCount === 0 && !status;
            var title = customTitle || (isSuccess ? 'Upload Complete!' : 'Upload Finished');
            var iconClass = isSuccess ? 'success' : (status === 'cancelled' ? 'cancelled' : 'partial');

            if (progressTitle) progressTitle.textContent = title;
            if (progressBar) progressBar.style.width = '100%';
            if (progressSpinner) progressSpinner.style.display = 'none';

            // Summary message
            var summary = '';
            if (status === 'cancelled') {
                summary = 'Upload was cancelled. ' + this.successCount + ' file(s) uploaded.';
            } else {
                summary = this.successCount + ' file(s) uploaded successfully';
                if (this.errorCount > 0) {
                    summary += ', ' + this.errorCount + ' failed';
                }
            }
            if (progressText) progressText.textContent = summary;

            // Show completion icon
            if (progressComplete) {
                progressComplete.innerHTML = '<div class="complete-icon ' + iconClass + '">' +
                    '<i class="fas fa-' + (isSuccess ? 'check-circle' : status === 'cancelled' ? 'stop-circle' : 'exclamation-circle') + '"></i>' +
                '</div>';
                progressComplete.style.display = 'flex';
            }

            // Reset state
            this.isUploading = false;

            // Navigate after delay
            setTimeout(function() {
                self.reset();
                Router.navigate('queue');
            }, 2000);
        },

        loadEmailInboxInfo: function() {
            var self = this;

            API.get('emailInboxStatus')
                .then(function(result) {
                    var data = result.data || result || {};
                    var emailAddress = data.emailAddress;

                    if (emailAddress) {
                        var infoEl = el('#email-inbox-info');
                        var addressEl = el('#upload-email-address');
                        var copyBtn = el('#btn-copy-upload-email');

                        if (infoEl) infoEl.style.display = 'block';
                        if (addressEl) addressEl.textContent = emailAddress;

                        if (copyBtn) {
                            copyBtn.addEventListener('click', function() {
                                self.copyEmailToClipboard(emailAddress);
                            });
                        }
                    }
                })
                .catch(function(err) {
                    // Silently fail - email inbox is optional
                    console.debug('Email inbox info not available:', err);
                });
        },

        copyEmailToClipboard: function(emailAddress) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(emailAddress)
                    .then(function() {
                        UI.toast('Email address copied', 'success');
                    })
                    .catch(function() {
                        UI.toast('Failed to copy', 'error');
                    });
            } else {
                // Fallback
                var temp = document.createElement('input');
                temp.value = emailAddress;
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                document.body.removeChild(temp);
                UI.toast('Email address copied', 'success');
            }
        },

        cleanup: function() {
            this.reset();
        }
    };

    Router.register('upload',
        function(params) { UploadController.init(params); },
        function() { UploadController.cleanup(); }
    );

    FCDebug.log('[View.Upload] Enhanced Upload Loaded');

})();
