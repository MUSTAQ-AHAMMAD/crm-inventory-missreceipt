/**
 * Raw SOAP Sender - Bypasses XML parsing to send raw SOAP envelopes
 * 
 * This avoids the namespace issues caused by fast-xml-parser re-serializing
 * the XML with ns2: prefixes instead of the correct typ:/inv: prefixes.
 */

const axios = require('axios');
const https = require('https');
const http = require('http');

/**
 * Sends a raw SOAP request without any XML parsing/modification
 * 
 * @param {string} url - Oracle SOAP endpoint URL
 * @param {string} xml - Raw SOAP XML envelope (as string)
 * @param {string} soapAction - SOAPAction header value (e.g., "createSimpleInvoice")
 * @param {string} authHeader - Base64 encoded Basic auth header
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Axios response object
 */
async function sendRawSoapRequest(url, xml, soapAction, authHeader, options = {}) {
  const startTime = Date.now();
  const requestId = `RAW-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  
  console.log(`[RawSOAP] ${requestId} Sending raw SOAP request`);
  console.log(`[RawSOAP] ${requestId} URL: ${url}`);
  console.log(`[RawSOAP] ${requestId} SOAPAction: ${soapAction}`);
  
  // Log the full XML for debugging (truncated in production)
  if (process.env.AR_INVOICE_VERBOSE_LOGGING === 'true') {
    console.log(`[RawSOAP] ${requestId} ═══ FULL XML START ═══`);
    console.log(xml);
    console.log(`[RawSOAP] ${requestId} ═══ FULL XML END ═══`);
  } else {
    console.log(`[RawSOAP] ${requestId} XML (truncated): ${xml.substring(0, 500)}...`);
  }
  
  // Validate inputs
  if (!xml || typeof xml !== 'string') {
    throw new Error('Invalid SOAP XML: must be a non-empty string');
  }
  
  if (!url) {
    throw new Error('Service URL is not configured');
  }
  
  // Determine if HTTPS
  const isHttps = url.startsWith('https');
  const AgentClass = isHttps ? https.Agent : http.Agent;
  const agent = new AgentClass({
    keepAlive: true,
    timeout: options.connectTimeout || 30000,
  });
  
  const timeout = options.timeout || 300000;
  
  try {
    const response = await axios({
      method: 'post',
      url: url,
      data: xml,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Accept': 'text/xml, application/xml, multipart/related',
        'SOAPAction': `"${soapAction}"`,
        'Authorization': `Basic ${authHeader}`,
        'Content-Length': Buffer.byteLength(xml, 'utf-8'),
      },
      timeout: timeout,
      httpAgent: agent,
      httpsAgent: agent,
      validateStatus: () => true, // Don't throw on any status
      responseType: 'text',
      transformResponse: [(data) => data], // Prevent axios from parsing
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`[RawSOAP] ${requestId} Response received in ${elapsed}ms - HTTP ${response.status}`);
    
    // Log response (truncated)
    if (process.env.AR_INVOICE_VERBOSE_LOGGING === 'true') {
      console.log(`[RawSOAP] ${requestId} ═══ FULL RESPONSE START ═══`);
      console.log(response.data);
      console.log(`[RawSOAP] ${requestId} ═══ FULL RESPONSE END ═══`);
    } else {
      const preview = response.data ? response.data.substring(0, 500) : '(empty)';
      console.log(`[RawSOAP] ${requestId} Response (truncated): ${preview}...`);
    }
    
    return response;
  } catch (error) {
    console.error(`[RawSOAP] ${requestId} Request failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  sendRawSoapRequest,
};