/**
 * Minecraft Server List Ping
 *
 * Implements the Minecraft Server List Ping protocol to get server status
 * Used for advanced health checks that verify Minecraft server is actually responding
 *
 * Protocol flow:
 * 1. Send Handshake packet (nextState = 1 for status)
 * 2. Send Status Request packet (0x00 empty)
 * 3. Receive Status Response (JSON with server info)
 * 4. Optional: Send Ping packet and receive Pong
 */

import net from 'net';

/**
 * Write a VarInt to buffer
 * @param {number} value - Integer value to encode
 * @returns {Buffer} Encoded VarInt
 */
function writeVarInt(value) {
  const buffer = [];
  do {
    let byte = value & 0x7F;
    value >>>= 7;
    if (value !== 0) {
      byte |= 0x80;
    }
    buffer.push(byte);
  } while (value !== 0);
  return Buffer.from(buffer);
}

/**
 * Write a string (VarInt length + UTF-8 bytes)
 * @param {string} str - String to encode
 * @returns {Buffer} Encoded string
 */
function writeString(str) {
  const stringBuffer = Buffer.from(str, 'utf8');
  const lengthBuffer = writeVarInt(stringBuffer.length);
  return Buffer.concat([lengthBuffer, stringBuffer]);
}

/**
 * Create Minecraft handshake packet for status request
 * @param {string} hostname - Server hostname
 * @param {number} port - Server port
 * @returns {Buffer} Handshake packet
 */
function createHandshakePacket(hostname, port) {
  const packetId = writeVarInt(0x00);
  const protocolVersion = writeVarInt(763); // 1.20.1, but any modern version works
  const serverAddress = writeString(hostname);
  const serverPort = Buffer.allocUnsafe(2);
  serverPort.writeUInt16BE(port);
  const nextState = writeVarInt(1); // 1 = status, 2 = login

  const data = Buffer.concat([
    packetId,
    protocolVersion,
    serverAddress,
    serverPort,
    nextState
  ]);

  const packetLength = writeVarInt(data.length);
  return Buffer.concat([packetLength, data]);
}

/**
 * Create status request packet
 * @returns {Buffer} Status request packet
 */
function createStatusRequestPacket() {
  const packetId = writeVarInt(0x00);
  const packetLength = writeVarInt(packetId.length);
  return Buffer.concat([packetLength, packetId]);
}

/**
 * Read VarInt from buffer
 * @param {Buffer} buffer - Buffer to read from
 * @param {number} offset - Offset to start reading
 * @returns {{value: number, bytesRead: number} | null} VarInt value and bytes consumed
 */
function readVarInt(buffer, offset = 0) {
  let value = 0;
  let bytesRead = 0;
  let currentByte;

  do {
    if (offset + bytesRead >= buffer.length) {
      return null;
    }

    currentByte = buffer[offset + bytesRead];
    value |= (currentByte & 0x7F) << (7 * bytesRead);
    bytesRead++;

    if (bytesRead > 5) {
      throw new Error('VarInt is too long');
    }
  } while ((currentByte & 0x80) !== 0);

  return { value, bytesRead };
}

/**
 * Parse status response JSON
 * @param {Buffer} buffer - Response buffer
 * @returns {Object | null} Parsed status or null if incomplete/invalid
 */
function parseStatusResponse(buffer) {
  try {
    let offset = 0;

    // Read packet length
    const packetLengthResult = readVarInt(buffer, offset);
    if (!packetLengthResult) return null;
    offset += packetLengthResult.bytesRead;

    const packetLength = packetLengthResult.value;

    // Check if we have full packet
    if (buffer.length < offset + packetLength) {
      return null; // Incomplete
    }

    // Read packet ID (should be 0x00)
    const packetIdResult = readVarInt(buffer, offset);
    if (!packetIdResult || packetIdResult.value !== 0x00) {
      return { error: 'Invalid packet ID' };
    }
    offset += packetIdResult.bytesRead;

    // Read JSON string length
    const jsonLengthResult = readVarInt(buffer, offset);
    if (!jsonLengthResult) return null;
    offset += jsonLengthResult.bytesRead;

    const jsonLength = jsonLengthResult.value;

    // Read JSON string
    if (buffer.length < offset + jsonLength) {
      return null; // Incomplete
    }

    const jsonString = buffer.toString('utf8', offset, offset + jsonLength);

    // Parse JSON
    const status = JSON.parse(jsonString);

    return {
      success: true,
      version: status.version?.name || 'Unknown',
      protocol: status.version?.protocol || 0,
      maxPlayers: status.players?.max || 0,
      onlinePlayers: status.players?.online || 0,
      description: typeof status.description === 'string'
        ? status.description
        : status.description?.text || 'No description',
      playerSample: status.players?.sample || [],
      favicon: status.favicon || null
    };

  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Perform Minecraft Server List Ping
 * Returns detailed server status including player count, version, MOTD
 *
 * @param {string} hostname - Server hostname or IP
 * @param {number} port - Server port (default 25565)
 * @param {number} timeout - Timeout in milliseconds (default 5000)
 * @returns {Promise<Object>} Server status or error
 */
export function minecraftServerListPing(hostname, port = 25565, timeout = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let responseBuffer = Buffer.alloc(0);
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    const resolveResult = (result) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({
          ...result,
          responseTime: Date.now() - startTime
        });
      }
    };

    // Timeout
    const timeoutHandle = setTimeout(() => {
      resolveResult({
        success: false,
        error: `Timeout (${timeout}ms)`
      });
    }, timeout);

    socket.on('connect', () => {
      try {
        // Send handshake packet
        const handshake = createHandshakePacket(hostname, port);
        socket.write(handshake);

        // Send status request packet
        const statusRequest = createStatusRequestPacket();
        socket.write(statusRequest);
      } catch (error) {
        clearTimeout(timeoutHandle);
        resolveResult({
          success: false,
          error: `Failed to send packets: ${error.message}`
        });
      }
    });

    socket.on('data', (chunk) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);

      // Try to parse response
      const result = parseStatusResponse(responseBuffer);

      if (result && result.success) {
        clearTimeout(timeoutHandle);
        resolveResult(result);
      } else if (result && result.error) {
        clearTimeout(timeoutHandle);
        resolveResult({
          success: false,
          error: result.error
        });
      }
      // If null, wait for more data
    });

    socket.on('error', (error) => {
      clearTimeout(timeoutHandle);
      resolveResult({
        success: false,
        error: error.message
      });
    });

    socket.on('timeout', () => {
      clearTimeout(timeoutHandle);
      resolveResult({
        success: false,
        error: 'Socket timeout'
      });
    });

    socket.on('close', () => {
      clearTimeout(timeoutHandle);
      if (!resolved) {
        resolveResult({
          success: false,
          error: 'Connection closed before receiving response'
        });
      }
    });

    // Connect to server
    socket.connect(port, hostname);
  });
}

/**
 * Simple wrapper for health check usage
 * Returns true/false + basic metrics
 */
export async function minecraftHealthCheck(hostname, port = 25565, timeout = 5000) {
  try {
    const result = await minecraftServerListPing(hostname, port, timeout);

    if (result.success) {
      return {
        success: true,
        responseTime: result.responseTime,
        metrics: {
          version: result.version,
          onlinePlayers: result.onlinePlayers,
          maxPlayers: result.maxPlayers,
          description: result.description
        },
        error: null
      };
    } else {
      return {
        success: false,
        responseTime: result.responseTime,
        error: result.error
      };
    }
  } catch (error) {
    return {
      success: false,
      responseTime: 0,
      error: error.message
    };
  }
}
