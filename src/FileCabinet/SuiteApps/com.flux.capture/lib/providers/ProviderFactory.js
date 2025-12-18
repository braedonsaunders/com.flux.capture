/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module FluxCapture/Providers/ProviderFactory
 *
 * Factory for creating extraction providers based on configuration.
 * Handles loading provider settings from customrecord_flux_config.
 */

define([
    'N/log',
    'N/record',
    'N/search',
    'N/encode',
    'N/crypto',
    './ExtractionProvider',
    './OCIProvider',
    './AzureFormRecognizerProvider'
], function(log, record, search, encode, crypto, ExtractionProviderModule, OCIProviderModule, AzureProviderModule) {
    'use strict';

    const { ProviderType } = ExtractionProviderModule;
    const { OCIProvider } = OCIProviderModule;
    const { AzureFormRecognizerProvider } = AzureProviderModule;

    // Configuration record type and fields
    const CONFIG_RECORD_TYPE = 'customrecord_flux_config';
    const CONFIG_FIELDS = {
        type: 'custrecord_flux_cfg_type',
        key: 'custrecord_flux_cfg_key',
        data: 'custrecord_flux_cfg_data',
        version: 'custrecord_flux_cfg_version'
    };

    // Config type for provider settings
    const PROVIDER_CONFIG_TYPE = 'provider_settings';
    const PROVIDER_CONFIG_KEY = 'extraction_provider';

    // Encryption key identifier (stored separately for security)
    const ENCRYPTION_KEY_ID = 'flux_capture_encryption_key';

    /**
     * Provider Factory
     * Creates and manages extraction providers
     */
    class ProviderFactory {
        constructor() {
            this._configCache = null;
            this._configCacheTime = 0;
            this._cacheTTL = 60000; // 1 minute cache
        }

        /**
         * Get the configured extraction provider
         * @param {Object} overrideConfig - Optional config override
         * @returns {ExtractionProvider}
         */
        getProvider(overrideConfig = null) {
            const config = overrideConfig || this._loadProviderConfig();

            const providerType = config.providerType || ProviderType.OCI;

            log.audit('ProviderFactory.getProvider', `Creating provider: ${providerType}`);

            switch (providerType) {
                case ProviderType.AZURE:
                    return this._createAzureProvider(config);

                case ProviderType.OCI:
                default:
                    return this._createOCIProvider(config);
            }
        }

        /**
         * Get provider by type (without loading config)
         * @param {string} providerType
         * @param {Object} config
         * @returns {ExtractionProvider}
         */
        getProviderByType(providerType, config = {}) {
            switch (providerType) {
                case ProviderType.AZURE:
                    return this._createAzureProvider(config);

                case ProviderType.OCI:
                default:
                    return this._createOCIProvider(config);
            }
        }

        /**
         * Get list of available providers
         * @returns {Array<Object>}
         */
        getAvailableProviders() {
            const providers = [
                {
                    type: ProviderType.OCI,
                    name: 'OCI Document Understanding',
                    description: 'NetSuite built-in OCR using Oracle Cloud Infrastructure',
                    requiresConfig: false,
                    configFields: []
                },
                {
                    type: ProviderType.AZURE,
                    name: 'Azure Form Recognizer',
                    description: 'Microsoft Azure Document Intelligence (Form Recognizer)',
                    requiresConfig: true,
                    configFields: [
                        {
                            id: 'endpoint',
                            label: 'Azure Endpoint',
                            type: 'text',
                            required: true,
                            placeholder: 'https://your-resource.cognitiveservices.azure.com',
                            helpText: 'Your Azure Cognitive Services endpoint URL'
                        },
                        {
                            id: 'apiKey',
                            label: 'API Key',
                            type: 'password',
                            required: true,
                            placeholder: 'Enter your Azure API key',
                            helpText: 'Your Azure Form Recognizer API key (will be encrypted)',
                            encrypted: true
                        },
                        {
                            id: 'defaultModel',
                            label: 'Default Model',
                            type: 'select',
                            required: false,
                            options: [
                                { value: 'prebuilt-invoice', label: 'Invoice' },
                                { value: 'prebuilt-receipt', label: 'Receipt' },
                                { value: 'prebuilt-document', label: 'General Document' }
                            ],
                            defaultValue: 'prebuilt-invoice',
                            helpText: 'Default document model to use'
                        }
                    ]
                }
            ];

            // Check availability for each provider
            providers.forEach(p => {
                try {
                    const provider = this.getProviderByType(p.type, {});
                    const availability = provider.checkAvailability();
                    p.available = availability.available;
                    p.availabilityReason = availability.reason;
                } catch (e) {
                    p.available = false;
                    p.availabilityReason = e.message;
                }
            });

            return providers;
        }

        /**
         * Validate provider configuration
         * @param {string} providerType
         * @param {Object} config
         * @returns {Object} - {valid: boolean, errors: Array}
         */
        validateProviderConfig(providerType, config) {
            const provider = this.getProviderByType(providerType, config);
            return provider.validateConfig();
        }

        /**
         * Test provider connection
         * @param {string} providerType
         * @param {Object} config
         * @returns {Object} - {success: boolean, message: string}
         */
        testProviderConnection(providerType, config) {
            try {
                // If _useSavedApiKey flag is set, load the encrypted key from saved config
                let testConfig = { ...config };
                if (config && config._useSavedApiKey) {
                    const savedConfig = this._loadProviderConfig();
                    if (savedConfig && savedConfig.azure && savedConfig.azure.apiKey) {
                        // _loadProviderConfig already decrypts the API key
                        testConfig.apiKey = savedConfig.azure.apiKey;
                    }
                    delete testConfig._useSavedApiKey;
                }

                const provider = this.getProviderByType(providerType, testConfig);

                // Validate config first
                const validation = provider.validateConfig();
                if (!validation.valid) {
                    return {
                        success: false,
                        message: `Configuration errors: ${validation.errors.join(', ')}`
                    };
                }

                // Check availability
                const availability = provider.checkAvailability();
                if (!availability.available) {
                    return {
                        success: false,
                        message: `Provider not available: ${availability.reason}`
                    };
                }

                // For Azure, we could make a test API call here
                if (providerType === ProviderType.AZURE) {
                    // Could add a lightweight API test here
                    // For now, just check config validity
                }

                return {
                    success: true,
                    message: 'Provider configuration is valid'
                };

            } catch (e) {
                return {
                    success: false,
                    message: `Test failed: ${e.message}`
                };
            }
        }

        /**
         * Save provider configuration
         * @param {Object} config
         * @returns {Object} - {success: boolean, message: string}
         */
        saveProviderConfig(config) {
            try {
                // Load existing config to preserve encrypted API key if needed
                const existingConfig = this._loadProviderConfig();

                // Encrypt sensitive fields
                const configToSave = { ...config };
                if (configToSave.azure) {
                    if (configToSave.azure.apiKey) {
                        // New API key provided - encrypt it
                        configToSave.azure.apiKey = this._encryptValue(configToSave.azure.apiKey);
                        configToSave.azure._apiKeyEncrypted = true;
                    } else if (configToSave.azure._preserveExistingApiKey && existingConfig && existingConfig.azure && existingConfig.azure.apiKey) {
                        // Preserve existing API key - re-encrypt since _loadProviderConfig decrypted it
                        configToSave.azure.apiKey = this._encryptValue(existingConfig.azure.apiKey);
                        configToSave.azure._apiKeyEncrypted = true;
                    }
                    // Clean up internal flags
                    delete configToSave.azure._preserveExistingApiKey;
                    delete configToSave.azure._hasApiKey;
                }

                // Find existing config record
                const existingId = this._findConfigRecord(PROVIDER_CONFIG_TYPE, PROVIDER_CONFIG_KEY);

                if (existingId) {
                    // Update existing
                    record.submitFields({
                        type: CONFIG_RECORD_TYPE,
                        id: existingId,
                        values: {
                            [CONFIG_FIELDS.data]: JSON.stringify(configToSave),
                            [CONFIG_FIELDS.version]: '2'
                        }
                    });
                } else {
                    // Create new
                    const configRecord = record.create({ type: CONFIG_RECORD_TYPE });
                    configRecord.setValue({ fieldId: 'name', value: 'Extraction Provider Settings' });
                    configRecord.setValue({ fieldId: CONFIG_FIELDS.type, value: PROVIDER_CONFIG_TYPE });
                    configRecord.setValue({ fieldId: CONFIG_FIELDS.key, value: PROVIDER_CONFIG_KEY });
                    configRecord.setValue({ fieldId: CONFIG_FIELDS.data, value: JSON.stringify(configToSave) });
                    configRecord.setValue({ fieldId: CONFIG_FIELDS.version, value: '2' });
                    configRecord.save();
                }

                // Clear cache
                this._configCache = null;

                log.audit('ProviderFactory.saveProviderConfig', 'Provider configuration saved');

                return {
                    success: true,
                    message: 'Provider configuration saved successfully'
                };

            } catch (e) {
                log.error('ProviderFactory.saveProviderConfig', e.message);
                return {
                    success: false,
                    message: `Failed to save configuration: ${e.message}`
                };
            }
        }

        /**
         * Load provider configuration
         * @returns {Object}
         */
        _loadProviderConfig() {
            // Check cache
            const now = Date.now();
            if (this._configCache && (now - this._configCacheTime) < this._cacheTTL) {
                return this._configCache;
            }

            try {
                const configId = this._findConfigRecord(PROVIDER_CONFIG_TYPE, PROVIDER_CONFIG_KEY);

                if (!configId) {
                    // Return default config
                    return this._getDefaultConfig();
                }

                const configRecord = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: configId
                });

                const dataJson = configRecord.getValue({ fieldId: CONFIG_FIELDS.data });
                const config = JSON.parse(dataJson || '{}');

                // Decrypt sensitive fields
                if (config.azure && config.azure._apiKeyEncrypted && config.azure.apiKey) {
                    config.azure.apiKey = this._decryptValue(config.azure.apiKey);
                }

                // Cache the config
                this._configCache = config;
                this._configCacheTime = now;

                return config;

            } catch (e) {
                log.error('ProviderFactory._loadProviderConfig', e.message);
                return this._getDefaultConfig();
            }
        }

        /**
         * Get provider configuration for UI (with masked sensitive fields)
         * @returns {Object}
         */
        getProviderConfigForUI() {
            const config = this._loadProviderConfig();

            // Mask sensitive fields for UI display
            const uiConfig = JSON.parse(JSON.stringify(config));

            if (uiConfig.azure && uiConfig.azure.apiKey) {
                // Show only last 4 characters
                const key = uiConfig.azure.apiKey;
                uiConfig.azure.apiKey = key.length > 4 ?
                    '••••••••' + key.substring(key.length - 4) :
                    '••••••••';
                uiConfig.azure._hasApiKey = true;
            }

            return uiConfig;
        }

        /**
         * Get default configuration
         * @returns {Object}
         */
        _getDefaultConfig() {
            return {
                providerType: ProviderType.OCI,
                oci: {},
                azure: {
                    endpoint: '',
                    apiKey: '',
                    defaultModel: 'prebuilt-invoice'
                }
            };
        }

        /**
         * Create OCI provider instance
         * @param {Object} config
         * @returns {OCIProvider}
         */
        _createOCIProvider(config) {
            return new OCIProvider(config.oci || {});
        }

        /**
         * Create Azure provider instance
         * @param {Object} config
         * @returns {AzureFormRecognizerProvider}
         */
        _createAzureProvider(config) {
            const azureConfig = config.azure || {};
            return new AzureFormRecognizerProvider({
                endpoint: azureConfig.endpoint,
                apiKey: azureConfig.apiKey,
                defaultModel: azureConfig.defaultModel
            });
        }

        /**
         * Find config record by type and key
         * @param {string} configType
         * @param {string} configKey
         * @returns {number|null}
         */
        _findConfigRecord(configType, configKey) {
            try {
                const searchObj = search.create({
                    type: CONFIG_RECORD_TYPE,
                    filters: [
                        [CONFIG_FIELDS.type, 'is', configType],
                        'AND',
                        [CONFIG_FIELDS.key, 'is', configKey]
                    ],
                    columns: ['internalid']
                });

                let recordId = null;
                searchObj.run().each(function(result) {
                    recordId = result.id;
                    return false; // Stop after first result
                });

                return recordId;

            } catch (e) {
                log.debug('ProviderFactory._findConfigRecord', e.message);
                return null;
            }
        }

        /**
         * Encrypt a value for storage
         * Uses AES encryption with a derived key
         * @param {string} value
         * @returns {string}
         */
        _encryptValue(value) {
            if (!value) return value;

            try {
                // Use crypto module for encryption
                const secretKey = crypto.createSecretKey({
                    guid: ENCRYPTION_KEY_ID,
                    encoding: crypto.Encoding.UTF_8
                });

                const cipher = crypto.createCipher({
                    algorithm: crypto.EncryptionAlg.AES,
                    key: secretKey
                });

                cipher.update({
                    input: value,
                    inputEncoding: crypto.Encoding.UTF_8
                });

                const encrypted = cipher.final({
                    outputEncoding: crypto.Encoding.BASE_64
                });

                return 'ENC:' + encrypted;

            } catch (e) {
                // If crypto fails, fall back to base64 encoding (not secure, but better than plaintext)
                log.error('ProviderFactory._encryptValue', `Crypto encryption failed: ${e.message}, using fallback`);

                const encoded = encode.convert({
                    string: value,
                    inputEncoding: encode.Encoding.UTF_8,
                    outputEncoding: encode.Encoding.BASE_64
                });

                return 'B64:' + encoded;
            }
        }

        /**
         * Decrypt a stored value
         * @param {string} encryptedValue
         * @returns {string}
         */
        _decryptValue(encryptedValue) {
            if (!encryptedValue) return encryptedValue;

            try {
                // Check encryption type
                if (encryptedValue.startsWith('ENC:')) {
                    // AES encrypted
                    const encrypted = encryptedValue.substring(4);

                    const secretKey = crypto.createSecretKey({
                        guid: ENCRYPTION_KEY_ID,
                        encoding: crypto.Encoding.UTF_8
                    });

                    const decipher = crypto.createDecipher({
                        algorithm: crypto.EncryptionAlg.AES,
                        key: secretKey
                    });

                    decipher.update({
                        input: encrypted,
                        inputEncoding: crypto.Encoding.BASE_64
                    });

                    return decipher.final({
                        outputEncoding: crypto.Encoding.UTF_8
                    });

                } else if (encryptedValue.startsWith('B64:')) {
                    // Base64 encoded (fallback)
                    const encoded = encryptedValue.substring(4);

                    return encode.convert({
                        string: encoded,
                        inputEncoding: encode.Encoding.BASE_64,
                        outputEncoding: encode.Encoding.UTF_8
                    });
                }

                // Not encrypted, return as-is
                return encryptedValue;

            } catch (e) {
                log.error('ProviderFactory._decryptValue', `Decryption failed: ${e.message}`);
                return encryptedValue;
            }
        }
    }

    // Export singleton instance and class
    const factoryInstance = new ProviderFactory();

    return {
        ProviderFactory: ProviderFactory,
        factory: factoryInstance,
        getProvider: function(config) { return factoryInstance.getProvider(config); },
        getAvailableProviders: function() { return factoryInstance.getAvailableProviders(); },
        saveProviderConfig: function(config) { return factoryInstance.saveProviderConfig(config); },
        getProviderConfigForUI: function() { return factoryInstance.getProviderConfigForUI(); },
        validateProviderConfig: function(type, config) { return factoryInstance.validateProviderConfig(type, config); },
        testProviderConnection: function(type, config) { return factoryInstance.testProviderConnection(type, config); }
    };
});
