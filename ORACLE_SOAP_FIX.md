# Oracle SOAP Client - Permanent Fix for "Unknown method" Error

## Problem Summary

The application was experiencing "Unknown method" errors when calling Oracle Fusion's `createMiscellaneousReceipt` SOAP operation. This was NOT an Axios issue but a SOAP structure and namespace problem.

## Root Cause

The error occurred due to:
1. **Incorrect namespace handling** - Hardcoded namespaces that didn't match Oracle's expectations
2. **Missing WSDL auto-discovery** - No dynamic discovery of correct namespaces and SOAPAction values
3. **Improper MTOM/XOP response parsing** - Oracle returns multipart responses that weren't being parsed correctly
4. **No automatic SOAPAction resolution** - SOAPAction header values must match what's defined in the WSDL

## Solution Architecture

### 1. OracleSoapClient Class (`backend/src/services/OracleSoapClient.js`)

A comprehensive SOAP client that handles all Oracle Fusion SOAP service requirements:

#### Features:
- **WSDL Auto-Discovery**: Automatically fetches and parses WSDL to extract:
  - Correct namespaces
  - Valid operation names
  - Required SOAPAction header values

- **MTOM/XOP Response Parsing**: Properly handles Oracle's multipart responses with multiple boundaries

- **Automatic Namespace Resolution**: Extracts and applies the correct namespaces from WSDL instead of hardcoding them

- **Retry Logic with Exponential Backoff**:
  - Retries transient errors (timeouts, 5xx errors)
  - Does NOT retry authentication/authorization failures
  - Uses `p-retry` for intelligent retry handling

- **Comprehensive Error Handling**:
  - Parses SOAP faults from responses
  - Extracts meaningful error messages
  - Distinguishes between retryable and non-retryable errors

#### Key Methods:

```javascript
// Load WSDL and extract metadata
await client.loadWsdl();

// Call operation with auto-discovered namespaces
await client.call(operationName, parameters, operationNamespace);

// Call with custom XML envelope (backward compatible)
await client.callWithCustomEnvelope(soapXml, soapAction);
```

### 2. Integration with Existing Code

The miscellaneous receipt controller (`backend/src/controllers/miscReceiptController.js`) now uses the new SOAP client:

```javascript
// Create SOAP client with WSDL auto-discovery
const soapClient = createOracleSoapClient();

// Use for all SOAP requests
const response = await soapClient.callWithCustomEnvelope(soapXml, SOAP_ACTION);
```

### 3. Configuration

Add to `.env` file:

```env
# Oracle SOAP endpoint
ORACLE_SOAP_URL=https://your-instance.oraclecloud.com/fscmService/MiscellaneousReceiptService

# Oracle credentials
ORACLE_USERNAME=your.username@company.com
ORACLE_PASSWORD=your_password

# Retry configuration
MAX_RETRIES=3
CONCURRENT_REQUESTS=5
```

## How It Works

### WSDL Discovery Flow:

1. **Fetch WSDL**: Client automatically fetches WSDL from `{serviceUrl}?WSDL`
2. **Parse Namespaces**: Extracts all `xmlns:*` declarations and targetNamespace
3. **Extract Operations**: Finds all operations and their SOAPAction values from bindings
4. **Cache Results**: WSDL is cached to avoid repeated fetches

### MTOM/XOP Parsing Flow:

1. **Detect Multipart**: Checks Content-Type header for `multipart/related`
2. **Extract Boundary**: Parses boundary parameter from Content-Type
3. **Split Parts**: Splits response by boundary markers
4. **Find XML Part**: Locates the `application/xop+xml` or `text/xml` part
5. **Extract Payload**: Extracts clean XML from the multipart structure

### SOAP Fault Handling:

1. **Parse Response**: Attempts to parse XML response
2. **Navigate Structure**: Handles SOAP 1.1, 1.2, and custom envelope structures
3. **Extract Fault Details**: Gets faultcode, faultstring, and detail
4. **Classify Error**: Determines if error is retryable or should abort
5. **Return Meaningful Message**: Provides clear error to calling code

## Testing

### Unit Tests

Comprehensive test suite in `backend/src/__tests__/OracleSoapClient.test.js`:

```bash
npm test -- OracleSoapClient.test.js
```

Tests cover:
- WSDL loading and parsing
- Namespace extraction
- Operation discovery
- MTOM/XOP response parsing
- SOAP fault extraction
- Retry logic
- Error handling

### Integration Testing

Test with actual Oracle Fusion instance:

```bash
# Set environment variables
export ORACLE_SOAP_URL="https://your-instance.oraclecloud.com/fscmService/MiscellaneousReceiptService"
export ORACLE_USERNAME="your.username@company.com"
export ORACLE_PASSWORD="your_password"

# Run the application
npm start

# Upload a test CSV file
curl -X POST http://localhost:4000/api/misc-receipt/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test_data.csv"
```

## Debugging

### Enable Verbose Logging

The SOAP client includes comprehensive logging:

```javascript
console.log(`[OracleSoapClient] Fetching WSDL from ${this.wsdlUrl}`);
console.log(`[OracleSoapClient] Found namespaces:`, Object.keys(this.namespaces));
console.log(`[OracleSoapClient] Found operations:`, Object.keys(this.operations));
console.log(`[OracleSoapClient] Calling operation: ${operationName}`);
console.log(`[OracleSoapClient] SOAPAction: ${soapAction}`);
```

### Common Issues and Solutions

#### Issue: "Unknown method" Error
**Solution**: Check that the WSDL is accessible and the operation name matches exactly what's in the WSDL binding.

#### Issue: "InvalidSecurity" or Authentication Errors
**Solution**: Verify credentials in `.env` file. These errors will NOT be retried.

#### Issue: Timeout Errors
**Solution**: Increase `requestTimeout` in client configuration or check network connectivity to Oracle.

#### Issue: "Cannot parse WSDL"
**Solution**: Ensure WSDL URL is correct (should end with `?WSDL`) and accessible with your credentials.

## Performance Considerations

### Concurrency Control

The controller uses `p-limit` to control concurrent SOAP requests:

```javascript
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS) || 5;
const limit = pLimit(CONCURRENT_REQUESTS);
```

Adjust `CONCURRENT_REQUESTS` based on:
- Oracle API rate limits
- Network bandwidth
- Server resources

### WSDL Caching

WSDL is fetched once and cached for the lifetime of the client instance. To refresh:
```javascript
client.wsdlCache = null;
await client.loadWsdl();
```

### Retry Strategy

Default retry configuration:
- Max retries: 3
- Min timeout: 1 second
- Max timeout: 10 seconds
- Strategy: Exponential backoff

Customize via client config:
```javascript
new OracleSoapClient({
  // ...
  maxRetries: 5,
  retryMinTimeout: 2000,
  retryMaxTimeout: 30000,
})
```

## Dependencies

New dependencies added:
- `fast-xml-parser` (^4.x) - For robust XML parsing and building

Existing dependencies used:
- `axios` - For HTTP requests
- `p-retry` - For retry logic with exponential backoff

## Migration from Old Code

### Before (Direct Axios):
```javascript
const res = await axios.post(process.env.ORACLE_SOAP_URL, soapXml, {
  headers: {
    'Content-Type': 'text/xml; charset=utf-8',
    SOAPAction: SOAP_ACTION_HEADER,
    Authorization: `Basic ${oracleAuth}`,
  },
});
```

### After (OracleSoapClient):
```javascript
const soapClient = createOracleSoapClient();
const response = await soapClient.callWithCustomEnvelope(soapXml, SOAP_ACTION);
```

## Benefits

1. **No More "Unknown method" Errors**: Automatic namespace and operation discovery ensures correct SOAP structure
2. **Proper MTOM/XOP Support**: Handles Oracle's multipart responses correctly
3. **Better Error Messages**: Meaningful SOAP fault extraction and reporting
4. **Intelligent Retries**: Only retries transient errors, not auth failures
5. **Maintainable**: WSDL-driven approach means no hardcoded namespaces to update
6. **Reusable**: Can be used for any Oracle Fusion SOAP service
7. **Well-Tested**: Comprehensive unit tests ensure reliability

## Future Enhancements

Possible improvements:
1. Support for WS-Security headers (if Oracle requires)
2. WSDL caching across application restarts (Redis/file cache)
3. Request/response interceptors for debugging
4. Support for streaming large responses
5. Circuit breaker pattern for failing services

## Support

For issues or questions:
1. Check logs for detailed error messages
2. Verify WSDL is accessible: `curl -u username:password "https://your-oracle-url?WSDL"`
3. Test with a simple SOAP operation first
4. Review Oracle Fusion SOAP documentation for service-specific requirements

## License

This code is part of the CRM Inventory & Miscellaneous Receipt Management System.
