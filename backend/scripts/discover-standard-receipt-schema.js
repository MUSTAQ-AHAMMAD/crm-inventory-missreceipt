#!/usr/bin/env node
/**
 * One-off: fetch StandardReceiptService WSDL + imported XSDs and print the exact
 * element names of the createStandardReceipt / standardReceipt request type.
 * Read-only. Usage: node scripts/discover-standard-receipt-schema.js
 */
require('dotenv').config();
const axios = require('axios');

const BASE = process.env.ORACLE_STANDARD_RECEIPT_SOAP_URL
  || process.env.ORACLE_APPLY_RECEIPT_SOAP_URL;
const auth = { username: process.env.ORACLE_USERNAME, password: process.env.ORACLE_PASSWORD };

const seen = new Set();
async function get(url) {
  const r = await axios.get(url, { auth, timeout: 60000, responseType: 'text', maxRedirects: 5 });
  return typeof r.data === 'string' ? r.data : String(r.data);
}

// Pull schemaLocation="..." from xsd:import/include
function schemaLocations(xml) {
  const locs = [];
  const re = /schemaLocation\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(xml))) locs.push(m[1]);
  return locs;
}

// For a complexType/element block, list child <xsd:element name="..."> in document order
function listElementsNear(xml, anchorNames) {
  // Find each complexType and dump its element names if it contains an anchor field.
  const out = [];
  const ctRe = /<(?:xsd:|xs:)?complexType\b[^>]*?(?:name="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:xsd:|xs:)?complexType>/g;
  let m;
  while ((m = ctRe.exec(xml))) {
    const name = m[1] || '(anonymous)';
    const body = m[2];
    const els = [];
    const elRe = /<(?:xsd:|xs:)?element\b[^>]*\bname="([^"]+)"[^>]*>/g;
    let e;
    while ((e = elRe.exec(body))) els.push(e[1]);
    if (els.some((x) => anchorNames.includes(x))) {
      out.push({ complexType: name, elements: els });
    }
  }
  return out;
}

(async () => {
  if (!BASE) { console.error('No StandardReceipt SOAP URL in .env'); process.exit(1); }
  console.log('Service:', BASE);
  const wsdlUrl = `${BASE}?WSDL`;
  console.log('Fetching WSDL:', wsdlUrl);
  const wsdl = await get(wsdlUrl);

  // Collect XSD urls (resolve relative to service base like ?XSD=...)
  const toFetch = new Set();
  for (const loc of schemaLocations(wsdl)) {
    const abs = loc.startsWith('http') ? loc : `${BASE}${loc.startsWith('?') ? '' : '/'}${loc}`;
    toFetch.add(abs);
  }
  console.log(`Found ${toFetch.size} schema import(s).`);

  const anchors = ['ReceiptMethodId', 'RemittanceBankAccountId', 'CustomerId',
    'ReceiptMethodName', 'CustomerAccountNumber', 'CustomerAccountId', 'BillToCustomerAccountNumber'];

  const results = [];
  const queue = [...toFetch];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let xsd;
    try { xsd = await get(url); }
    catch (err) { console.log('  skip (fetch failed):', url, '-', err.message); continue; }
    // follow nested imports one more level
    for (const loc of schemaLocations(xsd)) {
      const abs = loc.startsWith('http') ? loc : `${BASE}${loc.startsWith('?') ? '' : '/'}${loc}`;
      if (!seen.has(abs) && seen.size < 40) queue.push(abs);
    }
    const hits = listElementsNear(xsd, anchors);
    if (hits.length) results.push({ url, hits });
  }

  console.log('\n================ MATCHING COMPLEX TYPES ================');
  if (!results.length) console.log('No complexType containing the anchor fields was found.');
  for (const r of results) {
    console.log('\nFrom:', r.url);
    for (const h of r.hits) {
      console.log(`  complexType ${h.complexType} (${h.elements.length} elements):`);
      for (const el of h.elements) console.log('     -', el);
    }
  }
})().catch((e) => { console.error('ERROR:', e.response?.status, e.message); process.exit(1); });
