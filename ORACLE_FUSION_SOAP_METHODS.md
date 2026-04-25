# Oracle Fusion SOAP Methods Discovery Guide

## Overview

This document helps you discover and understand available SOAP methods in Oracle Fusion Cloud.

## Quick Discovery Script

We've created a script to automatically discover all available methods from Oracle Fusion WSDL:

```bash
cd backend
node scripts/discover-methods.js
```

For detailed information:
```bash
node scripts/discover-methods.js --verbose
```

## Common Oracle Fusion SOAP Services

### 1. MiscellaneousReceiptService

**Endpoint Pattern:**
```
https://{instance}.fa.em2.oraclecloud.com/fscmService/MiscellaneousReceiptService
```

**Common Operations:**
- `createMiscellaneousReceipt` - Create miscellaneous receipts
- `getMiscellaneousReceipt` - Retrieve miscellaneous receipt details
- `updateMiscellaneousReceipt` - Update existing receipts
- `deleteMiscellaneousReceipt` - Delete receipts
- `findMiscellaneousReceipt` - Search for receipts

**Current Implementation:** ✅ `createMiscellaneousReceipt`

### 2. StandardReceiptService

**Endpoint Pattern:**
```
https://{instance}.fa.em2.oraclecloud.com/fscmService/StandardReceiptService
```

**Common Operations:**
- `createStandardReceipt` - Create standard receipts
- `getStandardReceipt` - Retrieve receipt details
- `updateStandardReceipt` - Update receipts
- `applyReceipt` - Apply receipt to invoice
- `unapplyReceipt` - Unapply receipt from invoice

**Current Implementation:** ✅ `applyReceipt`

### 3. ReceivablesInvoiceService

**Endpoint Pattern:**
```
https://{instance}.fa.em2.oraclecloud.com/fscmService/ReceivablesInvoiceService
```

**Common Operations:**
- `createInvoice` - Create new invoices
- `getInvoice` - Retrieve invoice details
- `updateInvoice` - Update invoices
- `deleteInvoice` - Delete invoices
- `findInvoice` - Search for invoices

## How to Discover Methods from Your Environment

### Method 1: Using Our Script

1. Ensure your `.env` file has the correct Oracle credentials:
   ```env
   ORACLE_USERNAME=your.username@company.com
   ORACLE_PASSWORD=your_password
   ORACLE_SOAP_URL=https://your-instance.oraclecloud.com/fscmService/MiscellaneousReceiptService
   ```

2. Run the discovery script:
   ```bash
   cd backend
   node scripts/discover-methods.js
   ```

3. Output will show:
   - All available namespaces
   - All discovered operations/methods
   - SOAPAction for each method
   - Binding style (document/rpc)

### Method 2: Manual WSDL Inspection

1. Access the WSDL URL in your browser:
   ```
   https://your-instance.oraclecloud.com/fscmService/ServiceName?WSDL
   ```

2. You'll be prompted for credentials (use your Oracle username/password)

3. Look for `<wsdl:operation>` elements in the WSDL

4. Example WSDL structure:
   ```xml
   <wsdl:binding name="ServiceBinding" type="tns:ServicePortType">
     <wsdl:operation name="createMiscellaneousReceipt">
       <soap:operation soapAction="createMiscellaneousReceipt"/>
       ...
     </wsdl:operation>
   </wsdl:binding>
   ```

### Method 3: Oracle Documentation

Visit Oracle's official documentation:
- [Oracle Fusion Cloud Applications API Reference](https://docs.oracle.com/en/cloud/saas/financials/r13-update17a/index.html)
- Search for "{ServiceName} Service" in the documentation

## Understanding SOAP Operation Structure

Each Oracle Fusion SOAP operation follows this pattern:

### Request Structure
```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://xmlns.oracle.com/.../types/"
  xmlns:com="http://xmlns.oracle.com/.../commonService/">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:operationName>
      <com:ObjectType>
        <com:Field1>value1</com:Field1>
        <com:Field2>value2</com:Field2>
      </com:ObjectType>
    </typ:operationName>
  </soapenv:Body>
</soapenv:Envelope>
```

### Key Points:
1. **Operation element** uses `typ:` (types namespace)
2. **Data structures** use `com:` (common/service namespace)
3. **Field names** are PascalCase (e.g., `ReceiptNumber`, not `receiptNumber`)
4. **SOAPAction header** typically matches the operation name

## Testing a New Method

Once you discover a method, test it:

1. **Create a test script** (e.g., `scripts/test-new-method.js`):
   ```javascript
   const { createOracleSoapClient } = require('../src/services/OracleSoapClient');

   async function testMethod() {
     const client = createOracleSoapClient(
       process.env.ORACLE_SOAP_URL,
       `${process.env.ORACLE_SOAP_URL}?WSDL`
     );

     const soapXml = `<?xml version="1.0" encoding="UTF-8"?>
       <soapenv:Envelope ...>
         <!-- Your SOAP request -->
       </soapenv:Envelope>`;

     const response = await client.callWithCustomEnvelope(
       soapXml,
       'methodName'
     );

     console.log('Response:', response);
   }

   testMethod();
   ```

2. **Enable debug mode** in `.env`:
   ```env
   SOAP_DEBUG=true
   ```

3. **Run the test:**
   ```bash
   node scripts/test-new-method.js
   ```

## Common Issues and Solutions

### Issue: "Unknown method" Error

**Cause:** SOAPAction header doesn't match the method name or operation element uses wrong namespace

**Solution:**
1. Verify SOAPAction matches exactly: `SOAPAction: "methodName"`
2. Ensure operation element uses `typ:` namespace
3. Check the WSDL for exact operation name (case-sensitive)

### Issue: "Invalid Parameter" Error

**Cause:** Required fields missing or incorrect field names

**Solution:**
1. Check Oracle documentation for required fields
2. Verify field names are PascalCase
3. Ensure all namespaces are correctly declared

### Issue: Authentication Error

**Cause:** Incorrect credentials or insufficient permissions

**Solution:**
1. Verify credentials can log into Oracle Cloud portal
2. Check user has appropriate roles/privileges
3. Ensure password doesn't have special characters causing issues

## Adding a New Method to the Application

To add support for a new Oracle Fusion SOAP method:

1. **Discover the method** using the script above

2. **Create a new controller** or add to existing one:
   ```javascript
   // backend/src/controllers/newFeatureController.js

   function generateSoapEnvelope(data) {
     return `<?xml version="1.0" encoding="UTF-8"?>
       <soapenv:Envelope ...>
         <soapenv:Body>
           <typ:newMethodName>
             <com:ObjectType>
               <!-- Fields here -->
             </com:ObjectType>
           </typ:newMethodName>
         </soapenv:Body>
       </soapenv:Envelope>`;
   }

   async function callNewMethod(req, res) {
     const soapXml = generateSoapEnvelope(req.body);
     const client = createOracleSoapClient(
       process.env.NEW_METHOD_SOAP_URL
     );

     const response = await client.callWithCustomEnvelope(
       soapXml,
       'newMethodName'
     );

     res.json({ success: true, data: response.parsed });
   }
   ```

3. **Add route** in `backend/src/routes/`:
   ```javascript
   router.post('/new-feature', authenticateToken, callNewMethod);
   ```

4. **Add tests** in `backend/src/__tests__/`:
   ```javascript
   describe('New Method', () => {
     test('should generate correct SOAP envelope', () => {
       // Test XML generation
     });
   });
   ```

5. **Update documentation** with the new method details

## Current Implementation Status

| Service | Method | Status | Location |
|---------|--------|--------|----------|
| MiscellaneousReceiptService | createMiscellaneousReceipt | ✅ Implemented | `miscReceiptController.js` |
| StandardReceiptService | applyReceipt | ✅ Implemented | `applyReceiptController.js` |

## Next Steps

1. Run `node scripts/discover-methods.js` from your local environment
2. Document the discovered methods in this file
3. Implement any additional methods needed for your use case
4. Add tests for new implementations

## Additional Resources

- [Oracle Fusion Cloud Financials API Documentation](https://docs.oracle.com/en/cloud/saas/financials/)
- [SOAP Web Services Developer Guide](https://docs.oracle.com/en/cloud/saas/financials/r13-update17a/fafrw/overview.html)
- [Oracle Integration Cloud Best Practices](https://docs.oracle.com/en/cloud/paas/integration-cloud/)

---

**Last Updated:** 2026-04-25
**Author:** Development Team
**Status:** Active Development
