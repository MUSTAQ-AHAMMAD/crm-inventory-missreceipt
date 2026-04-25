#!/usr/bin/env node
/**
 * Test Single Receipt Creation
 *
 * This script tests creating a single miscellaneous receipt
 * with detailed logging to help diagnose SOAP issues.
 *
 * Usage:
 *   node scripts/test-single-receipt.js
 */

require('dotenv').config();
const { createOracleSoapClient } = require('../src/services/OracleSoapClient');

// SOAP namespaces
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP_TYPES_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/types/';
const SOAP_COMMON_NS = 'http://xmlns.oracle.com/apps/financials/receivables/receipts/shared/miscellaneousReceiptService/commonService/';

function escapeXml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSoapEnvelope(data) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:typ="${SOAP_TYPES_NS}" xmlns:com="${SOAP_COMMON_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <typ:createMiscellaneousReceipt>
      <com:MiscellaneousReceipt>
        <com:Amount>${escapeXml(data.Amount)}</com:Amount>
        <com:CurrencyCode>${escapeXml(data.CurrencyCode)}</com:CurrencyCode>
        <com:ReceiptNumber>${escapeXml(data.ReceiptNumber)}</com:ReceiptNumber>
        <com:ReceiptDate>${escapeXml(data.ReceiptDate)}</com:ReceiptDate>
        <com:DepositDate>${escapeXml(data.DepositDate)}</com:DepositDate>
        <com:GlDate>${escapeXml(data.GlDate)}</com:GlDate>
        <com:ReceivableActivityName>${escapeXml(data.ReceivableActivityName)}</com:ReceivableActivityName>
        <com:BankAccountNumber>${escapeXml(data.BankAccountNumber)}</com:BankAccountNumber>
        <com:OrgId>${escapeXml(data.OrgId)}</com:OrgId>
      </com:MiscellaneousReceipt>
    </typ:createMiscellaneousReceipt>
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function testSingleReceipt() {
  console.log('═'.repeat(70));
  console.log('  Test Single Miscellaneous Receipt Creation');
  console.log('═'.repeat(70));
  console.log();

  // Check environment
  if (!process.env.ORACLE_SOAP_URL) {
    console.error('❌ ORACLE_SOAP_URL not set in .env');
    process.exit(1);
  }

  if (!process.env.ORACLE_USERNAME || !process.env.ORACLE_PASSWORD) {
    console.error('❌ Oracle credentials not set in .env');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`  Endpoint: ${process.env.ORACLE_SOAP_URL}`);
  console.log(`  Username: ${process.env.ORACLE_USERNAME}`);
  console.log(`  Debug Mode: ${process.env.SOAP_DEBUG === 'true' ? 'ENABLED' : 'DISABLED'}`);
  console.log();

  // Test data
  const testReceipt = {
    Amount: '-100.00',
    CurrencyCode: 'SAR',
    ReceiptNumber: `TEST-${Date.now()}`,
    ReceiptDate: '2024-01-20',
    DepositDate: '2024-01-20',
    GlDate: '2024-01-20',
    ReceivableActivityName: 'Test Activity',
    BankAccountNumber: '123456789',
    OrgId: '101',
  };

  console.log('Test Data:');
  console.log(JSON.stringify(testReceipt, null, 2));
  console.log();

  // Generate SOAP envelope
  console.log('Generating SOAP envelope...');
  const soapXml = generateSoapEnvelope(testReceipt);

  console.log('─'.repeat(70));
  console.log('SOAP Envelope:');
  console.log('─'.repeat(70));
  console.log(soapXml);
  console.log('─'.repeat(70));
  console.log();

  // Create SOAP client
  console.log('Creating SOAP client...');
  const client = createOracleSoapClient(process.env.ORACLE_SOAP_URL);

  // Enable debug mode for this test
  client.debugMode = true;
  console.log('✅ SOAP client created (debug mode enabled)');
  console.log();

  // Send request
  console.log('Sending SOAP request to Oracle...');
  console.log();

  try {
    const response = await client.callWithCustomEnvelope(
      soapXml,
      'createMiscellaneousReceipt'
    );

    console.log();
    console.log('═'.repeat(70));
    console.log('✅ SUCCESS');
    console.log('═'.repeat(70));
    console.log(`HTTP Status: ${response.status}`);
    console.log(`Request ID: ${response.requestId}`);
    console.log(`Elapsed Time: ${response.elapsed}ms`);
    console.log();
    console.log('Response Data:');
    console.log(JSON.stringify(response.parsed, null, 2));
    console.log();

  } catch (error) {
    console.log();
    console.log('═'.repeat(70));
    console.log('❌ FAILED');
    console.log('═'.repeat(70));
    console.log(`Error: ${error.message}`);
    console.log();

    if (error.response) {
      console.log('HTTP Response Details:');
      console.log(`  Status: ${error.response.status}`);
      console.log(`  Status Text: ${error.response.statusText}`);
      console.log();
    }

    console.log('Troubleshooting:');
    console.log('  1. Check if the SOAP fault message indicates the issue');
    console.log('  2. Verify all required fields are present');
    console.log('  3. Check namespace URIs match Oracle WSDL exactly');
    console.log('  4. Ensure field names use correct PascalCase');
    console.log('  5. Verify SOAPAction header matches operation name');
    console.log();

    process.exit(1);
  }
}

// Run test
testSingleReceipt().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
