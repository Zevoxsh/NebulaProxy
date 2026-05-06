#!/usr/bin/env node
/**
 * Jellyfin Backend Diagnostic Script
 * 
 * Tests connectivity to the Jellyfin backend from the proxy container
 */

const http = require('http');
const https = require('https');

const BACKENDS_TO_TEST = [
  { host: '10.10.0.11', port: 8089, protocol: 'http', name: 'Jellyfin (Correct)' },
  { host: '10.10.0.5', port: 8089, protocol: 'http', name: 'Jellyfin (Old/Wrong)' },
  { host: 'localhost', port: 8096, protocol: 'http', name: 'Jellyfin (Local)' },
  { host: '127.0.0.1', port: 8096, protocol: 'http', name: 'Jellyfin (Loopback)' }
];

const JELLYFIN_ENDPOINTS = [
  '/System/Info/Public',
  '/Branding/Configuration',
  '/QuickConnect/Enabled'
];

function testConnection(backend, endpoint) {
  return new Promise((resolve) => {
    const protocol = backend.protocol === 'https' ? https : http;
    const url = `${backend.protocol}://${backend.host}:${backend.port}${endpoint}`;

    const options = {
      hostname: backend.host,
      port: backend.port,
      path: endpoint,
      method: 'GET',
      timeout: 3000
    };

    const req = protocol.request(options, (res) => {
      resolve({
        backend: backend.name,
        host: backend.host,
        port: backend.port,
        endpoint,
        statusCode: res.statusCode,
        status: '✅ CONNECTED',
        error: null
      });
    });

    req.on('error', (err) => {
      resolve({
        backend: backend.name,
        host: backend.host,
        port: backend.port,
        endpoint,
        statusCode: null,
        status: '❌ FAILED',
        error: err.code || err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        backend: backend.name,
        host: backend.host,
        port: backend.port,
        endpoint,
        statusCode: null,
        status: '⏱️  TIMEOUT',
        error: 'Connection timeout (3s)'
      });
    });

    req.end();
  });
}

async function diagnose() {
  console.log('🔍 Jellyfin Backend Diagnostic\n');
  console.log('Testing connectivity to Jellyfin backends...\n');

  const results = [];

  for (const backend of BACKENDS_TO_TEST) {
    console.log(`Testing ${backend.name} (${backend.host}:${backend.port})...`);

    for (const endpoint of JELLYFIN_ENDPOINTS) {
      const result = await testConnection(backend, endpoint);
      results.push(result);

      const status = result.status;
      const details = result.error ? ` - ${result.error}` : ` (HTTP ${result.statusCode})`;
      console.log(`  ${status} ${endpoint}${details}`);
    }
    console.log('');
  }

  // Summary
  console.log('\n📊 Summary:\n');
  console.log('Backend Status:');
  const correctBackend = results.filter(r => r.host === '10.10.0.11');
  const wrongBackend = results.filter(r => r.host === '10.10.0.5');
  const localBackend = results.filter(r => r.host === 'localhost' || r.host === '127.0.0.1');

  const correctConnected = correctBackend.some(r => r.status === '✅ CONNECTED');
  const wrongConnected = wrongBackend.some(r => r.status === '✅ CONNECTED');
  const localConnected = localBackend.some(r => r.status === '✅ CONNECTED');

  console.log(`  10.10.0.11:8089 (Correct) ... ${correctConnected ? '✅ WORKING' : '❌ NOT RESPONDING'}`);
  console.log(`  10.10.0.5:8089  (Old)     ... ${wrongConnected ? '⚠️  WORKING (but config should point to 10.10.0.11)' : '❌ NOT RESPONDING'}`);
  console.log(`  localhost:8096  (Local)   ... ${localConnected ? '✅ WORKING' : '❌ NOT RESPONDING'}`);

  // Recommendations
  console.log('\n💡 Recommendations:\n');

  if (!correctConnected) {
    console.log('⚠️  Jellyfin is NOT responding on 10.10.0.11:8089');
    console.log('   - Check if Jellyfin is running on this address');
    console.log('   - Check network connectivity');
    console.log('   - Verify firewall rules');
  } else {
    console.log('✅ Jellyfin is responding correctly on 10.10.0.11:8089');
    if (wrongConnected) {
      console.log('⚠️  BUT the old address (10.10.0.5:8089) is also responding');
      console.log('   - Update database to use 10.10.0.11');
      console.log('   - Restart NebulaProxy');
    }
  }

  console.log('\n📝 Next steps:');
  console.log('1. If 10.10.0.11:8089 is working, update the database:');
  console.log('   UPDATE domains SET backend_url = \'10.10.0.11\', backend_port = 8089');
  console.log('   WHERE hostname = \'jellyfin.byakura.ovh\';');
  console.log('');
  console.log('2. Restart NebulaProxy:');
  console.log('   docker-compose restart backend');
  console.log('');
  console.log('3. Test in browser:');
  console.log('   https://jellyfin.byakura.ovh/');
}

diagnose().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
