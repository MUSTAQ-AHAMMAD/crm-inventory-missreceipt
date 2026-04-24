/**
 * Oracle SOAP Client Tests
 * Tests WSDL parsing, MTOM/XOP response parsing, and SOAP operations
 */

const OracleSoapClient = require('../services/OracleSoapClient');
const axios = require('axios');

// Mock axios
jest.mock('axios');

describe('OracleSoapClient', () => {
  let client;
  const mockConfig = {
    wsdlUrl: 'https://test.oraclecloud.com/service?WSDL',
    serviceUrl: 'https://test.oraclecloud.com/service',
    username: 'testuser',
    password: 'testpass',
    maxRetries: 2,
    retryMinTimeout: 100,
    retryMaxTimeout: 500,
    requestTimeout: 5000,
  };

  beforeEach(() => {
    client = new OracleSoapClient(mockConfig);
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with correct configuration', () => {
      expect(client.wsdlUrl).toBe(mockConfig.wsdlUrl);
      expect(client.serviceUrl).toBe(mockConfig.serviceUrl);
      expect(client.username).toBe(mockConfig.username);
      expect(client.password).toBe(mockConfig.password);
      expect(client.maxRetries).toBe(2);
    });

    test('should use default values when not provided', () => {
      const minimalClient = new OracleSoapClient({
        wsdlUrl: 'https://test.com?WSDL',
        serviceUrl: 'https://test.com',
        username: 'user',
        password: 'pass',
      });

      expect(minimalClient.maxRetries).toBe(3);
      expect(minimalClient.retryMinTimeout).toBe(1000);
      expect(minimalClient.retryMaxTimeout).toBe(10000);
    });
  });

  describe('extractXmlFromResponse', () => {
    test('should extract XML with declaration', () => {
      const response = '<?xml version="1.0"?><root>test</root>';
      const result = client.extractXmlFromResponse(response);
      expect(result).toBe('<?xml version="1.0"?><root>test</root>');
    });

    test('should extract XML without declaration', () => {
      const response = 'Some text before<soapenv:Envelope>content</soapenv:Envelope>';
      const result = client.extractXmlFromResponse(response);
      expect(result).toBe('<soapenv:Envelope>content</soapenv:Envelope>');
    });

    test('should handle SOAP 1.2 envelope', () => {
      const response = 'Header data<env:Envelope>content</env:Envelope>';
      const result = client.extractXmlFromResponse(response);
      expect(result).toBe('<env:Envelope>content</env:Envelope>');
    });

    test('should return original text if no XML found', () => {
      const response = 'Plain text response';
      const result = client.extractXmlFromResponse(response);
      expect(result).toBe('Plain text response');
    });
  });

  describe('parseMtomResponse', () => {
    test('should parse multipart MTOM response', () => {
      const boundary = 'boundary123';
      const multipartResponse = `--${boundary}
Content-Type: application/xop+xml; charset=UTF-8

<?xml version="1.0"?>
<soapenv:Envelope>
  <soapenv:Body>
    <response>Success</response>
  </soapenv:Body>
</soapenv:Envelope>
--${boundary}--`;

      const contentType = `multipart/related; boundary="${boundary}"`;
      const result = client.parseMtomResponse(multipartResponse, contentType);

      expect(result).toContain('<?xml version="1.0"?>');
      expect(result).toContain('<soapenv:Envelope>');
      expect(result).toContain('<response>Success</response>');
    });

    test('should handle non-multipart response', () => {
      const xmlResponse = '<?xml version="1.0"?><root>test</root>';
      const result = client.parseMtomResponse(xmlResponse, 'text/xml');
      expect(result).toBe('<?xml version="1.0"?><root>test</root>');
    });

    test('should extract XML from multipart without XML declaration', () => {
      const boundary = 'boundary456';
      const multipartResponse = `--${boundary}
Content-Type: text/xml

<soap:Envelope>
  <soap:Body>
    <result>OK</result>
  </soap:Body>
</soap:Envelope>
--${boundary}--`;

      const contentType = `multipart/related; boundary="${boundary}"`;
      const result = client.parseMtomResponse(multipartResponse, contentType);

      expect(result).toContain('<soap:Envelope>');
      expect(result).toContain('<result>OK</result>');
    });
  });

  describe('extractSoapFault', () => {
    test('should extract SOAP 1.1 fault', () => {
      const faultXml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>Unknown method</faultstring>
      <detail>Method not found in service</detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

      const fault = client.extractSoapFault(faultXml);
      expect(fault).not.toBeNull();
      expect(fault.code).toBe('soapenv:Server');
      expect(fault.message).toBe('Unknown method');
    });

    test('should extract SOAP 1.2 fault', () => {
      const faultXml = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <soap:Fault>
      <soap:faultcode>soap:Receiver</soap:faultcode>
      <soap:faultstring>Invalid credentials</soap:faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

      const fault = client.extractSoapFault(faultXml);
      expect(fault).not.toBeNull();
      expect(fault.message).toContain('Invalid credentials');
    });

    test('should return null for non-fault response', () => {
      const successXml = `<?xml version="1.0"?>
<soapenv:Envelope>
  <soapenv:Body>
    <response>Success</response>
  </soapenv:Body>
</soapenv:Envelope>`;

      const fault = client.extractSoapFault(successXml);
      expect(fault).toBeNull();
    });

    test('should handle malformed XML gracefully', () => {
      const malformedXml = 'Not valid XML at all';
      const fault = client.extractSoapFault(malformedXml);
      expect(fault).toBeNull();
    });
  });

  describe('loadWsdl', () => {
    test('should fetch and parse WSDL', async () => {
      const mockWsdl = `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
                  xmlns:tns="http://test.oracle.com/service"
                  targetNamespace="http://test.oracle.com/service">
  <wsdl:binding name="ServiceBinding" type="tns:ServicePort">
    <wsdl:operation name="createMiscellaneousReceipt">
      <soap:operation soapAction="createMiscellaneousReceipt" style="document"/>
    </wsdl:operation>
  </wsdl:binding>
</wsdl:definitions>`;

      axios.get.mockResolvedValue({ data: mockWsdl });

      await client.loadWsdl();

      expect(axios.get).toHaveBeenCalledWith(
        mockConfig.wsdlUrl,
        expect.objectContaining({
          auth: {
            username: mockConfig.username,
            password: mockConfig.password,
          },
        })
      );

      expect(client.wsdlCache).not.toBeNull();
      expect(client.operations.createMiscellaneousReceipt).toBeDefined();
    });

    test('should cache WSDL after first load', async () => {
      const mockWsdl = '<wsdl:definitions></wsdl:definitions>';
      axios.get.mockResolvedValue({ data: mockWsdl });

      await client.loadWsdl();
      await client.loadWsdl();

      // Should only call axios.get once
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('should throw error on WSDL fetch failure', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      await expect(client.loadWsdl()).rejects.toThrow('Failed to load WSDL');
    });
  });

  describe('getSoapAction', () => {
    beforeEach(() => {
      client.operations = {
        testOperation: {
          soapAction: 'http://test.com/testOperation',
          style: 'document',
        },
      };
    });

    test('should return SOAPAction for known operation', () => {
      const action = client.getSoapAction('testOperation');
      expect(action).toBe('http://test.com/testOperation');
    });

    test('should return operation name for unknown operation', () => {
      const action = client.getSoapAction('unknownOperation');
      expect(action).toBe('unknownOperation');
    });
  });

  describe('buildSoapEnvelope', () => {
    beforeEach(() => {
      client.namespaces = {
        soapenv: 'http://schemas.xmlsoap.org/soap/envelope/',
        tns: 'http://test.oracle.com/service',
      };
    });

    test('should build SOAP envelope with parameters', () => {
      const params = {
        Amount: '-100.00',
        CurrencyCode: 'SAR',
      };

      const envelope = client.buildSoapEnvelope('testOperation', params);

      expect(envelope).toContain('soapenv:Envelope');
      expect(envelope).toContain('ns:testOperation');
      expect(envelope).toContain('-100.00');
      expect(envelope).toContain('SAR');
    });

    test('should use custom namespace if provided', () => {
      const params = { field: 'value' };
      const customNs = 'http://custom.namespace.com';

      const envelope = client.buildSoapEnvelope('operation', params, customNs);

      expect(envelope).toContain(customNs);
    });
  });

  describe('callWithCustomEnvelope', () => {
    const customXml = `<?xml version="1.0"?>
<soapenv:Envelope>
  <soapenv:Body>
    <createReceipt/>
  </soapenv:Body>
</soapenv:Envelope>`;

    test('should successfully call SOAP service', async () => {
      const mockResponse = `<?xml version="1.0"?>
<soapenv:Envelope>
  <soapenv:Body>
    <createReceiptResponse>
      <result>Success</result>
    </createReceiptResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

      axios.post.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: mockResponse,
        headers: { 'content-type': 'text/xml' },
      });

      const result = await client.callWithCustomEnvelope(customXml, 'createReceipt');

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toContain('Success');
    });

    test('should retry on server error', async () => {
      axios.post
        .mockRejectedValueOnce(new Error('HTTP 500: Server error'))
        .mockResolvedValueOnce({
          status: 200,
          data: '<response>Success</response>',
          headers: { 'content-type': 'text/xml' },
        });

      const result = await client.callWithCustomEnvelope(customXml, 'createReceipt');

      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    test('should not retry on authentication error', async () => {
      const faultXml = `<?xml version="1.0"?>
<soapenv:Envelope>
  <soapenv:Body>
    <soapenv:Fault>
      <faultstring>InvalidSecurity: Authentication failed</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

      axios.post.mockResolvedValue({
        status: 500,
        data: faultXml,
        headers: { 'content-type': 'text/xml' },
      });

      await expect(
        client.callWithCustomEnvelope(customXml, 'createReceipt')
      ).rejects.toThrow('Authentication failed');

      // Should not retry authentication errors
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    test('should handle MTOM multipart response', async () => {
      const boundary = 'mtomboundary';
      const mtomResponse = `--${boundary}
Content-Type: application/xop+xml

<?xml version="1.0"?>
<soapenv:Envelope>
  <soapenv:Body>
    <result>Success</result>
  </soapenv:Body>
</soapenv:Envelope>
--${boundary}--`;

      axios.post.mockResolvedValue({
        status: 200,
        data: mtomResponse,
        headers: { 'content-type': `multipart/related; boundary="${boundary}"` },
      });

      const result = await client.callWithCustomEnvelope(customXml, 'createReceipt');

      expect(result.success).toBe(true);
      expect(result.data).toContain('Success');
    });
  });

  describe('Error Handling', () => {
    test('should extract meaningful error from SOAP fault', () => {
      const faultXml = `<?xml version="1.0"?>
<soapenv:Envelope>
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Client</faultcode>
      <faultstring>Unknown method 'createMiscellaneousReceipt'</faultstring>
      <detail>
        <message>The operation QName {namespace}createMiscellaneousReceipt does not match any operation</message>
      </detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

      const fault = client.extractSoapFault(faultXml);

      expect(fault).not.toBeNull();
      expect(fault.message).toContain('Unknown method');
      expect(fault.code).toBe('soapenv:Client');
    });

    test('should handle network timeout errors', async () => {
      const customXml = '<soap:Envelope/>';
      axios.post.mockRejectedValue(new Error('timeout of 5000ms exceeded'));

      await expect(
        client.callWithCustomEnvelope(customXml, 'operation')
      ).rejects.toThrow('timeout');
    });
  });
});
