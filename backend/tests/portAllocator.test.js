import { describe, it, expect, vi, beforeEach } from 'vitest';

const isPortRangeAssignedMock = vi.fn();

vi.mock('../services/database.js', () => ({
  database: {
    isPortAssigned: vi.fn().mockResolvedValue(false),
    isPortRangeAssigned: isPortRangeAssignedMock
  }
}));

const { validateExternalPortRange, MAX_PORT_RANGE_SIZE } = await import('../services/portAllocator.js');

describe('validateExternalPortRange', () => {
  beforeEach(() => {
    isPortRangeAssignedMock.mockReset();
    isPortRangeAssignedMock.mockResolvedValue(false);
  });

  it('rejects a range whose end is before its start', async () => {
    await expect(validateExternalPortRange(50200, 50100, 'tcp')).rejects.toMatchObject({ code: 400 });
  });

  it('rejects a range spanning more ports than the configured cap', async () => {
    const start = 20000;
    const end = start + MAX_PORT_RANGE_SIZE; // one more than allowed
    await expect(validateExternalPortRange(start, end, 'tcp')).rejects.toMatchObject({ code: 400 });
  });

  it('rejects a range that overlaps an existing domain', async () => {
    isPortRangeAssignedMock.mockResolvedValueOnce(true);
    await expect(validateExternalPortRange(59100, 59105, 'tcp')).rejects.toMatchObject({ code: 409 });
    expect(isPortRangeAssignedMock).toHaveBeenCalledWith(59100, 59105, 'tcp', null);
  });

  it('accepts a small free range on high ports and checks every port in it', async () => {
    await expect(validateExternalPortRange(59110, 59113, 'udp')).resolves.toBeUndefined();
  });

  it('passes excludeDomainId through to the overlap check', async () => {
    await validateExternalPortRange(59120, 59121, 'tcp', { excludeDomainId: 42 });
    expect(isPortRangeAssignedMock).toHaveBeenCalledWith(59120, 59121, 'tcp', 42);
  });
});
