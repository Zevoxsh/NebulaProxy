/**
 * portAllocator — centralized external port allocation service
 *
 * Previously duplicated between routes/admin.js and routes/domains.js.
 * Single source of truth for port availability checks and allocation logic.
 */

import net from 'net';
import dgram from 'dgram';
import { database } from './database.js';

export const MIN_EXTERNAL_PORT = 1;
export const MAX_EXTERNAL_PORT = 65535;

/**
 * Check whether a port is free on the OS level (not already bound by another process).
 * @param {number} port
 * @param {'tcp'|'udp'} protocol
 * @returns {Promise<boolean>}
 */
export const isPortAvailable = (port, protocol) => new Promise((resolve) => {
  if (protocol === 'tcp') {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  } else if (protocol === 'udp') {
    const socket = dgram.createSocket('udp4');
    socket.once('error', () => { socket.close(); resolve(false); });
    socket.once('listening', () => socket.close(() => resolve(true)));
    socket.bind(port, '0.0.0.0');
  } else {
    resolve(false);
  }
});

/**
 * Allocate a random available external port that is:
 * 1. Not already assigned in the database.
 * 2. Not already bound at the OS level.
 *
 * @param {'tcp'|'udp'} protocol
 * @returns {Promise<number>}
 */
export async function allocateAvailablePort(protocol) {
  const maxAttempts = 100;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate =
      Math.floor(Math.random() * (MAX_EXTERNAL_PORT - MIN_EXTERNAL_PORT + 1)) + MIN_EXTERNAL_PORT;
    const assigned = await database.isPortAssigned(candidate, protocol);
    if (assigned) continue;
    const available = await isPortAvailable(candidate, protocol);
    if (available) return candidate;
  }
  throw new Error('Unable to allocate a free external port after 100 attempts');
}

/**
 * Validate that a user-supplied external port is:
 * - In the allowed range
 * - Not already assigned in the database
 * - Not already bound at the OS level
 *
 * Throws an object `{ code, message }` on failure so callers can directly
 * return the appropriate HTTP error.
 *
 * @param {number} port
 * @param {'tcp'|'udp'} protocol
 */
export async function validateExternalPort(port, protocol) {
  if (port < MIN_EXTERNAL_PORT || port > MAX_EXTERNAL_PORT) {
    throw { code: 400, message: `External port must be between ${MIN_EXTERNAL_PORT} and ${MAX_EXTERNAL_PORT}` };
  }
  const assigned = await database.isPortAssigned(port, protocol);
  const available = await isPortAvailable(port, protocol);
  if (assigned || !available) {
    throw { code: 409, message: `Port ${port} is already in use` };
  }
}
