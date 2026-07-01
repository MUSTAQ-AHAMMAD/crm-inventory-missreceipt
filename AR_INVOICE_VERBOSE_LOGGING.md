# AR Invoice Verbose Logging Guide

## Overview
When troubleshooting AR invoice SOAP API failures, enable verbose logging to capture complete request/response details that would otherwise be truncated.

## Enabling Verbose Logging

Set the following environment variable in your `.env` file:

```bash
AR_INVOICE_VERBOSE_LOGGING=true
```

**Alternative:** You can also use `SOAP_DEBUG=true` which enables verbose logging across all SOAP operations.

## What Gets Logged

When `AR_INVOICE_VERBOSE_LOGGING=true`, the system logs comprehensive details for each invoice submission:

### 1. Invoice Payload (arPipelineController)
```
[Pipeline][Batch#X] [Y/Z][Upload#N] ═══ INVOICE PAYLOAD START ═══
{
  "BillToCustomerName": "...",
  "BillToCustomerNumber": "...",
  "receivablesInvoiceLines": [...]
}
[Pipeline][Batch#X] [Y/Z][Upload#N] ═══ INVOICE PAYLOAD END ═══
```

### 2. SOAP Envelope (arPipelineController)
The complete SOAP XML envelope being sent to Oracle:
```
[Pipeline][Batch#X] [Y/Z][Upload#N] ═══ SOAP ENVELOPE START ═══
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="..." xmlns:typ="..." xmlns:inv="..." xmlns:adf="...">
  ...
</soapenv:Envelope>
[Pipeline][Batch#X] [Y/Z][Upload#N] ═══ SOAP ENVELOPE END ═══
```

### 3. Full Request XML (OracleSoapClient)
```
[OracleSoapClient] REQ-xxx ═══ FULL REQUEST XML START ═══
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope>
  ...
</soapenv:Envelope>
[OracleSoapClient] REQ-xxx ═══ FULL REQUEST XML END ═══
```

### 4. Full Response XML (OracleSoapClient)
The complete, untruncated SOAP response from Oracle:
```
[OracleSoapClient] REQ-xxx ═══ FULL RESPONSE XML START ═══
<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="...">
  <env:Body>
    <ns2:createSimpleInvoiceResponse>
      <result>
        <TrxNumber>12345</TrxNumber>
        ...
      </result>
    </ns2:createSimpleInvoiceResponse>
  </env:Body>
</env:Envelope>
[OracleSoapClient] REQ-xxx ═══ FULL RESPONSE XML END ═══
```

### 5. Parsed Response Structure (arPipelineController)
The JavaScript object structure after XML parsing:
```
[Pipeline][Batch#X] [Y/Z][Upload#N] ═══ PARSED RESPONSE STRUCTURE START ═══
{
  "soapenv:Envelope": {
    "soapenv:Body": {
      "ns2:createSimpleInvoiceResponse": {
        "result": {
          "TrxNumber": "12345",
          ...
        }
      }
    }
  }
}
[Pipeline][Batch#X] [Y/Z][Upload#N] ═══ PARSED RESPONSE STRUCTURE END ═══
```

### 6. Extracted Invoice Data (arPipelineController)
The specific fields extracted from the response:
```
[Pipeline][Batch#X] [Y/Z][Upload#N] ═══ EXTRACTED INVOICE DATA START ═══
{
  "TransactionNumber": "12345",
  "CustomerTrxId": "67890",
  "BillToCustomerName": "...",
  ...
}
[Pipeline][Batch#X] [Y/Z][Upload#N] ═══ EXTRACTED INVOICE DATA END ═══
```

### 7. Full Oracle Response on Failures
When Oracle returns HTTP 200 but no TransactionNumber:
```
❌ [Pipeline][Batch#X] [Y/Z][Upload#N] FAILED (1234ms) HTTP 200 - Oracle returned HTTP 200 but no TransactionNumber
❌ [Pipeline][Batch#X] [Y/Z][Upload#N] Oracle error: <extracted error message>
❌ [Pipeline][Batch#X] [Y/Z][Upload#N] ═══ FULL ORACLE RESPONSE START ═══
<complete XML response>
❌ [Pipeline][Batch#X] [Y/Z][Upload#N] ═══ FULL ORACLE RESPONSE END ═══
```

## Common Use Cases

### Diagnosing "No TransactionNumber" Errors

When you see:
```
❌ Oracle returned HTTP 200 but no TransactionNumber — possible duplicate CrossReference or oversized payload
```

Enable verbose logging and look for:

1. **SOAP Faults in Response**: Check the `FULL ORACLE RESPONSE` for `<faultstring>` elements
2. **Validation Errors**: Oracle may return success HTTP status but include error details in the response body
3. **Missing Fields**: Compare the `EXTRACTED INVOICE DATA` against what was sent
4. **Duplicate CrossReference**: Check if the CrossReference value already exists in Oracle
5. **Invalid Field Values**: Review the `SOAP ENVELOPE` for data that Oracle might reject (e.g., invalid customer numbers, invalid item codes)

### Debugging XML Structure Issues

If Oracle is rejecting your requests:

1. Check the `SOAP ENVELOPE` section to verify:
   - Correct namespace prefixes (`inv:createSimpleInvoice`, not `typ:createSimpleInvoice`)
   - Proper element nesting (`inv:invoiceHeader`, not `typ:invoice`)
   - Required fields are present
   - Field values match Oracle's expectations

2. Compare against the documented structure in `AR_INVOICE_SOAP_PAYLOAD_FIX.md`

### Performance Analysis

The logs include timing information:
- Request/response duration in milliseconds
- Time from submission to Oracle response

Use this to identify slow requests or timeout issues.

## Security Warning

⚠️ **IMPORTANT**: Verbose logging exposes sensitive data including:
- Customer names and account numbers
- Transaction details
- Invoice line items with pricing
- Oracle credentials in headers (Base64 encoded)

**Only enable verbose logging in development/testing environments**. Never enable in production unless absolutely necessary for troubleshooting, and disable immediately after diagnosing the issue.

## Disabling Verbose Logging

Set the environment variable to `false` or remove it:

```bash
AR_INVOICE_VERBOSE_LOGGING=false
```

Or simply comment it out in your `.env` file:

```bash
# AR_INVOICE_VERBOSE_LOGGING=true
```

Then restart the backend server for changes to take effect.

## Log Analysis Tips

### Finding Specific Invoices

Search for the Upload ID in logs:
```
grep "Upload#123" backend.log
```

### Extracting Full Responses

Use the clear markers to extract complete XML:
```
sed -n '/═══ FULL RESPONSE XML START ═══/,/═══ FULL RESPONSE XML END ═══/p' backend.log
```

### Counting Failures

```
grep "❌.*FAILED.*no TransactionNumber" backend.log | wc -l
```

## Related Documentation

- `AR_INVOICE_SOAP_PAYLOAD_FIX.md` - Correct SOAP payload structure
- `ORACLE_SOAP_INVOICE_STRUCTURE_FIX.md` - XML namespace and structure fixes
- `SOAP_TROUBLESHOOTING.md` - General SOAP debugging guide
- `backend/.env.example` - Environment variable reference

## Date
2026-07-01

## Status
✅ **ACTIVE** - Enhanced logging available for AR invoice debugging
