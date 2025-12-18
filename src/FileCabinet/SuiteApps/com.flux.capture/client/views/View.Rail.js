/**
 * Flux Capture - Flow View Controller
 * Card-based upload experience with animated status transitions
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

    // Persistent state that survives navigation
    // Stored outside FlowController to persist across init/cleanup cycles
    var persistentState = {
        uploadCards: [],
        cardIdCounter: 0
    };

    var FlowController = {
        uploadCards: [],  // Reference to persistent cards
        refreshInterval: null,
        REFRESH_MS: 2000,
        selectedDocType: 'auto',
        cardIdCounter: 0,

        // ==========================================
        // INITIALIZATION
        // ==========================================
        init: function() {
            // Restore from persistent state
            this.uploadCards = persistentState.uploadCards;
            this.cardIdCounter = persistentState.cardIdCounter;

            renderTemplate('tpl-rail', 'view-container');
            this.bindEvents();
            this.startRefresh();

            // Restore UI state based on existing cards
            this.restoreUIState();
        },

        cleanup: function() {
            this.stopRefresh();
            // Save to persistent state (keep the reference, cards persist)
            persistentState.uploadCards = this.uploadCards;
            persistentState.cardIdCounter = this.cardIdCounter;
            // Don't clear uploadCards - they persist!
        },

        restoreUIState: function() {
            var self = this;
            var viewFlow = el('.view-flow');
            var container = el('#flow-cards-container');
            var dropContainer = el('#flow-drop-container');

            if (this.uploadCards.length > 0) {
                // We have cards - show cards mode
                if (viewFlow) viewFlow.classList.add('cards-mode');
                if (viewFlow) viewFlow.classList.remove('fullpage-mode');
                if (container) container.style.display = 'block';
                if (dropContainer) dropContainer.classList.add('compact');

                // Re-render all cards without animation (they're restored)
                this.uploadCards.forEach(function(card) {
                    self.renderCard(card, false);
                });

                this.updateSummary();
                this.checkAllComplete();

                // Immediately check processing status for any cards that were processing
                var hasProcessingCards = this.uploadCards.some(function(c) {
                    return c.status === 'processing' && c.documentId;
                });
                if (hasProcessingCards) {
                    this.checkProcessingStatus();
                }
            } else {
                // No cards - full page mode
                if (viewFlow) viewFlow.classList.add('fullpage-mode');
                if (viewFlow) viewFlow.classList.remove('cards-mode');
            }
        },

        // ==========================================
        // EVENT BINDING
        // ==========================================
        bindEvents: function() {
            var self = this;

            // Dropzone click
            var dropzone = el('#flow-dropzone');
            var fileInput = el('#flow-file-input');

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
                    var files = Array.from(e.dataTransfer.files);
                    if (files.length > 0) {
                        self.handleFiles(files);
                    }
                });

                fileInput.addEventListener('change', function() {
                    var files = Array.from(this.files);
                    if (files.length > 0) {
                        self.handleFiles(files);
                    }
                    this.value = '';
                });
            }

            // Navigation buttons
            this.on('#btn-go-to-documents', 'click', function() {
                Router.navigate('documents');
            });

            this.on('#btn-review-all', 'click', function() {
                Router.navigate('documents');
            });

            this.on('#btn-clear-complete', 'click', function() {
                self.clearCompleteCards();
            });
        },

        on: function(selector, event, handler) {
            var element = el(selector);
            if (element) {
                element.addEventListener(event, handler);
            }
        },

        // ==========================================
        // FILE HANDLING
        // ==========================================
        handleFiles: function(files) {
            var self = this;
            var isFirstBatch = this.uploadCards.length === 0;

            // Transition from fullpage to cards mode
            var viewFlow = el('.view-flow');
            var container = el('#flow-cards-container');
            var dropContainer = el('#flow-drop-container');

            if (isFirstBatch && viewFlow) {
                // Animate the transition
                viewFlow.classList.remove('fullpage-mode');
                viewFlow.classList.add('cards-mode');
                if (container) {
                    container.classList.add('animate-container');
                }
            }

            if (container) container.style.display = 'block';
            if (dropContainer) dropContainer.classList.add('compact');

            // Create cards for each file
            files.forEach(function(file) {
                self.cardIdCounter++;
                persistentState.cardIdCounter = self.cardIdCounter;
                var card = {
                    id: 'card-' + self.cardIdCounter,
                    fileName: file.name,
                    fileSize: file.size,
                    file: file,
                    status: 'queued',  // queued | uploading | processing | complete | error
                    progress: 0,
                    documentId: null,
                    confidence: null,
                    error: null
                };
                self.uploadCards.push(card);
                self.renderCard(card, true);
            });

            // Update summary
            this.updateSummary();

            // Start uploading
            this.processQueue();
        },

        processQueue: function() {
            var self = this;
            var queuedCards = this.uploadCards.filter(function(c) {
                return c.status === 'queued';
            });

            if (queuedCards.length === 0) return;

            // Process up to 3 at a time
            var toProcess = queuedCards.slice(0, 3);
            toProcess.forEach(function(card) {
                self.uploadCard(card);
            });
        },

        uploadCard: function(card) {
            var self = this;
            card.status = 'uploading';
            card.progress = 10;
            this.updateCardUI(card);

            var reader = new FileReader();

            reader.onload = function() {
                var base64 = reader.result.split(',')[1];
                card.progress = 40;
                self.updateCardUI(card);

                API.post('upload', {
                    fileName: card.file.name,
                    fileContent: base64,
                    documentType: self.selectedDocType
                }).then(function(result) {
                    card.status = 'processing';
                    card.progress = 60;
                    card.documentId = result ? result.documentId : null;
                    self.updateCardUI(card);
                    self.updateSummary();

                    // Continue queue
                    self.processQueue();
                }).catch(function(err) {
                    card.status = 'error';
                    card.error = err.message || 'Upload failed';
                    self.updateCardUI(card);
                    self.updateSummary();

                    // Continue queue
                    self.processQueue();
                });
            };

            reader.onerror = function() {
                card.status = 'error';
                card.error = 'Failed to read file';
                self.updateCardUI(card);
                self.updateSummary();
                self.processQueue();
            };

            reader.onprogress = function(e) {
                if (e.lengthComputable) {
                    card.progress = Math.round((e.loaded / e.total) * 30) + 10;
                    self.updateCardUI(card);
                }
            };

            reader.readAsDataURL(card.file);
        },

        // ==========================================
        // STATUS POLLING
        // ==========================================
        startRefresh: function() {
            var self = this;
            this.stopRefresh();
            this.refreshInterval = setInterval(function() {
                self.checkProcessingStatus();
            }, this.REFRESH_MS);
        },

        stopRefresh: function() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
        },

        checkProcessingStatus: function() {
            var self = this;
            var processingCards = this.uploadCards.filter(function(c) {
                return c.status === 'processing' && c.documentId;
            });

            if (processingCards.length === 0) {
                this.checkAllComplete();
                return;
            }

            // Check status of processing documents
            var docIds = processingCards.map(function(c) { return c.documentId; });

            API.get('list', { ids: docIds.join(',') }).then(function(data) {
                var docs = data || [];

                processingCards.forEach(function(card) {
                    var doc = docs.find(function(d) {
                        return String(d.id) === String(card.documentId);
                    });

                    if (doc) {
                        var status = String(doc.status);
                        // Check if extraction is complete
                        if (status === DocStatus.EXTRACTED ||
                            status === DocStatus.NEEDS_REVIEW ||
                            status === DocStatus.COMPLETED) {
                            card.status = 'complete';
                            card.progress = 100;
                            card.confidence = doc.confidence;
                            card.vendorName = doc.vendorName;
                            card.totalAmount = doc.totalAmount;
                            self.updateCardUI(card);
                        } else if (status === DocStatus.ERROR) {
                            card.status = 'error';
                            card.error = 'Extraction failed';
                            self.updateCardUI(card);
                        } else {
                            // Still processing - animate progress
                            card.progress = Math.min(95, card.progress + 5);
                            self.updateCardUI(card);
                        }
                    }
                });

                self.updateSummary();
                self.checkAllComplete();
            }).catch(function(err) {
                console.error('[Flow] Status check error:', err);
            });
        },

        checkAllComplete: function() {
            var hasActive = this.uploadCards.some(function(c) {
                return c.status === 'queued' || c.status === 'uploading' || c.status === 'processing';
            });

            var completeActions = el('#flow-complete-actions');
            var clearBtn = el('#btn-clear-complete');

            var completeCount = this.uploadCards.filter(function(c) {
                return c.status === 'complete';
            }).length;

            if (!hasActive && this.uploadCards.length > 0 && completeCount > 0) {
                if (completeActions) completeActions.style.display = 'flex';
            } else {
                if (completeActions) completeActions.style.display = 'none';
            }

            if (clearBtn) {
                clearBtn.style.display = completeCount > 0 ? 'inline-flex' : 'none';
            }
        },

        // ==========================================
        // RENDERING
        // ==========================================
        renderCard: function(card, animate) {
            var grid = el('#flow-cards-grid');
            if (!grid) return;

            var existingCard = el('#' + card.id);
            if (existingCard) {
                existingCard.remove();
            }

            var cardEl = document.createElement('div');
            cardEl.id = card.id;
            cardEl.className = 'flow-card status-' + card.status;
            if (animate) cardEl.classList.add('animate-in');

            cardEl.innerHTML = this.getCardHTML(card);
            grid.appendChild(cardEl);

            // Bind card click for complete cards
            if (card.status === 'complete' && card.documentId) {
                var self = this;
                cardEl.addEventListener('click', function() {
                    Router.navigate('review', { docId: card.documentId });
                });
                cardEl.style.cursor = 'pointer';
            }
        },

        updateCardUI: function(card) {
            var cardEl = el('#' + card.id);
            if (!cardEl) {
                this.renderCard(card, false);
                return;
            }

            // Update class
            cardEl.className = 'flow-card status-' + card.status;

            // Update content
            cardEl.innerHTML = this.getCardHTML(card);

            // Add click handler for complete
            if (card.status === 'complete' && card.documentId) {
                var self = this;
                cardEl.addEventListener('click', function() {
                    Router.navigate('review', { docId: card.documentId });
                });
                cardEl.style.cursor = 'pointer';
            }
        },

        getCardHTML: function(card) {
            var statusIcon = this.getStatusIcon(card.status);
            var statusText = this.getStatusText(card);
            var fileIcon = this.getFileIcon(card.fileName);

            var html = '<div class="card-icon">' + fileIcon + '</div>' +
                '<div class="card-content">' +
                    '<div class="card-filename" title="' + escapeHtml(card.fileName) + '">' + escapeHtml(this.truncateFilename(card.fileName, 24)) + '</div>' +
                    '<div class="card-status">' + statusIcon + ' ' + statusText + '</div>';

            // Progress bar for active states
            if (card.status === 'uploading' || card.status === 'processing') {
                html += '<div class="card-progress"><div class="card-progress-fill" style="width:' + card.progress + '%"></div></div>';
            }

            // Show extracted info for complete
            if (card.status === 'complete' && card.vendorName) {
                html += '<div class="card-extracted">' +
                    '<span class="extracted-vendor">' + escapeHtml(card.vendorName) + '</span>' +
                    (card.totalAmount ? '<span class="extracted-amount">$' + card.totalAmount.toFixed(2) + '</span>' : '') +
                '</div>';
            }

            // Show error message
            if (card.status === 'error' && card.error) {
                html += '<div class="card-error">' + escapeHtml(card.error) + '</div>';
            }

            html += '</div>';

            // Confidence badge for complete
            if (card.status === 'complete' && card.confidence) {
                var confClass = card.confidence >= 85 ? 'high' : card.confidence >= 60 ? 'medium' : 'low';
                html += '<div class="card-confidence ' + confClass + '">' + Math.round(card.confidence) + '%</div>';
            }

            return html;
        },

        getStatusIcon: function(status) {
            switch (status) {
                case 'queued': return '<i class="fas fa-clock"></i>';
                case 'uploading': return '<i class="fas fa-arrow-up fa-fade"></i>';
                case 'processing': return '<i class="fas fa-cog fa-spin"></i>';
                case 'complete': return '<i class="fas fa-check-circle"></i>';
                case 'error': return '<i class="fas fa-exclamation-circle"></i>';
                default: return '<i class="fas fa-file"></i>';
            }
        },

        getStatusText: function(card) {
            switch (card.status) {
                case 'queued': return 'Queued';
                case 'uploading': return 'Uploading...';
                case 'processing': return 'Extracting...';
                case 'complete': return 'Ready to review';
                case 'error': return 'Failed';
                default: return '';
            }
        },

        getFileIcon: function(fileName) {
            var ext = fileName.split('.').pop().toLowerCase();
            if (ext === 'pdf') return '<i class="fas fa-file-pdf"></i>';
            if (['png', 'jpg', 'jpeg', 'tiff', 'tif'].indexOf(ext) >= 0) return '<i class="fas fa-file-image"></i>';
            return '<i class="fas fa-file"></i>';
        },

        truncateFilename: function(name, maxLen) {
            if (name.length <= maxLen) return name;
            var ext = name.split('.').pop();
            var base = name.substring(0, name.length - ext.length - 1);
            var truncLen = maxLen - ext.length - 4; // 4 for '...' and '.'
            return base.substring(0, truncLen) + '...' + ext;
        },

        updateSummary: function() {
            var queued = 0, processing = 0, complete = 0;

            this.uploadCards.forEach(function(c) {
                if (c.status === 'queued') queued++;
                else if (c.status === 'uploading' || c.status === 'processing') processing++;
                else if (c.status === 'complete') complete++;
            });

            var summary = el('#flow-summary');
            if (summary) {
                summary.style.display = this.uploadCards.length > 0 ? 'flex' : 'none';
            }

            var queuedEl = el('#summary-queued');
            var processingEl = el('#summary-processing');
            var completeEl = el('#summary-complete');

            if (queuedEl) queuedEl.textContent = queued;
            if (processingEl) processingEl.textContent = processing;
            if (completeEl) completeEl.textContent = complete;
        },

        // ==========================================
        // ACTIONS
        // ==========================================
        resetToUpload: function() {
            var container = el('#flow-cards-container');
            var dropContainer = el('#flow-drop-container');
            var completeActions = el('#flow-complete-actions');
            var viewFlow = el('.view-flow');

            if (dropContainer) dropContainer.classList.remove('compact');
            if (completeActions) completeActions.style.display = 'none';

            // Clear complete cards only
            this.uploadCards = this.uploadCards.filter(function(c) {
                return c.status !== 'complete' && c.status !== 'error';
            });

            // Update persistent state
            persistentState.uploadCards = this.uploadCards;

            // Re-render
            var grid = el('#flow-cards-grid');
            if (grid) grid.innerHTML = '';

            var self = this;
            this.uploadCards.forEach(function(card) {
                self.renderCard(card, false);
            });

            if (this.uploadCards.length === 0) {
                if (container) {
                    container.style.display = 'none';
                    container.classList.remove('animate-container');
                }
                // Return to fullpage mode
                if (viewFlow) {
                    viewFlow.classList.remove('cards-mode');
                    viewFlow.classList.add('fullpage-mode');
                }
            }

            this.updateSummary();

            // Reset file input
            var fileInput = el('#flow-file-input');
            if (fileInput) fileInput.value = '';
        },

        clearCompleteCards: function() {
            var self = this;

            // Remove complete cards with animation
            this.uploadCards.forEach(function(card) {
                if (card.status === 'complete' || card.status === 'error') {
                    var cardEl = el('#' + card.id);
                    if (cardEl) {
                        cardEl.classList.add('animate-out');
                        setTimeout(function() {
                            cardEl.remove();
                        }, 300);
                    }
                }
            });

            // Remove from array after animation
            setTimeout(function() {
                self.uploadCards = self.uploadCards.filter(function(c) {
                    return c.status !== 'complete' && c.status !== 'error';
                });

                // Update persistent state
                persistentState.uploadCards = self.uploadCards;

                var container = el('#flow-cards-container');
                var viewFlow = el('.view-flow');

                if (self.uploadCards.length === 0) {
                    // Return to fullpage mode
                    if (container) {
                        container.style.display = 'none';
                        container.classList.remove('animate-container');
                    }
                    var dropContainer = el('#flow-drop-container');
                    if (dropContainer) dropContainer.classList.remove('compact');
                    if (viewFlow) {
                        viewFlow.classList.remove('cards-mode');
                        viewFlow.classList.add('fullpage-mode');
                    }
                }

                self.updateSummary();
                self.checkAllComplete();
            }, 350);
        }
    };

    // Register with router - primary route is 'ingest'
    Router.register('ingest',
        function() { FlowController.init(); },
        function() { FlowController.cleanup(); }
    );

    // Also register flow and rail aliases for backwards compatibility
    Router.register('flow',
        function() { FlowController.init(); },
        function() { FlowController.cleanup(); }
    );

    Router.register('rail',
        function() { FlowController.init(); },
        function() { FlowController.cleanup(); }
    );

    console.log('[View.Ingest] Card-Based Ingest Loaded');

})();
