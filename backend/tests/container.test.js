/**
 * Tests for the service container.
 * This is what makes global.notificationService testable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from '../services/container.js';

beforeEach(() => {
  container.reset();
});

describe('ServiceContainer', () => {
  it('registers and retrieves a service', () => {
    const svc = { send: () => 'ok' };
    container.set('notifications', svc);
    expect(container.get('notifications')).toBe(svc);
  });

  it('throws a clear error for unregistered services', () => {
    expect(() => container.get('missing')).toThrow(/not registered/);
  });

  it('has() returns false before registration', () => {
    expect(container.has('notifications')).toBe(false);
  });

  it('has() returns true after registration', () => {
    container.set('notifications', {});
    expect(container.has('notifications')).toBe(true);
  });

  it('unset() removes a service', () => {
    container.set('notifications', {});
    container.unset('notifications');
    expect(container.has('notifications')).toBe(false);
  });

  it('allows replacing a service (useful in tests)', () => {
    const real = { name: 'real' };
    const mock = { name: 'mock' };
    container.set('notifications', real);
    container.set('notifications', mock);
    expect(container.get('notifications').name).toBe('mock');
  });

  it('reset() clears all services', () => {
    container.set('a', {});
    container.set('b', {});
    container.reset();
    expect(container.has('a')).toBe(false);
    expect(container.has('b')).toBe(false);
  });
});
