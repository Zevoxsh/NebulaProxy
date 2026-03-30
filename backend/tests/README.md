# NebulaProxy Backend Tests

## 🧪 Test Suite Overview

This directory contains critical security and functionality tests for the NebulaProxy backend.

**Current Coverage**: 26 tests across 2 modules
- **Authentication Tests** (`auth.test.js`): 10 tests
- **Domain Security Tests** (`domains.test.js`): 16 tests

## 📦 Installation

Before running tests, install the test dependencies:

```bash
cd backend
npm install
```

This will install:
- `vitest` - Fast unit test framework
- `@vitest/coverage-v8` - Code coverage reporting

## 🚀 Running Tests

### Run all tests (once)
```bash
npm test
```

### Run tests in watch mode (auto-rerun on changes)
```bash
npm run test:watch
```

### Run tests with coverage report
```bash
npm run test:coverage
```

Coverage reports will be generated in `backend/coverage/`:
- **HTML report**: `coverage/index.html` (open in browser)
- **JSON report**: `coverage/coverage-final.json`
- **Console summary**: Displayed after test run

## 📋 Test Categories

### 1. Authentication Tests (`auth.test.js`)

**Security Tests**:
- ✅ Schema validation (missing fields, invalid formats)
- ✅ Input length limits (username max 255, password max 1024)
- ✅ Pattern validation (alphanumeric + allowed chars only)
- ✅ Additional properties protection (prototype pollution)
- ✅ Rate limiting (5 attempts per minute)
- ✅ LDAP authentication failure handling

**Coverage**:
- POST /auth/login validation
- JWT token generation
- Cookie-based authentication

### 2. Domain Security Tests (`domains.test.js`)

**SSRF Protection Tests**:
- ✅ Blocks localhost (127.0.0.1, localhost)
- ✅ Blocks private IP ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
- ✅ Blocks metadata endpoints (169.254.169.254)
- ✅ Blocks internal services

**Command Injection Tests**:
- ✅ Rejects shell metacharacters (&, |, ;, &&, ||)
- ✅ Prevents command chaining in hostname
- ✅ Sanitizes all user inputs before spawn()

**Input Validation Tests**:
- ✅ Required field validation
- ✅ Length limits (hostname max 255, backendUrl max 2048)
- ✅ Format validation (DNS names, URLs)
- ✅ Additional properties protection
- ✅ Parameter validation (numeric IDs only)
- ✅ SQL injection prevention

**Coverage**:
- POST /domains (domain creation)
- PUT /domains/:id (domain update)
- Authentication requirements

## 🎯 What Is Tested

### Security Vulnerabilities

| Vulnerability | Status | Tests |
|--------------|--------|-------|
| Command Injection | ✅ Covered | 3 tests |
| SSRF | ✅ Covered | 5 tests |
| SQL Injection | ✅ Covered | 2 tests |
| XSS / Input Validation | ✅ Covered | 6 tests |
| Prototype Pollution | ✅ Covered | 2 tests |
| Rate Limiting Bypass | ✅ Covered | 1 test |
| Authentication Bypass | ✅ Covered | 2 tests |

### JSON Schema Validation

All tests verify that the enhanced JSON schemas correctly:
- Reject malformed inputs
- Enforce length constraints
- Validate patterns (regex)
- Block additional properties
- Require mandatory fields

## 📊 Expected Test Results

All 26 tests should **PASS** after:
1. Installing vitest dependencies
2. Ensuring LDAP is configured (tests will fail LDAP auth as expected)
3. Valid JWT_SECRET is set in `.env`

**Note**: Some tests intentionally trigger errors (401, 400) to verify security controls are working.

## 🔧 Troubleshooting

### Tests fail with "JWT_SECRET required"
**Solution**: Ensure `backend/.env` contains a valid JWT_SECRET:
```bash
JWT_SECRET=your-64-character-secret-here
```

### Tests fail with LDAP connection errors
**Expected behavior**: Tests verify that invalid credentials are rejected. LDAP connection failures are handled gracefully in tests.

### Coverage reports missing
**Solution**: Run with coverage flag:
```bash
npm run test:coverage
```

## 🚧 Future Test Additions

Recommended additional tests (not yet implemented):
- [ ] Team creation and permissions
- [ ] SSL certificate upload validation
- [ ] Admin quota updates
- [ ] Custom header creation
- [ ] Webhook notification validation
- [ ] ProxyManager lifecycle tests
- [ ] Database service tests
- [ ] Integration tests (end-to-end flows)

## 📝 Writing New Tests

To add new tests, create a new file in `tests/` folder:

```javascript
import { test, describe, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

describe('My Feature', () => {
  let app;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    // Setup routes, plugins...
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('should do something', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/my-route'
    });

    expect(response.statusCode).toBe(200);
  });
});
```

## ✅ Test Checklist

Before committing code, ensure:
- [ ] All tests pass: `npm test`
- [ ] Coverage maintained: `npm run test:coverage` (aim for >70%)
- [ ] New features have corresponding tests
- [ ] Security fixes include regression tests

---

**Generated as part of the security audit - 2025**
