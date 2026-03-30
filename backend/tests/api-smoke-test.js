#!/usr/bin/env node

/**
 * API Smoke Test
 * Tests all critical API endpoints to ensure the application is working correctly
 * Run this at Docker startup to verify the deployment
 */

import axios from 'axios';
import { config } from '../config/config.js';

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${config.port || 3000}/api`;
const TEST_USERNAME = process.env.TEST_USERNAME || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.ADMIN_PASSWORD || 'admin';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

let testToken = null;
let testApiKey = null;
let testDomainId = null;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;

// Helper functions
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logTest(name, status, details = '') {
  const statusSymbol = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  const statusColor = status === 'PASS' ? colors.green : status === 'FAIL' ? colors.red : colors.yellow;
  const detailsStr = details ? ` - ${details}` : '';
  log(`  ${statusSymbol} ${name}${detailsStr}`, statusColor);

  if (status === 'PASS') passedTests++;
  else if (status === 'FAIL') failedTests++;
  else skippedTests++;
}

function logSection(name) {
  log(`\n${colors.bright}${colors.cyan}━━━ ${name} ━━━${colors.reset}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Wait for API to be ready
async function waitForAPI(maxAttempts = 30) {
  log(`\n${colors.bright}Waiting for API to be ready...${colors.reset}`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      await axios.get(`${API_BASE_URL.replace('/api', '')}/health`, { timeout: 2000 });
      log(`${colors.green}✓ API is ready!${colors.reset}`);
      return true;
    } catch (error) {
      process.stdout.write('.');
      await sleep(2000);
    }
  }

  log(`\n${colors.red}✗ API failed to start within ${maxAttempts * 2}s${colors.reset}`);
  return false;
}

// Test Authentication
async function testAuthentication() {
  logSection('Authentication');

  try {
    // Test login
    const response = await axios.post(`${API_BASE_URL}/auth/login`, {
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    }, { withCredentials: true });

    if (response.data.token) {
      testToken = response.data.token;
      logTest('POST /api/auth/login', 'PASS', 'JWT token received');
    } else {
      logTest('POST /api/auth/login', 'FAIL', 'No token in response');
      return false;
    }

    // Test token verification
    const verifyResponse = await axios.get(`${API_BASE_URL}/auth/verify`, {
      headers: { Authorization: `Bearer ${testToken}` }
    });

    if (verifyResponse.data.valid) {
      logTest('GET /api/auth/verify', 'PASS', `User: ${verifyResponse.data.user.username}`);
    } else {
      logTest('GET /api/auth/verify', 'FAIL', 'Token not valid');
    }

    return true;
  } catch (error) {
    logTest('Authentication', 'FAIL', error.message);
    return false;
  }
}

// Test API Keys
async function testAPIKeys() {
  logSection('API Keys');

  try {
    // Create API key
    const createResponse = await axios.post(`${API_BASE_URL}/api-keys`, {
      name: 'Smoke Test Key',
      description: 'Automated smoke test',
      scopes: ['domains:*', 'teams:*', 'monitoring:read'],
      expiresInDays: 30,
      rateLimitRpm: 100,
      rateLimitRph: 5000
    }, {
      headers: { Authorization: `Bearer ${testToken}` }
    });

    if (createResponse.data.apiKey) {
      testApiKey = createResponse.data.apiKey;
      logTest('POST /api/api-keys', 'PASS', `Key created: ${testApiKey.substring(0, 20)}...`);
    } else {
      logTest('POST /api/api-keys', 'FAIL', 'No API key in response');
      return false;
    }

    // List API keys
    const listResponse = await axios.get(`${API_BASE_URL}/api-keys`, {
      headers: { Authorization: `Bearer ${testToken}` }
    });

    if (Array.isArray(listResponse.data.apiKeys)) {
      logTest('GET /api/api-keys', 'PASS', `${listResponse.data.apiKeys.length} keys found`);
    } else {
      logTest('GET /api/api-keys', 'FAIL', 'Invalid response format');
    }

    // Test API key authentication
    const testResponse = await axios.get(`${API_BASE_URL}/domains`, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('API Key Authentication', 'PASS', 'API key works for authentication');

    // Get usage stats
    const keyId = createResponse.data.keyInfo.id;
    const usageResponse = await axios.get(`${API_BASE_URL}/api-keys/${keyId}/usage`, {
      headers: { Authorization: `Bearer ${testToken}` }
    });

    if (usageResponse.data.stats) {
      logTest('GET /api/api-keys/:id/usage', 'PASS', 'Usage stats retrieved');
    } else {
      logTest('GET /api/api-keys/:id/usage', 'FAIL', 'No stats in response');
    }

    return true;
  } catch (error) {
    logTest('API Keys', 'FAIL', error.response?.data?.message || error.message);
    return false;
  }
}

// Test Domains
async function testDomains() {
  logSection('Domains');

  try {
    // List domains
    const listResponse = await axios.get(`${API_BASE_URL}/domains`, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('GET /api/domains', 'PASS', `${listResponse.data.domains?.length || 0} domains found`);

    // Create domain
    const createResponse = await axios.post(`${API_BASE_URL}/domains`, {
      hostname: `smoke-test-${Date.now()}.local`,
      backend_url: 'http://localhost:8080',
      proxy_type: 'http',
      description: 'Smoke test domain'
    }, {
      headers: { 'X-API-Key': testApiKey }
    });

    if (createResponse.data.domain) {
      testDomainId = createResponse.data.domain.id;
      logTest('POST /api/domains', 'PASS', `Domain created: ${createResponse.data.domain.hostname}`);
    } else {
      logTest('POST /api/domains', 'FAIL', 'No domain in response');
      return false;
    }

    // Get domain
    const getResponse = await axios.get(`${API_BASE_URL}/domains/${testDomainId}`, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('GET /api/domains/:id', 'PASS', `Retrieved domain: ${getResponse.data.hostname}`);

    // Update domain
    const updateResponse = await axios.put(`${API_BASE_URL}/domains/${testDomainId}`, {
      description: 'Updated smoke test domain'
    }, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('PUT /api/domains/:id', 'PASS', 'Domain updated successfully');

    // Toggle domain
    await axios.post(`${API_BASE_URL}/domains/${testDomainId}/toggle`, {}, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('POST /api/domains/:id/toggle', 'PASS', 'Domain toggled');

    return true;
  } catch (error) {
    logTest('Domains', 'FAIL', error.response?.data?.message || error.message);
    return false;
  }
}

// Test Teams
async function testTeams() {
  logSection('Teams');

  try {
    // List teams
    const listResponse = await axios.get(`${API_BASE_URL}/teams`, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('GET /api/teams', 'PASS', `${listResponse.data.teams?.length || 0} teams found`);

    // Create team
    const createResponse = await axios.post(`${API_BASE_URL}/teams`, {
      name: `Smoke Test Team ${Date.now()}`,
      max_domains: 10
    }, {
      headers: { 'X-API-Key': testApiKey }
    });

    if (createResponse.data.team) {
      logTest('POST /api/teams', 'PASS', `Team created: ${createResponse.data.team.name}`);
    } else {
      logTest('POST /api/teams', 'FAIL', 'No team in response');
    }

    return true;
  } catch (error) {
    logTest('Teams', 'FAIL', error.response?.data?.message || error.message);
    return false;
  }
}

// Test SSL
async function testSSL() {
  logSection('SSL Certificates');

  try {
    // Get certificates
    const listResponse = await axios.get(`${API_BASE_URL}/ssl/certificates`, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('GET /api/ssl/certificates', 'PASS', 'SSL certificates listed');

    // Get SSL stats
    const statsResponse = await axios.get(`${API_BASE_URL}/ssl/stats`, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('GET /api/ssl/stats', 'PASS', 'SSL stats retrieved');

    return true;
  } catch (error) {
    logTest('SSL Certificates', 'FAIL', error.response?.data?.message || error.message);
    return false;
  }
}

// Test Monitoring
async function testMonitoring() {
  logSection('Monitoring');

  try {
    // Get health status
    const healthResponse = await axios.get(`${API_BASE_URL}/monitoring`, {
      headers: { 'X-API-Key': testApiKey }
    });

    logTest('GET /api/monitoring', 'PASS', 'Health status retrieved');

    return true;
  } catch (error) {
    logTest('Monitoring', 'FAIL', error.response?.data?.message || error.message);
    return false;
  }
}

// Test Admin Endpoints (if admin)
async function testAdmin() {
  logSection('Admin Endpoints');

  try {
    // Get all users
    const usersResponse = await axios.get(`${API_BASE_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${testToken}` }
    });

    logTest('GET /api/admin/users', 'PASS', `${usersResponse.data.users?.length || 0} users found`);

    // Get stats
    const statsResponse = await axios.get(`${API_BASE_URL}/admin/stats`, {
      headers: { Authorization: `Bearer ${testToken}` }
    });

    logTest('GET /api/admin/stats', 'PASS', `${statsResponse.data.totalDomains || 0} total domains`);

    // List all API keys
    const apiKeysResponse = await axios.get(`${API_BASE_URL}/admin/api-keys`, {
      headers: { Authorization: `Bearer ${testToken}` }
    });

    logTest('GET /api/admin/api-keys', 'PASS', `${apiKeysResponse.data.apiKeys?.length || 0} API keys`);

    return true;
  } catch (error) {
    if (error.response?.status === 403) {
      logTest('Admin Endpoints', 'SKIP', 'Not admin user');
      return true;
    }
    logTest('Admin Endpoints', 'FAIL', error.response?.data?.message || error.message);
    return false;
  }
}

// Cleanup
async function cleanup() {
  logSection('Cleanup');

  try {
    // Delete test domain
    if (testDomainId) {
      await axios.delete(`${API_BASE_URL}/domains/${testDomainId}`, {
        headers: { 'X-API-Key': testApiKey }
      });
      logTest('Delete test domain', 'PASS', 'Cleaned up');
    }

    // Delete test API key
    if (testApiKey) {
      const listResponse = await axios.get(`${API_BASE_URL}/api-keys`, {
        headers: { Authorization: `Bearer ${testToken}` }
      });
      const smokeTestKey = listResponse.data.apiKeys.find(k => k.name === 'Smoke Test Key');
      if (smokeTestKey) {
        await axios.delete(`${API_BASE_URL}/api-keys/${smokeTestKey.id}`, {
          headers: { Authorization: `Bearer ${testToken}` }
        });
        logTest('Delete test API key', 'PASS', 'Cleaned up');
      }
    }
  } catch (error) {
    logTest('Cleanup', 'FAIL', error.message);
  }
}

// Main test runner
async function runTests() {
  const startTime = Date.now();

  log(`\n${colors.bright}${colors.blue}╔═══════════════════════════════════════════════╗${colors.reset}`);
  log(`${colors.bright}${colors.blue}║   NebulaProxy API Smoke Test                 ║${colors.reset}`);
  log(`${colors.bright}${colors.blue}╚═══════════════════════════════════════════════╝${colors.reset}`);
  log(`\nTesting API at: ${colors.cyan}${API_BASE_URL}${colors.reset}`);

  // Wait for API
  const apiReady = await waitForAPI();
  if (!apiReady) {
    log(`\n${colors.red}${colors.bright}✗ SMOKE TEST FAILED${colors.reset}`);
    log(`${colors.red}API is not responding${colors.reset}\n`);
    process.exit(1);
  }

  // Run tests
  await testAuthentication();
  await testAPIKeys();
  await testDomains();
  await testTeams();
  await testSSL();
  await testMonitoring();
  await testAdmin();

  // Cleanup
  await cleanup();

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const total = passedTests + failedTests + skippedTests;

  logSection('Test Summary');
  log(`\n  Total:   ${total} tests`);
  log(`  ${colors.green}Passed:  ${passedTests}${colors.reset}`);
  log(`  ${colors.red}Failed:  ${failedTests}${colors.reset}`);
  log(`  ${colors.yellow}Skipped: ${skippedTests}${colors.reset}`);
  log(`  Duration: ${duration}s\n`);

  if (failedTests > 0) {
    log(`${colors.red}${colors.bright}✗ SMOKE TEST FAILED${colors.reset}\n`);
    process.exit(1);
  } else {
    log(`${colors.green}${colors.bright}✓ ALL TESTS PASSED${colors.reset}\n`);
    process.exit(0);
  }
}

// Run tests
runTests().catch(error => {
  log(`\n${colors.red}${colors.bright}Fatal error:${colors.reset}`, colors.red);
  log(error.message, colors.red);
  process.exit(1);
});
