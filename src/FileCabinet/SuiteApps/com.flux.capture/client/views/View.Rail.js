/**
 * Flux Capture - Flow View Controller
 * Theatrical upload portal + processing visualization
 * Combines upload experience with animated document processing theater
 */
(function() {
    'use strict';

    var DocStatus = {
        PENDING: '1',
        PROCESSING: '2',
        EXTRACTED: '3',
        NEEDS_REVIEW: '4',
        REJECTED: '5',
        COMPLETED: '6',
        ERROR: '7'
    };

    var FlowController = {
        documents: [],
        pendingUploads: [],
        processingDocs: [],
        readyDocs: [],
        refreshInterval: null,
        REFRESH_MS: 3000,
        currentStage: 'upload', // upload | processing | complete
        uploadInProgress: false,
        selectedDocType: 'auto',
        particles: [],
        animationFrame: null,

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function() {
            this.documents = [];
            this.pendingUploads = [];
            this.processingDocs = [];
            this.readyDocs = [];
            this.currentStage = 'upload';
            this.uploadInProgress = false;

            renderTemplate('tpl-rail', 'view-container');
            this.bindEvents();
            this.loadData();
            this.startRefresh();
            this.initParticles();
        },

        cleanup: function() {
            this.stopRefresh();
            this.stopParticles();
            this.documents = [];
        },

        // ==========================================
        // DATA LOADING
        // ==========================================
        loadData: function() {
            var self = this;

            API.get('queue', { pageSize: 100 }).then(function(data) {
                self.documents = (data && data.queue) || [];
                self.categorizeDocuments();
                self.render();
                self.checkStageTransition();
            }).catch(function(err) {
                console.error('[Flow] Load error:', err);
            });
        },

        categorizeDocuments: function() {
            var self = this;
            this.processingDocs = [];
            this.readyDocs = [];

            this.documents.forEach(function(d) {
                var status = String(d.status);
                if (status === DocStatus.PENDING || status === DocStatus.PROCESSING) {
                    self.processingDocs.push(d);
                } else if (status === DocStatus.EXTRACTED || status === DocStatus.NEEDS_REVIEW) {
                    self.readyDocs.push(d);
                }
            });
        },

        startRefresh: function() {
            var self = this;
            this.stopRefresh();
            this.refreshInterval = setInterval(function() {
                self.loadData();
            }, this.REFRESH_MS);
        },

        stopRefresh: function() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
        },

        // ==========================================
        // PARTICLES ANIMATION
        // ==========================================
        initParticles: function() {
            var container = el('#flow-particles');
            if (!container) return;

            // Create floating particles
            for (var i = 0; i < 20; i++) {
                var particle = document.createElement('div');
                particle.className = 'flow-particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.animationDelay = (Math.random() * 5) + 's';
                particle.style.animationDuration = (5 + Math.random() * 10) + 's';
                container.appendChild(particle);
            }
        },

        stopParticles: function() {
            if (this.animationFrame) {
                cancelAnimationFrame(this.animationFrame);
            }
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Upload portal click
            this.on('#upload-portal', 'click', function() {
                el('#flow-file-input').click();
            });

            // File input change
            this.on('#flow-file-input', 'change', function(e) {
                self.handleFiles(e.target.files);
            });

            // Drag and drop on portal
            var portal = el('#upload-portal');
            if (portal) {
                portal.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    portal.classList.add('drag-over');
                });

                portal.addEventListener('dragleave', function(e) {
                    e.preventDefault();
                    portal.classList.remove('drag-over');
                });

                portal.addEventListener('drop', function(e) {
                    e.preventDefault();
                    portal.classList.remove('drag-over');
                    self.handleFiles(e.dataTransfer.files);
                });
            }

            // Drop more zone
            var dropMore = el('#drop-more-zone');
            if (dropMore) {
                dropMore.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    dropMore.classList.add('drag-over');
                });

                dropMore.addEventListener('dragleave', function() {
                    dropMore.classList.remove('drag-over');
                });

                dropMore.addEventListener('drop', function(e) {
                    e.preventDefault();
                    dropMore.classList.remove('drag-over');
                    self.handleFiles(e.dataTransfer.files);
                });
            }

            // Document type selection
            document.addEventListener('change', function(e) {
                if (e.target.name === 'flowDocType') {
                    self.selectedDocType = e.target.value;
                    // Update active class
                    els('.type-pill').forEach(function(pill) {
                        pill.classList.toggle('active', pill.querySelector('input').value === self.selectedDocType);
                    });
                }
            });

            // Navigation buttons
            this.on('#btn-go-to-documents', 'click', function() {
                Router.navigate('documents');
            });

            this.on('#btn-review-documents', 'click', function() {
                Router.navigate('documents');
            });

            this.on('#btn-upload-more', 'click', function() {
                self.resetToUpload();
            });

            // Card clicks
            document.addEventListener('click', function(e) {
                var card = e.target.closest('.theater-card');
                if (card && card.dataset.docId) {
                    Router.navigate('review', { docId: card.dataset.docId });
                }
            });
        },

        on: function(selector, event, handler) {
            var element = document.querySelector(selector);
            if (element) element.addEventListener(event, handler);
        },

        // ==========================================
        // FILE HANDLING
        // ==========================================
        handleFiles: function(files) {
            if (!files || files.length === 0) return;

            var self = this;
            var validFiles = [];

            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                var ext = file.name.split('.').pop().toLowerCase();
                if (['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif'].indexOf(ext) !== -1) {
                    validFiles.push(file);
                }
            }

            if (validFiles.length === 0) {
                UI.toast('No valid files selected. Please use PDF, PNG, JPG, or TIFF.', 'warning');
                return;
            }

            // Switch to processing stage
            this.currentStage = 'processing';
            this.showStage('processing');
            this.uploadFiles(validFiles);
        },

        uploadFiles: function(files) {
            var self = this;
            this.uploadInProgress = true;

            // Add files to queue display
            files.forEach(function(file) {
                self.addToQueue({
                    name: file.name,
                    size: file.size,
                    status: 'uploading'
                });
            });

            // Upload each file
            var uploadPromises = files.map(function(file) {
                return self.uploadSingleFile(file);
            });

            Promise.all(uploadPromises).then(function(results) {
                self.uploadInProgress = false;
                UI.toast(results.length + ' file(s) uploaded successfully!', 'success');
                self.loadData(); // Refresh to get processing status
            }).catch(function(err) {
                self.uploadInProgress = false;
                UI.toast('Upload failed: ' + err.message, 'error');
            });
        },

        uploadSingleFile: function(file) {
            var self = this;

            return new Promise(function(resolve, reject) {
                var formData = new FormData();
                formData.append('file', file);
                formData.append('documentType', self.selectedDocType);

                API.upload('upload', formData, function(progress) {
                    self.updateQueueItem(file.name, {
                        status: 'uploading',
                        progress: progress
                    });
                }).then(function(result) {
                    self.updateQueueItem(file.name, {
                        status: 'processing',
                        docId: result.documentId
                    });
                    resolve(result);
                }).catch(function(err) {
                    self.updateQueueItem(file.name, {
                        status: 'error',
                        error: err.message
                    });
                    reject(err);
                });
            });
        },

        addToQueue: function(item) {
            this.pendingUploads.push(item);
            this.renderQueueColumn();
        },

        updateQueueItem: function(fileName, updates) {
            var item = this.pendingUploads.find(function(u) {
                return u.name === fileName;
            });
            if (item) {
                Object.assign(item, updates);
                this.renderQueueColumn();
            }
        },

        // ==========================================
        // STAGE MANAGEMENT
        // ==========================================
        checkStageTransition: function() {
            // If we have processing docs, stay in processing stage
            if (this.processingDocs.length > 0) {
                if (this.currentStage !== 'processing') {
                    this.currentStage = 'processing';
                    this.showStage('processing');
                }
                return;
            }

            // If we just finished processing and have ready docs, show complete
            if (this.currentStage === 'processing' && this.readyDocs.length > 0 && !this.uploadInProgress) {
                this.currentStage = 'complete';
                this.showStage('complete');
                this.renderCompletionStats();
                return;
            }
        },

        showStage: function(stage) {
            var stages = ['upload', 'processing', 'complete'];
            stages.forEach(function(s) {
                var stageEl = el('#stage-' + s);
                if (stageEl) {
                    stageEl.style.display = s === stage ? 'flex' : 'none';
                }
            });

            // Show drop more zone during processing
            var dropMore = el('#drop-more-zone');
            if (dropMore) {
                dropMore.style.display = stage === 'processing' ? 'flex' : 'none';
            }
        },

        resetToUpload: function() {
            this.currentStage = 'upload';
            this.pendingUploads = [];
            this.showStage('upload');

            // Reset file input
            var fileInput = el('#flow-file-input');
            if (fileInput) fileInput.value = '';
        },

        // ==========================================
        // RENDERING
        // ==========================================
        render: function() {
            this.renderStats();

            if (this.currentStage === 'processing') {
                this.renderQueueColumn();
                this.renderProcessingVisualizer();
                this.renderReadyColumn();
            }
        },

        renderStats: function() {
            var incoming = this.documents.filter(function(d) {
                return String(d.status) === DocStatus.PENDING;
            }).length;

            var processing = this.documents.filter(function(d) {
                return String(d.status) === DocStatus.PROCESSING;
            }).length;

            var ready = this.readyDocs.length;

            // Update stat displays
            var incomingStat = el('#stat-incoming .stat-value');
            var processingStat = el('#stat-processing .stat-value');
            var readyStat = el('#stat-ready .stat-value');

            if (incomingStat) incomingStat.textContent = incoming;
            if (processingStat) processingStat.textContent = processing;
            if (readyStat) readyStat.textContent = ready;

            // Add animation class if processing
            var processingContainer = el('#stat-processing');
            if (processingContainer) {
                processingContainer.classList.toggle('active', processing > 0);
            }
        },

        renderQueueColumn: function() {
            var container = el('#queue-items');
            var countEl = el('#queue-count');
            if (!container) return;

            var items = this.pendingUploads.filter(function(u) {
                return u.status === 'uploading';
            });

            if (countEl) countEl.textContent = items.length;

            if (items.length === 0) {
                container.innerHTML = '<div class="column-empty"><i class="fas fa-check"></i><span>Queue empty</span></div>';
                return;
            }

            container.innerHTML = items.map(function(item) {
                var progress = item.progress || 0;
                return '<div class="theater-card uploading">' +
                    '<div class="card-icon"><i class="fas fa-file-pdf"></i></div>' +
                    '<div class="card-info">' +
                        '<div class="card-name">' + escapeHtml(item.name) + '</div>' +
                        '<div class="card-progress">' +
                            '<div class="progress-bar" style="width:' + progress + '%"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        },

        renderProcessingVisualizer: function() {
            var container = el('#processing-visualizer');
            if (!container) return;

            // Find actively processing document
            var processingDoc = this.documents.find(function(d) {
                return String(d.status) === DocStatus.PROCESSING;
            });

            if (!processingDoc) {
                container.innerHTML = '<div class="visualizer-empty">' +
                    '<i class="fas fa-cube"></i>' +
                    '<span>Waiting for documents...</span>' +
                '</div>';
                return;
            }

            // Render active extraction visualization
            container.innerHTML = this.renderExtractionVisual(processingDoc);
        },

        renderExtractionVisual: function(doc) {
            return '<div class="extraction-visual">' +
                '<div class="extraction-doc">' +
                    '<div class="doc-preview">' +
                        '<div class="scan-line"></div>' +
                        '<i class="fas fa-file-invoice"></i>' +
                    '</div>' +
                    '<div class="doc-name">' + escapeHtml(doc.fileName || 'Document') + '</div>' +
                '</div>' +
                '<div class="extraction-fields">' +
                    '<div class="field-extract">' +
                        '<i class="fas fa-building"></i>' +
                        '<span class="field-label">Vendor</span>' +
                        '<span class="field-value extracting"><span class="typing-dots"></span></span>' +
                    '</div>' +
                    '<div class="field-extract">' +
                        '<i class="fas fa-hashtag"></i>' +
                        '<span class="field-label">Invoice #</span>' +
                        '<span class="field-value pending">...</span>' +
                    '</div>' +
                    '<div class="field-extract">' +
                        '<i class="fas fa-dollar-sign"></i>' +
                        '<span class="field-label">Amount</span>' +
                        '<span class="field-value pending">...</span>' +
                    '</div>' +
                    '<div class="field-extract">' +
                        '<i class="fas fa-list"></i>' +
                        '<span class="field-label">Line Items</span>' +
                        '<span class="field-value pending">...</span>' +
                    '</div>' +
                '</div>' +
                '<div class="extraction-progress">' +
                    '<div class="progress-track">' +
                        '<div class="progress-fill animate"></div>' +
                    '</div>' +
                    '<span class="progress-text">Extracting data...</span>' +
                '</div>' +
            '</div>';
        },

        renderReadyColumn: function() {
            var container = el('#ready-items');
            var countEl = el('#ready-count');
            if (!container) return;

            if (countEl) countEl.textContent = this.readyDocs.length;

            if (this.readyDocs.length === 0) {
                container.innerHTML = '<div class="column-empty"><i class="fas fa-inbox"></i><span>No documents ready</span></div>';
                return;
            }

            container.innerHTML = this.readyDocs.slice(0, 10).map(function(doc) {
                var conf = parseInt(doc.confidence) || 0;
                var confClass = conf >= 85 ? 'high' : conf >= 60 ? 'medium' : 'low';

                return '<div class="theater-card ready" data-doc-id="' + doc.id + '">' +
                    '<div class="card-confidence conf-' + confClass + '">' + conf + '%</div>' +
                    '<div class="card-info">' +
                        '<div class="card-vendor">' + escapeHtml(doc.vendorName || 'Unknown') + '</div>' +
                        '<div class="card-amount">$' + formatNumber(doc.totalAmount || 0) + '</div>' +
                    '</div>' +
                    '<div class="card-arrow"><i class="fas fa-chevron-right"></i></div>' +
                '</div>';
            }).join('');

            if (this.readyDocs.length > 10) {
                container.innerHTML += '<div class="column-more">+' + (this.readyDocs.length - 10) + ' more</div>';
            }
        },

        renderCompletionStats: function() {
            var total = this.readyDocs.length;
            var highConf = this.readyDocs.filter(function(d) {
                return parseInt(d.confidence) >= 85;
            }).length;
            var needsReview = total - highConf;

            var totalEl = el('#comp-total');
            var highEl = el('#comp-high-conf');
            var reviewEl = el('#comp-needs-review');

            if (totalEl) totalEl.textContent = total;
            if (highEl) highEl.textContent = highConf;
            if (reviewEl) reviewEl.textContent = needsReview;
        }
    };

    // Register routes
    Router.register('flow',
        function(params) { FlowController.init(params); },
        function() { FlowController.cleanup(); }
    );

    // Backward compatibility
    Router.register('queue',
        function(params) { FlowController.init(params); },
        function() { FlowController.cleanup(); }
    );
    Router.register('rail',
        function(params) { FlowController.init(params); },
        function() { FlowController.cleanup(); }
    );

    console.log('[View.Flow] Loaded');

})();
