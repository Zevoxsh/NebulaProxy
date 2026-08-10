import { describe, it, expect, vi } from 'vitest';

describe('External port allocation helpers', () => {
  it('does not treat standard low ports as automatic allocation candidates', async () => {
    const { isReservedExternalPort } = await import('../utils/externalPorts.js');

    expect(isReservedExternalPort(22)).toBe(true);
    expect(isReservedExternalPort(80)).toBe(true);
    expect(isReservedExternalPort(443)).toBe(true);
    expect(isReservedExternalPort(20001)).toBe(false);
  });

  it('starts automatic allocation above the reserved low-port range', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { getRandomExternalPortCandidate } = await import('../utils/externalPorts.js');

    expect(getRandomExternalPortCandidate()).toBe(1024);
    expect(getRandomExternalPortCandidate(20000, 29999)).toBe(20000);

    vi.restoreAllMocks();
  });
});