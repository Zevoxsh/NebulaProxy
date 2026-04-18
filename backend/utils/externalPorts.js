export const MIN_EXTERNAL_PORT = 1;
export const MAX_EXTERNAL_PORT = 65535;
export const AUTOMATIC_EXTERNAL_PORT_MIN = 1024;

export const RESERVED_EXTERNAL_PORT_RANGES = [
  [1, 1023]
];

export function isPortInRange(port, min, max) {
  return Number.isInteger(port) && port >= min && port <= max;
}

export function isReservedExternalPort(port) {
  if (!Number.isInteger(port)) return false;
  return RESERVED_EXTERNAL_PORT_RANGES.some(([min, max]) => isPortInRange(port, min, max));
}

export function getRandomExternalPortCandidate(minPort = AUTOMATIC_EXTERNAL_PORT_MIN, maxPort = MAX_EXTERNAL_PORT) {
  return Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;
}
