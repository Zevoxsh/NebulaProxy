/**
 * RBAC middleware — role hierarchy tests.
 * Verifies that operator ≥ user, viewer < user, admin requires PIN.
 */
import { describe, it, expect } from 'vitest';

const ROLE_HIERARCHY = { admin: 4, operator: 3, user: 2, viewer: 1 };

function isAllowed(userRole, requiredRoles) {
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  return requiredRoles.some(required => {
    if (required === 'admin')    return userRole === 'admin';
    if (required === 'operator') return userLevel >= ROLE_HIERARCHY.operator;
    if (required === 'viewer')   return userLevel >= ROLE_HIERARCHY.viewer;
    if (required === 'user')     return userLevel >= ROLE_HIERARCHY.user;
    return false;
  });
}

describe('RBAC role hierarchy', () => {
  it('admin passes any route', () => {
    expect(isAllowed('admin',    ['admin'])).toBe(true);
    expect(isAllowed('admin',    ['user'])).toBe(true);
    expect(isAllowed('admin',    ['viewer'])).toBe(true);
    expect(isAllowed('admin',    ['operator'])).toBe(true);
  });

  it('operator passes user routes but not admin', () => {
    expect(isAllowed('operator', ['user'])).toBe(true);
    expect(isAllowed('operator', ['operator'])).toBe(true);
    expect(isAllowed('operator', ['admin'])).toBe(false);
  });

  it('user passes user routes but not operator/admin', () => {
    expect(isAllowed('user',     ['user'])).toBe(true);
    expect(isAllowed('user',     ['operator'])).toBe(false);
    expect(isAllowed('user',     ['admin'])).toBe(false);
  });

  it('viewer is read-only — passes viewer routes only', () => {
    expect(isAllowed('viewer',   ['viewer'])).toBe(true);
    expect(isAllowed('viewer',   ['user'])).toBe(false);
    expect(isAllowed('viewer',   ['operator'])).toBe(false);
    expect(isAllowed('viewer',   ['admin'])).toBe(false);
  });

  it('unknown role has no access', () => {
    expect(isAllowed('unknown',  ['user'])).toBe(false);
    expect(isAllowed('',         ['viewer'])).toBe(false);
  });
});

describe('Admin PIN expiry logic', () => {
  const PIN_TTL_MS = 4 * 60 * 60 * 1000;

  function isPinValid(adminPinVerified, adminPinVerifiedAt, iat) {
    const verifiedAt = adminPinVerifiedAt ?? (iat ? iat * 1000 : null);
    const expired    = !verifiedAt || (Date.now() - verifiedAt) > PIN_TTL_MS;
    return adminPinVerified === true && !expired;
  }

  it('fresh PIN is valid', () => {
    expect(isPinValid(true, Date.now() - 60_000, null)).toBe(true);
  });

  it('PIN older than 4h is expired', () => {
    expect(isPinValid(true, Date.now() - (5 * 60 * 60 * 1000), null)).toBe(false);
  });

  it('old token without adminPinVerifiedAt falls back to iat', () => {
    const iatFresh = Math.floor((Date.now() - 60_000) / 1000);
    expect(isPinValid(true, undefined, iatFresh)).toBe(true);
  });

  it('old token with iat > 4h ago is expired', () => {
    const iatOld = Math.floor((Date.now() - 5 * 60 * 60 * 1000) / 1000);
    expect(isPinValid(true, undefined, iatOld)).toBe(false);
  });

  it('adminPinVerified=false always fails', () => {
    expect(isPinValid(false, Date.now(), null)).toBe(false);
  });
});
