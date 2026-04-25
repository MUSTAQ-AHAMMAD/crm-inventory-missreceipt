#!/usr/bin/env node
/**
 * Oracle Fusion SOAP Methods Discovery Script
 *
 * This script fetches the WSDL from Oracle Fusion and extracts all available
 * SOAP operations/methods with their details.
 *
 * Usage:
 *   node scripts/discover-methods.js
 *
 * Options:
 *   --service <url>  Override ORACLE_SOAP_URL from .env
 *   --verbose        Show detailed information including input/output messages
 */

require('dotenv').config();
const OracleSoapClient = require('../src/services/OracleSoapClient');
const { XMLParser } = require('fast-xml-parser');

async function discoverMethods() {
  const args = process.argv.slice(2);
  const verboseMode = args.includes('--verbose');
  const serviceIndex = args.indexOf('--service');
  const serviceUrl = serviceIndex !== -1 && args[serviceIndex + 1]
    ? args[serviceIndex + 1]
    : process.env.ORACLE_SOAP_URL;

  console.log('═'.repeat(70));
  console.log('  Oracle Fusion SOAP Operations Discovery');
  console.log('═'.repeat(70));
  console.log();

  if (!serviceUrl) {
    console.error('❌ Error: ORACLE_SOAP_URL not set in .env');
    console.log('Usage: node scripts/discover-methods.js [--service <url>] [--verbose]');
    process.exit(1);
  }

  console.log('Service URL:', serviceUrl);
  console.log('WSDL URL:', `${serviceUrl}?WSDL`);
  console.log();

  try {
    // Create SOAP client
    const client = new OracleSoapClient({
      wsdlUrl: `${serviceUrl}?WSDL`,
      serviceUrl: serviceUrl,
      username: process.env.ORACLE_USERNAME,
      password: process.env.ORACLE_PASSWORD,
      maxRetries: 1,
      requestTimeout: 30000,
    });

    console.log('📥 Fetching and parsing WSDL...');
    const wsdl = await client.loadWsdl();
    console.log('✅ WSDL loaded successfully');
    console.log();

    // Display namespaces
    console.log('─'.repeat(70));
    console.log('📋 DISCOVERED NAMESPACES');
    console.log('─'.repeat(70));
    const namespaces = client.namespaces;
    if (Object.keys(namespaces).length === 0) {
      console.log('  (none found)');
    } else {
      for (const [prefix, uri] of Object.entries(namespaces).sort()) {
        console.log(`  ${prefix.padEnd(15)} : ${uri}`);
      }
    }
    console.log();

    // Display operations
    console.log('─'.repeat(70));
    console.log('🔧 DISCOVERED OPERATIONS (METHODS)');
    console.log('─'.repeat(70));
    const operations = client.operations;

    if (Object.keys(operations).length === 0) {
      console.log('  (none found - this may indicate a parsing issue)');
      console.log();
      console.log('  Attempting manual WSDL parsing...');
      await manualWsdlParsing(wsdl);
    } else {
      console.log();
      let count = 1;
      for (const [name, details] of Object.entries(operations).sort()) {
        console.log(`${count}. ${name}`);
        console.log(`   SOAPAction: ${details.soapAction || '(empty string)'}`);
        console.log(`   Style: ${details.style || 'document'}`);
        console.log();
        count++;
      }

      console.log(`Total: ${Object.keys(operations).length} operation(s) found`);
    }
    console.log();

    // If verbose mode, show more details
    if (verboseMode) {
      console.log('─'.repeat(70));
      console.log('📄 DETAILED WSDL STRUCTURE (Verbose Mode)');
      console.log('─'.repeat(70));

      const definitions = wsdl['wsdl:definitions'] || wsdl.definitions || wsdl;

      // Show port types
      if (definitions['wsdl:portType'] || definitions.portType) {
        console.log('\n🔌 Port Types:');
        const portTypes = definitions['wsdl:portType'] || definitions.portType;
        const portTypeList = Array.isArray(portTypes) ? portTypes : [portTypes];

        portTypeList.forEach(pt => {
          const portTypeName = pt['@_name'];
          console.log(`\n  ${portTypeName}:`);

          const operations = pt['wsdl:operation'] || pt.operation;
          const opList = Array.isArray(operations) ? operations : [operations];

          opList.forEach(op => {
            const opName = op['@_name'];
            console.log(`    - ${opName}`);
            if (op['wsdl:input']) {
              const inputMsg = op['wsdl:input']['@_message'];
              console.log(`      Input: ${inputMsg}`);
            }
            if (op['wsdl:output']) {
              const outputMsg = op['wsdl:output']['@_message'];
              console.log(`      Output: ${outputMsg}`);
            }
          });
        });
      }

      // Show bindings
      if (definitions['wsdl:binding'] || definitions.binding) {
        console.log('\n🔗 Bindings:');
        const bindings = definitions['wsdl:binding'] || definitions.binding;
        const bindingList = Array.isArray(bindings) ? bindings : [bindings];

        bindingList.forEach(binding => {
          const bindingName = binding['@_name'];
          const bindingType = binding['@_type'];
          console.log(`\n  ${bindingName} (type: ${bindingType})`);

          const operations = binding['wsdl:operation'] || binding.operation;
          if (operations) {
            const opList = Array.isArray(operations) ? operations : [operations];
            opList.forEach(op => {
              const opName = op['@_name'];
              const soapOp = op['soap:operation'] || op['soap12:operation'];
              const soapAction = soapOp ? soapOp['@_soapAction'] : null;
              const style = soapOp ? soapOp['@_style'] : null;

              console.log(`    - ${opName}`);
              if (soapAction !== undefined) {
                console.log(`      SOAPAction: "${soapAction}"`);
              }
              if (style) {
                console.log(`      Style: ${style}`);
              }
            });
          }
        });
      }
    }

    console.log();
    console.log('═'.repeat(70));
    console.log('✅ Discovery Complete');
    console.log('═'.repeat(70));
    console.log();
    console.log('Tip: Use --verbose flag for more detailed WSDL information');
    console.log();

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
    console.log('Troubleshooting:');
    console.log('  1. Verify Oracle credentials in .env file');
    console.log('  2. Check network connectivity to Oracle Cloud');
    console.log('  3. Try accessing WSDL URL in browser (will prompt for auth):');
    console.log(`     ${serviceUrl}?WSDL`);
    console.log();
    process.exit(1);
  }
}

async function manualWsdlParsing(wsdl) {
  console.log();
  const definitions = wsdl['wsdl:definitions'] || wsdl.definitions || wsdl;

  // Try to extract operations from binding
  const binding = definitions['wsdl:binding'] || definitions.binding;
  if (binding) {
    const bindings = Array.isArray(binding) ? binding : [binding];

    bindings.forEach(b => {
      const operations = b['wsdl:operation'] || b.operation;
      if (operations) {
        const ops = Array.isArray(operations) ? operations : [operations];

        console.log('  Found operations in binding:');
        ops.forEach((op, idx) => {
          const opName = op['@_name'];
          const soapOp = op['soap:operation'] || op['soap12:operation'];
          const soapAction = soapOp ? soapOp['@_soapAction'] : '';

          console.log(`  ${idx + 1}. ${opName}`);
          console.log(`     SOAPAction: ${soapAction || '(empty)'}`);
        });
      }
    });
  }

  // Try to extract from port type
  const portType = definitions['wsdl:portType'] || definitions.portType;
  if (portType) {
    const portTypes = Array.isArray(portType) ? portType : [portType];

    portTypes.forEach(pt => {
      const operations = pt['wsdl:operation'] || pt.operation;
      if (operations) {
        const ops = Array.isArray(operations) ? operations : [operations];

        console.log('\n  Operations from PortType:');
        ops.forEach((op, idx) => {
          const opName = op['@_name'];
          console.log(`  ${idx + 1}. ${opName}`);
        });
      }
    });
  }
}

// Run discovery
if (require.main === module) {
  discoverMethods().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = { discoverMethods };
