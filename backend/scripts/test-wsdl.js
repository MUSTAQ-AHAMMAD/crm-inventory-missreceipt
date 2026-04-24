#!/usr/bin/env node
/**
 * WSDL Connectivity Test Script
 *
 * Tests Oracle SOAP endpoint connectivity and WSDL accessibility.
 * Run this script to verify your Oracle credentials and WSDL availability.
 *
 * Usage:
 *   node scripts/test-wsdl.js
 */

require('dotenv').config();
const OracleSoapClient = require('../src/services/OracleSoapClient');

async function testWsdlConnectivity() {
  console.log('='.repeat(60));
  console.log('Oracle SOAP WSDL Connectivity Test');
  console.log('='.repeat(60));
  console.log();

  // Check environment variables
  console.log('1. Checking environment variables...');
  const requiredVars = ['ORACLE_SOAP_URL', 'ORACLE_USERNAME', 'ORACLE_PASSWORD'];
  const missing = requiredVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    console.error('❌ Missing environment variables:', missing.join(', '));
    console.log('Please set these in your .env file');
    process.exit(1);
  }
  console.log('✅ All required environment variables are set');
  console.log();

  // Display configuration (masked password)
  console.log('2. Configuration:');
  console.log(`   Service URL: ${process.env.ORACLE_SOAP_URL}`);
  console.log(`   WSDL URL: ${process.env.ORACLE_SOAP_URL}?WSDL`);
  console.log(`   Username: ${process.env.ORACLE_USERNAME}`);
  console.log(`   Password: ${'*'.repeat(process.env.ORACLE_PASSWORD.length)}`);
  console.log();

  // Create SOAP client
  console.log('3. Creating SOAP client...');
  const client = new OracleSoapClient({
    wsdlUrl: `${process.env.ORACLE_SOAP_URL}?WSDL`,
    serviceUrl: process.env.ORACLE_SOAP_URL,
    username: process.env.ORACLE_USERNAME,
    password: process.env.ORACLE_PASSWORD,
    maxRetries: 1,
    retryMinTimeout: 1000,
    retryMaxTimeout: 5000,
    requestTimeout: 15000,
  });
  console.log('✅ SOAP client created');
  console.log();

  // Test WSDL loading
  console.log('4. Loading and parsing WSDL...');
  try {
    await client.loadWsdl();
    console.log('✅ WSDL loaded successfully');
    console.log();

    // Display discovered metadata
    console.log('5. WSDL Metadata:');
    console.log('   Namespaces discovered:');
    for (const [prefix, uri] of Object.entries(client.namespaces)) {
      console.log(`     - ${prefix}: ${uri}`);
    }
    console.log();

    console.log('   Operations discovered:');
    if (Object.keys(client.operations).length === 0) {
      console.log('     (none found - this may indicate a parsing issue)');
    } else {
      for (const [name, details] of Object.entries(client.operations)) {
        console.log(`     - ${name}`);
        console.log(`       SOAPAction: ${details.soapAction || '(none)'}`);
        console.log(`       Style: ${details.style || 'document'}`);
      }
    }
    console.log();

    // Test building SOAP envelope
    console.log('6. Testing SOAP envelope generation...');
    const testParams = {
      miscellaneousReceipt: {
        Amount: '-100.00',
        CurrencyCode: 'SAR',
        ReceiptNumber: 'TEST001',
        ReceiptDate: '2024-01-20',
        DepositDate: '2024-01-20',
        GlDate: '2024-01-20',
        ReceivableActivityName: 'Test Activity',
        BankAccountNumber: '123456789',
        OrgId: '101',
      },
    };

    const envelope = client.buildSoapEnvelope('createMiscellaneousReceipt', testParams);
    console.log('✅ SOAP envelope generated successfully');
    console.log('   Sample envelope (first 500 chars):');
    console.log('   ' + envelope.substring(0, 500).replace(/\n/g, '\n   '));
    console.log();

    // Summary
    console.log('='.repeat(60));
    console.log('✅ ALL TESTS PASSED');
    console.log('='.repeat(60));
    console.log();
    console.log('Your Oracle SOAP endpoint is properly configured!');
    console.log('The application should now work without "Unknown method" errors.');
    console.log();
    console.log('Next steps:');
    console.log('  1. Start the application: npm start');
    console.log('  2. Upload a test CSV file');
    console.log('  3. Monitor logs for successful SOAP requests');
    console.log();

  } catch (error) {
    console.error('❌ WSDL loading failed');
    console.error();
    console.error('Error details:');
    console.error(`  ${error.message}`);
    console.error();
    console.error('Common causes:');
    console.error('  1. Incorrect credentials (check ORACLE_USERNAME and ORACLE_PASSWORD)');
    console.error('  2. Network connectivity issues');
    console.error('  3. Incorrect ORACLE_SOAP_URL');
    console.error('  4. Oracle service is down or unreachable');
    console.error('  5. Firewall blocking access to Oracle Cloud');
    console.error();
    console.error('Troubleshooting:');
    console.error('  1. Test the WSDL URL in a browser (will prompt for credentials):');
    console.error(`     ${process.env.ORACLE_SOAP_URL}?WSDL`);
    console.error('  2. Verify credentials can access Oracle Cloud portal');
    console.error('  3. Check firewall/proxy settings');
    console.error('  4. Try with curl:');
    console.error(`     curl -u "${process.env.ORACLE_USERNAME}:PASSWORD" "${process.env.ORACLE_SOAP_URL}?WSDL"`);
    console.error();
    process.exit(1);
  }
}

// Run the test
testWsdlConnectivity().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
