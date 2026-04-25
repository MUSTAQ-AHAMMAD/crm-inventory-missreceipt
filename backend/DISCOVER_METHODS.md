# How to Discover Oracle Fusion SOAP Methods

## Quick Start

From your local machine (where you have access to Oracle Fusion):

```bash
cd backend
npm run discover:methods
```

For detailed information including input/output messages:

```bash
npm run discover:methods:verbose
```

## What This Does

The discovery script will:

1. ✅ Connect to your Oracle Fusion WSDL endpoint
2. ✅ Parse the WSDL document
3. ✅ Extract all available SOAP operations/methods
4. ✅ Show the SOAPAction for each method
5. ✅ Display namespace information
6. ✅ Show binding styles (document/rpc)

## Sample Output

```
══════════════════════════════════════════════════════════════════════
  Oracle Fusion SOAP Operations Discovery
══════════════════════════════════════════════════════════════════════

Service URL: https://your-instance.oraclecloud.com/fscmService/MiscellaneousReceiptService
WSDL URL: https://your-instance.oraclecloud.com/fscmService/MiscellaneousReceiptService?WSDL

📥 Fetching and parsing WSDL...
✅ WSDL loaded successfully

──────────────────────────────────────────────────────────────────────
📋 DISCOVERED NAMESPACES
──────────────────────────────────────────────────────────────────────
  com             : http://xmlns.oracle.com/.../commonService/
  soapenv         : http://schemas.xmlsoap.org/soap/envelope/
  typ             : http://xmlns.oracle.com/.../types/

──────────────────────────────────────────────────────────────────────
🔧 DISCOVERED OPERATIONS (METHODS)
──────────────────────────────────────────────────────────────────────

1. createMiscellaneousReceipt
   SOAPAction: createMiscellaneousReceipt
   Style: document

2. getMiscellaneousReceipt
   SOAPAction: getMiscellaneousReceipt
   Style: document

3. updateMiscellaneousReceipt
   SOAPAction: updateMiscellaneousReceipt
   Style: document

Total: 3 operation(s) found

══════════════════════════════════════════════════════════════════════
✅ Discovery Complete
══════════════════════════════════════════════════════════════════════
```

## Using with Different Services

To check a different Oracle Fusion service:

```bash
node scripts/discover-methods.js --service https://your-instance.oraclecloud.com/fscmService/StandardReceiptService
```

## Prerequisites

1. Oracle Fusion credentials set in `.env`:
   ```env
   ORACLE_USERNAME=your.username@company.com
   ORACLE_PASSWORD=your_password
   ORACLE_SOAP_URL=https://your-instance.oraclecloud.com/fscmService/ServiceName
   ```

2. Network access to Oracle Cloud (VPN if required)

3. Valid credentials with permissions to access the WSDL

## Troubleshooting

### Error: "ENOTFOUND" or Network Error

**Cause:** Cannot reach Oracle Cloud endpoint

**Solutions:**
- Check VPN connection if required
- Verify the ORACLE_SOAP_URL is correct
- Try accessing the WSDL URL in browser
- Check firewall settings

### Error: "401 Unauthorized" or "Authentication Failed"

**Cause:** Invalid credentials

**Solutions:**
- Verify ORACLE_USERNAME and ORACLE_PASSWORD in `.env`
- Test credentials by logging into Oracle Cloud portal
- Check for special characters in password that may need escaping

### Error: "No operations found"

**Cause:** WSDL parsing issue or service doesn't expose operations in standard way

**Solutions:**
- Try with `--verbose` flag to see raw WSDL structure
- Manually inspect WSDL in browser
- Check Oracle documentation for that specific service

## Next Steps

Once you discover the available methods:

1. **Document them** - Add to `ORACLE_FUSION_SOAP_METHODS.md`
2. **Implement in controller** - Create/update controller for the method
3. **Generate SOAP envelope** - Create proper XML structure
4. **Add tests** - Write unit tests for the new method
5. **Test with real data** - Verify with actual Oracle endpoint

## Related Files

- `scripts/discover-methods.js` - Main discovery script
- `scripts/test-wsdl.js` - WSDL connectivity test
- `ORACLE_FUSION_SOAP_METHODS.md` - Comprehensive methods documentation
- `src/services/OracleSoapClient.js` - SOAP client implementation

## Common Oracle Fusion Services

Test these service endpoints (replace `{instance}` with your Oracle instance):

1. **MiscellaneousReceiptService**
   ```
   https://{instance}.oraclecloud.com/fscmService/MiscellaneousReceiptService
   ```

2. **StandardReceiptService**
   ```
   https://{instance}.oraclecloud.com/fscmService/StandardReceiptService
   ```

3. **ReceivablesInvoiceService**
   ```
   https://{instance}.oraclecloud.com/fscmService/ReceivablesInvoiceService
   ```

4. **CustomerAccountService**
   ```
   https://{instance}.oraclecloud.com/fscmService/CustomerAccountService
   ```

---

**Need Help?** Check `ORACLE_FUSION_SOAP_METHODS.md` for detailed documentation and examples.
