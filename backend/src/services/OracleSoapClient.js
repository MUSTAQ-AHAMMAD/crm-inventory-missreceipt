/**
 * Oracle SOAP Client with WSDL Auto-Discovery and MTOM/XOP Support
 *
 * This client properly handles Oracle Fusion SOAP services by:
 * - Auto-discovering namespaces and operations from WSDL
 * - Parsing MTOM/XOP multipart responses
 * - Extracting correct SOAPAction headers
 * - Implementing retry logic with exponential backoff
 * - Providing comprehensive error handling
 * - Detailed request/response logging for debugging
 * - Production-ready error recovery
 */

const axios = require('axios');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const pRetry = require('p-retry');

class OracleSoapClient {
  constructor(config) {
    this.wsdlUrl = config.wsdlUrl;
    this.serviceUrl = config.serviceUrl;
    this.username = config.username;
    this.password = config.password;
    this.maxRetries = config.maxRetries || 3;
    this.retryMinTimeout = config.retryMinTimeout || 1000;
    this.retryMaxTimeout = config.retryMaxTimeout || 10000;
    this.requestTimeout = config.requestTimeout || 30000;
    this.debugMode = config.debugMode || process.env.SOAP_DEBUG === 'true';

    // Cache for WSDL data
    this.wsdlCache = null;
    this.namespaces = {};
    this.operations = {};

    // Request counter for logging
    this.requestCounter = 0;

    // XML parser configuration
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: true,
      trimValues: true,
      cdataPropName: '__cdata',
      textNodeName: '#text',
      parseTagValue: true,
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      suppressEmptyNode: true,
    });
  }

  /**
   * Logs debug information if debug mode is enabled
   */
  debugLog(message, data) {
    if (this.debugMode) {
      console.log(`[OracleSoapClient DEBUG] ${message}`);
      if (data) {
        console.log(JSON.stringify(data, null, 2));
      }
    }
  }

  /**
   * Safely truncates XML for logging
   */
  truncateXml(xml, maxLength = 1000) {
    if (!xml) return '';
    const str = typeof xml === 'string' ? xml : String(xml);
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + `... [truncated ${str.length - maxLength} chars]`;
  }

  /**
   * Fetches and parses the WSDL to extract namespaces and operations
   */
  async loadWsdl() {
    if (this.wsdlCache) {
      return this.wsdlCache;
    }

    try {
      console.log(`[OracleSoapClient] Fetching WSDL from ${this.wsdlUrl}`);

      const response = await axios.get(this.wsdlUrl, {
        auth: {
          username: this.username,
          password: this.password,
        },
        timeout: this.requestTimeout,
        headers: {
          'Accept': 'text/xml, application/xml',
        },
      });

      const wsdlText = typeof response.data === 'string' ? response.data : response.data.toString();
      const wsdl = this.xmlParser.parse(wsdlText);

      // Extract namespaces from WSDL
      this.extractNamespaces(wsdl);

      // Extract operations and their SOAPAction
      this.extractOperations(wsdl);

      this.wsdlCache = wsdl;
      console.log(`[OracleSoapClient] WSDL loaded successfully`);
      console.log(`[OracleSoapClient] Found namespaces:`, Object.keys(this.namespaces));
      console.log(`[OracleSoapClient] Found operations:`, Object.keys(this.operations));

      return wsdl;
    } catch (error) {
      console.error(`[OracleSoapClient] Failed to load WSDL:`, error.message);
      throw new Error(`Failed to load WSDL from ${this.wsdlUrl}: ${error.message}`);
    }
  }

  /**
   * Extracts namespace declarations from WSDL
   */
  extractNamespaces(wsdl) {
    const definitions = wsdl['wsdl:definitions'] || wsdl.definitions || wsdl;

    // Extract all xmlns attributes
    for (const key in definitions) {
      if (key.startsWith('@_xmlns:')) {
        const prefix = key.replace('@_xmlns:', '');
        const uri = definitions[key];
        this.namespaces[prefix] = uri;
      } else if (key === '@_targetNamespace') {
        this.namespaces['tns'] = definitions[key];
      }
    }

    // Common Oracle Fusion namespaces
    if (!this.namespaces['soapenv']) {
      this.namespaces['soapenv'] = 'http://schemas.xmlsoap.org/soap/envelope/';
    }
  }

  /**
   * Extracts operations and their SOAPAction from WSDL
   */
  extractOperations(wsdl) {
    try {
      const definitions = wsdl['wsdl:definitions'] || wsdl.definitions || wsdl;
      const binding = definitions['wsdl:binding'] || definitions.binding;

      if (!binding) {
        console.warn('[OracleSoapClient] No binding found in WSDL');
        return;
      }

      // Handle single binding or array of bindings
      const bindings = Array.isArray(binding) ? binding : [binding];

      for (const b of bindings) {
        const operations = b['wsdl:operation'] || b.operation;
        if (!operations) continue;

        const ops = Array.isArray(operations) ? operations : [operations];

        for (const op of ops) {
          const opName = op['@_name'];
          const soapOp = op['soap:operation'] || op['soap12:operation'];

          if (opName && soapOp) {
            this.operations[opName] = {
              soapAction: soapOp['@_soapAction'] || '',
              style: soapOp['@_style'] || 'document',
            };
          }
        }
      }
    } catch (error) {
      console.warn('[OracleSoapClient] Failed to extract operations:', error.message);
    }
  }

  /**
   * Gets the SOAPAction header for an operation
   */
  getSoapAction(operationName) {
    if (this.operations[operationName]) {
      return this.operations[operationName].soapAction;
    }
    // Fallback to operation name
    return operationName;
  }

  /**
   * Builds a SOAP envelope with proper namespaces
   */
  buildSoapEnvelope(operationName, parameters, operationNamespace) {
    // Use discovered namespaces or fallback to defaults
    const soapenvNs = this.namespaces['soapenv'] || 'http://schemas.xmlsoap.org/soap/envelope/';
    const targetNs = operationNamespace || this.namespaces['tns'] || '';

    const envelope = {
      'soapenv:Envelope': {
        '@_xmlns:soapenv': soapenvNs,
        '@_xmlns:ns': targetNs,
        'soapenv:Header': {},
        'soapenv:Body': {
          [`ns:${operationName}`]: parameters,
        },
      },
    };

    return this.xmlBuilder.build(envelope);
  }

  /**
   * Parses MTOM/XOP multipart responses from Oracle
   */
  parseMtomResponse(responseData, contentType) {
    try {
      const data = typeof responseData === 'string' ? responseData : responseData.toString('utf-8');

      // Check if it's a multipart response
      if (contentType && contentType.includes('multipart')) {
        // Extract boundary
        const boundaryMatch = contentType.match(/boundary="?([^";,]+)"?/);
        if (!boundaryMatch) {
          console.warn('[OracleSoapClient] Multipart response but no boundary found');
          return this.extractXmlFromResponse(data);
        }

        const boundary = boundaryMatch[1];
        const parts = data.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

        // Find the SOAP XML part (usually the first part after boundary)
        for (const part of parts) {
          if (part.includes('Content-Type:') && (part.includes('application/xop+xml') || part.includes('text/xml'))) {
            // Extract XML content after headers
            const xmlStart = part.indexOf('<?xml');
            if (xmlStart === -1) {
              const envelopeStart = part.search(/<\s*[\w.:-]*Envelope/i);
              if (envelopeStart !== -1) {
                return part.slice(envelopeStart);
              }
            } else {
              return part.slice(xmlStart);
            }
          }
        }
      }

      // Not multipart or couldn't parse - return as-is
      return this.extractXmlFromResponse(data);
    } catch (error) {
      console.error('[OracleSoapClient] Error parsing MTOM response:', error.message);
      return this.extractXmlFromResponse(responseData);
    }
  }

  /**
   * Extracts XML payload from response data
   */
  extractXmlFromResponse(data) {
    const text = typeof data === 'string' ? data : data.toString('utf-8');

    // Try to find XML declaration
    const xmlStart = text.indexOf('<?xml');
    if (xmlStart !== -1) {
      return text.slice(xmlStart);
    }

    // Try to find Envelope tag
    const envelopeStart = text.search(/<\s*[\w.:-]*Envelope/i);
    if (envelopeStart !== -1) {
      return text.slice(envelopeStart);
    }

    return text;
  }

  /**
   * Extracts SOAP fault message from response
   */
  extractSoapFault(xmlText) {
    try {
      const parsed = this.xmlParser.parse(xmlText);

      // Navigate through possible SOAP envelope structures
      const envelope = parsed['soap:Envelope'] ||
                      parsed['soapenv:Envelope'] ||
                      parsed['env:Envelope'] ||
                      parsed.Envelope;

      if (!envelope) return null;

      const body = envelope['soap:Body'] ||
                   envelope['soapenv:Body'] ||
                   envelope['env:Body'] ||
                   envelope.Body;

      if (!body) return null;

      const fault = body['soap:Fault'] ||
                    body['soapenv:Fault'] ||
                    body['env:Fault'] ||
                    body.Fault;

      if (!fault) return null;

      // Extract fault details
      const faultcode = fault.faultcode || fault['soap:faultcode'] || '';
      const faultstring = fault.faultstring || fault['soap:faultstring'] || '';
      const detail = fault.detail || fault['soap:detail'] || '';

      return {
        code: typeof faultcode === 'object' ? faultcode['#text'] || '' : faultcode,
        message: typeof faultstring === 'object' ? faultstring['#text'] || '' : faultstring,
        detail: typeof detail === 'object' ? JSON.stringify(detail) : detail,
      };
    } catch (error) {
      console.error('[OracleSoapClient] Error parsing SOAP fault:', error.message);

      // Fallback to regex extraction
      const faultMatch = xmlText.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
      if (faultMatch) {
        return {
          code: 'SOAP-ENV:Server',
          message: faultMatch[1].trim(),
          detail: '',
        };
      }

      return null;
    }
  }

  /**
   * Calls a SOAP operation with automatic retry and error handling
   */
  async call(operationName, parameters, operationNamespace) {
    // Load WSDL if not already loaded
    if (!this.wsdlCache) {
      await this.loadWsdl();
    }

    const soapAction = this.getSoapAction(operationName);
    const soapEnvelope = this.buildSoapEnvelope(operationName, parameters, operationNamespace);

    console.log(`[OracleSoapClient] Calling operation: ${operationName}`);
    console.log(`[OracleSoapClient] SOAPAction: ${soapAction}`);
    console.log(`[OracleSoapClient] Endpoint: ${this.serviceUrl}`);

    return pRetry(
      async () => {
        const response = await axios.post(this.serviceUrl, soapEnvelope, {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Accept': 'text/xml, application/xml, multipart/related',
            'SOAPAction': soapAction ? `"${soapAction}"` : `"${operationName}"`,
            'Authorization': `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
          },
          timeout: this.requestTimeout,
          validateStatus: () => true, // Don't throw on any status
          responseType: 'text',
          transformResponse: [(data) => data], // Prevent axios from parsing
        });

        const contentType = response.headers['content-type'] || '';
        const xmlResponse = this.parseMtomResponse(response.data, contentType);
        const fault = this.extractSoapFault(xmlResponse);

        // Check for HTTP errors
        if (response.status >= 500) {
          console.error(`[OracleSoapClient] HTTP ${response.status} error:`, xmlResponse.substring(0, 500));

          const errorMessage = fault ? fault.message : `HTTP ${response.status} error`;

          // Check for non-retryable errors
          if (fault && /InvalidSecurity|FailedAuthentication|InvalidCredentials|invalid credentials/i.test(fault.message)) {
            throw new pRetry.AbortError(new Error(errorMessage));
          }

          throw new Error(errorMessage);
        }

        // Check for SOAP faults
        if (fault) {
          console.error(`[OracleSoapClient] SOAP Fault:`, fault);

          // Check if fault is retryable
          if (/timeout|temporarily unavailable|service unavailable/i.test(fault.message)) {
            throw new Error(fault.message);
          }

          // Non-retryable SOAP fault
          throw new pRetry.AbortError(new Error(fault.message));
        }

        return {
          success: true,
          status: response.status,
          statusText: response.statusText,
          data: xmlResponse,
          parsed: this.xmlParser.parse(xmlResponse),
        };
      },
      {
        retries: this.maxRetries,
        minTimeout: this.retryMinTimeout,
        maxTimeout: this.retryMaxTimeout,
        onFailedAttempt: (error) => {
          console.warn(
            `[OracleSoapClient] Retry ${error.attemptNumber}/${this.maxRetries}: ${error.message}`
          );
        },
      }
    );
  }

  /**
   * Calls a SOAP operation with custom XML envelope (for backward compatibility)
   */
  async callWithCustomEnvelope(soapXml, soapAction) {
    this.requestCounter++;
    const requestId = `REQ-${Date.now()}-${this.requestCounter}`;

    console.log(`[OracleSoapClient] ${requestId} Starting SOAP call`);
    console.log(`[OracleSoapClient] ${requestId} SOAPAction: ${soapAction || '(none)'}`);
    console.log(`[OracleSoapClient] ${requestId} Endpoint: ${this.serviceUrl}`);

    // Validate inputs
    if (!soapXml || typeof soapXml !== 'string') {
      throw new Error('Invalid SOAP XML: must be a non-empty string');
    }

    if (!this.serviceUrl) {
      throw new Error('Service URL is not configured');
    }

    // Always log the request XML for debugging (truncated in normal mode, full in debug mode)
    if (this.debugMode) {
      console.log(`[OracleSoapClient] ${requestId} Full Request XML:`, soapXml);
    } else {
      console.log(`[OracleSoapClient] ${requestId} Request XML (truncated):`, this.truncateXml(soapXml, 500));
    }

    return pRetry(
      async () => {
        const startTime = Date.now();

        try {
          // Build authentication header
          const authHeader = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;

          const headers = {
            'Content-Type': 'text/xml; charset=utf-8',
            'Accept': 'text/xml, application/xml, multipart/related',
            'SOAPAction': soapAction ? `"${soapAction}"` : '""',
            'Authorization': authHeader,
            'Content-Length': Buffer.byteLength(soapXml, 'utf-8'),
          };

          this.debugLog(`${requestId} Request Headers:`, headers);

          const response = await axios.post(this.serviceUrl, soapXml, {
            headers,
            timeout: this.requestTimeout,
            validateStatus: () => true,
            responseType: 'text',
            transformResponse: [(data) => data],
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });

          const elapsed = Date.now() - startTime;
          console.log(`[OracleSoapClient] ${requestId} Response received in ${elapsed}ms - HTTP ${response.status}`);

          // Log response headers in debug mode
          this.debugLog(`${requestId} Response Headers:`, response.headers);

          const contentType = response.headers['content-type'] || '';
          const xmlResponse = this.parseMtomResponse(response.data, contentType);

          // Log response XML in debug mode
          this.debugLog(`${requestId} Response XML:`, this.truncateXml(xmlResponse));

          const fault = this.extractSoapFault(xmlResponse);

          // Check for HTTP errors (5xx)
          if (response.status >= 500) {
            // Log FULL response XML for 500 errors (don't truncate)
            console.error(`[OracleSoapClient] ${requestId} HTTP ${response.status} error`);
            console.error(`[OracleSoapClient] ${requestId} Full Response XML:`, xmlResponse);

            const errorMessage = fault ? fault.message : `HTTP ${response.status} error`;

            if (fault) {
              console.error(`[OracleSoapClient] ${requestId} SOAP Fault Details:`);
              console.error(`  Code: ${fault.code}`);
              console.error(`  Message: ${fault.message}`);
              console.error(`  Detail: ${fault.detail}`);
            }

            // Check for non-retryable errors
            if (fault && /InvalidSecurity|FailedAuthentication|InvalidCredentials|invalid credentials|unauthorized/i.test(fault.message)) {
              console.error(`[OracleSoapClient] ${requestId} Authentication failed - not retrying`);
              throw new pRetry.AbortError(new Error(`Authentication failed: ${errorMessage}`));
            }

            throw new Error(errorMessage);
          }

          // Check for client errors (4xx)
          if (response.status >= 400) {
            console.error(`[OracleSoapClient] ${requestId} HTTP ${response.status} client error:`, this.truncateXml(xmlResponse, 500));
            const errorMessage = fault ? fault.message : `HTTP ${response.status} client error`;
            // 4xx errors are typically not retryable
            throw new pRetry.AbortError(new Error(errorMessage));
          }

          // Check for SOAP faults
          if (fault) {
            console.error(`[OracleSoapClient] ${requestId} SOAP Fault detected:`, fault);

            // Check if fault is retryable (transient errors)
            if (/timeout|temporarily unavailable|service unavailable|too many requests|rate limit/i.test(fault.message)) {
              console.warn(`[OracleSoapClient] ${requestId} Transient error detected - will retry`);
              throw new Error(fault.message);
            }

            // Non-retryable SOAP fault (business logic errors, validation errors, etc.)
            console.error(`[OracleSoapClient] ${requestId} Non-retryable SOAP fault - aborting`);
            throw new pRetry.AbortError(new Error(fault.message));
          }

          // Success response
          console.log(`[OracleSoapClient] ${requestId} ✅ Success - HTTP ${response.status} in ${elapsed}ms`);

          return {
            success: true,
            status: response.status,
            statusText: response.statusText,
            data: xmlResponse,
            parsed: this.xmlParser.parse(xmlResponse),
            requestId,
            elapsed,
          };

        } catch (error) {
          // Handle axios errors
          if (error.code === 'ECONNABORTED') {
            console.error(`[OracleSoapClient] ${requestId} Request timeout after ${this.requestTimeout}ms`);
            throw new Error(`Request timeout after ${this.requestTimeout}ms`);
          }

          if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error(`[OracleSoapClient] ${requestId} Network error: ${error.code}`);
            throw new Error(`Network error: Cannot reach ${this.serviceUrl}`);
          }

          // Re-throw if it's already a pRetry.AbortError
          if (error instanceof pRetry.AbortError) {
            throw error;
          }

          // Re-throw other errors for retry
          throw error;
        }
      },
      {
        retries: this.maxRetries,
        minTimeout: this.retryMinTimeout,
        maxTimeout: this.retryMaxTimeout,
        onFailedAttempt: (error) => {
          console.warn(
            `[OracleSoapClient] ${requestId} Retry ${error.attemptNumber}/${this.maxRetries + 1}: ${error.message}`
          );
          if (error.attemptNumber < this.maxRetries + 1) {
            console.log(`[OracleSoapClient] ${requestId} Waiting before retry...`);
          } else {
            console.error(`[OracleSoapClient] ${requestId} All retries exhausted`);
          }
        },
      }
    );
  }
}

/**
 * Factory function to create OracleSoapClient instances with environment configuration
 */
function createOracleSoapClient(serviceUrl, wsdlUrl) {
  const username = process.env.ORACLE_USERNAME;
  const password = process.env.ORACLE_PASSWORD;
  const maxRetries = parseInt(process.env.MAX_RETRIES) || 3;

  if (!username || !password) {
    throw new Error('Oracle credentials not configured. Set ORACLE_USERNAME and ORACLE_PASSWORD in .env');
  }

  if (!serviceUrl) {
    throw new Error('Oracle service URL is required');
  }

  // If WSDL URL not provided, try to construct it from service URL
  const finalWsdlUrl = wsdlUrl || `${serviceUrl}?WSDL`;

  return new OracleSoapClient({
    wsdlUrl: finalWsdlUrl,
    serviceUrl,
    username,
    password,
    maxRetries,
    requestTimeout: 30000,
  });
}

module.exports = OracleSoapClient;
module.exports.createOracleSoapClient = createOracleSoapClient;
