import { createHmac, createHash } from 'crypto';
import { inflateSync } from 'zlib';

/**
 * Minecraft Protocol Parser
 *
 * Parses Minecraft Java Edition handshake packets to extract the hostname
 * for reverse proxy routing based on Server Name Indication (SNI-like).
 *
 * Minecraft Handshake Packet Structure:
 * [Packet Length (VarInt)]
 * [Packet ID: 0x00 (VarInt)]
 * [Protocol Version (VarInt)]
 * [Server Address (String)] ← HOSTNAME
 * [Server Port (Unsigned Short)]
 * [Next State (VarInt): 1=status, 2=login]
 */

/**
 * Read a VarInt from buffer
 * VarInt format: variable-length integer (1-5 bytes)
 * Each byte: 7 bits data + 1 continuation bit
 *
 * @param {Buffer} buffer - Buffer to read from
 * @param {number} offset - Offset to start reading
 * @returns {{value: number, bytesRead: number} | null} VarInt value and bytes consumed, or null if incomplete
 */
export function readVarInt(buffer, offset = 0) {
  let value = 0;
  let bytesRead = 0;
  let currentByte;

  do {
    if (offset + bytesRead >= buffer.length) {
      // Not enough data yet
      return null;
    }

    currentByte = buffer[offset + bytesRead];
    value |= (currentByte & 0x7F) << (7 * bytesRead);
    bytesRead++;

    if (bytesRead > 5) {
      throw new Error('VarInt is too long (max 5 bytes)');
    }
  } while ((currentByte & 0x80) !== 0); // Continue if bit 8 is set

  return { value, bytesRead };
}

/**
 * Read a String from buffer
 * String format: VarInt (length) + UTF-8 bytes
 *
 * @param {Buffer} buffer - Buffer to read from
 * @param {number} offset - Offset to start reading
 * @param {number} maxLength - Maximum string length allowed
 * @returns {{value: string, bytesRead: number} | null} String value and bytes consumed, or null if incomplete
 */
export function readString(buffer, offset = 0, maxLength = 32767) {
  // Read string length (VarInt)
  const lengthResult = readVarInt(buffer, offset);
  if (!lengthResult) {
    return null; // Not enough data for length
  }

  const { value: length, bytesRead: lengthBytes } = lengthResult;

  if (length < 0 || length > maxLength) {
    throw new Error(`String length ${length} exceeds maximum ${maxLength}`);
  }

  const stringStart = offset + lengthBytes;
  const stringEnd = stringStart + length;

  if (buffer.length < stringEnd) {
    return null; // Not enough data for full string
  }

  // Read UTF-8 string
  const value = buffer.toString('utf8', stringStart, stringEnd);
  const bytesRead = lengthBytes + length;

  return { value, bytesRead };
}

/**
 * Clean hostname by removing Minecraft quirks
 * - Handles Floodgate prefix (\x00<base64data>\x00<actual-hostname>[...])
 * - Removes trailing null bytes (\0)
 * - Removes port suffix (e.g., "mc.example.com:25565" → "mc.example.com")
 * - Converts to lowercase
 *
 * @param {string} hostname - Raw hostname from handshake
 * @returns {string} Cleaned hostname
 */
export function cleanHostname(hostname) {
  if (!hostname) return '';

  // Handle Floodgate prefix: \x00<base64data>\x00<actual-hostname>[\x00<ip>\x00<uuid>...]
  // Floodgate (Geyser companion plugin) prepends encrypted player data to the server address
  if (hostname.startsWith('\x00')) {
    const parts = hostname.split('\x00');
    // parts[0] = '' (before first \x00)
    // parts[1] = floodgate encrypted data (base64)
    // parts[2] = actual hostname
    // parts[3+] = optional BungeeCord forwarding data (ip, uuid, ...)
    if (parts.length >= 3) {
      hostname = parts[2];
    }
  }

  // Remove trailing null bytes (Minecraft quirk)
  let cleaned = hostname.replace(/\0+$/, '');

  // Remove port suffix if present
  const colonIndex = cleaned.lastIndexOf(':');
  if (colonIndex !== -1) {
    // Check if it's a port number (not IPv6)
    const afterColon = cleaned.substring(colonIndex + 1);
    if (/^\d+$/.test(afterColon)) {
      cleaned = cleaned.substring(0, colonIndex);
    }
  }

  // Convert to lowercase
  return cleaned.toLowerCase().trim();
}

/**
 * Validate hostname format
 *
 * @param {string} hostname - Hostname to validate
 * @returns {boolean} True if valid
 */
export function isValidHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return false;
  }

  if (hostname.length < 1 || hostname.length > 253) {
    return false;
  }

  // Hostname regex: alphanumeric, hyphens, dots, underscores
  // Allow IP addresses and domain names
  const hostnameRegex = /^[a-z0-9]([a-z0-9-_.]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-_.]*[a-z0-9])?)*$/i;

  return hostnameRegex.test(hostname);
}

/**
 * Parse Minecraft handshake packet
 *
 * @param {Buffer} buffer - Buffer containing handshake data
 * @returns {Object} Parse result:
 *   - {success: true, hostname, port, nextState, totalBytes} on success
 *   - {incomplete: true, reason: string} if need more data
 *   - {success: false, error: string} on parse error
 */
export function parseHandshake(buffer) {
  if (!buffer || buffer.length === 0) {
    return { incomplete: true, reason: 'Empty buffer' };
  }

  try {
    let offset = 0;

    // 1. Read Packet Length (VarInt)
    const packetLenResult = readVarInt(buffer, offset);
    if (!packetLenResult) {
      return { incomplete: true, reason: 'Need packet length' };
    }
    offset += packetLenResult.bytesRead;

    const packetLength = packetLenResult.value;

    // Validate packet length
    if (packetLength < 1) {
      return { success: false, error: 'Invalid packet length: must be > 0' };
    }

    // 2. Check if we have the full packet
    if (buffer.length < offset + packetLength) {
      return {
        incomplete: true,
        reason: `Need ${offset + packetLength} bytes, have ${buffer.length}`
      };
    }

    // 3. Read Packet ID (VarInt) - must be 0x00 for handshake
    const packetIdResult = readVarInt(buffer, offset);
    if (!packetIdResult) {
      return { incomplete: true, reason: 'Need packet ID' };
    }
    offset += packetIdResult.bytesRead;

    if (packetIdResult.value !== 0x00) {
      return {
        success: false,
        error: `Invalid packet ID: expected 0x00, got 0x${packetIdResult.value.toString(16)}`
      };
    }

    // 4. Read Protocol Version (VarInt) - we don't need this value
    const protocolVersionResult = readVarInt(buffer, offset);
    if (!protocolVersionResult) {
      return { incomplete: true, reason: 'Need protocol version' };
    }
    offset += protocolVersionResult.bytesRead;

    // 5. Read Server Address (String) - THIS IS THE HOSTNAME
    const serverAddressResult = readString(buffer, offset, 255);
    if (!serverAddressResult) {
      return { incomplete: true, reason: 'Need server address' };
    }
    offset += serverAddressResult.bytesRead;

    // 6. Read Server Port (Unsigned Short, 2 bytes)
    if (buffer.length < offset + 2) {
      return { incomplete: true, reason: 'Need server port' };
    }
    const serverPort = buffer.readUInt16BE(offset);
    offset += 2;

    // 7. Read Next State (VarInt): 1=status, 2=login
    const nextStateResult = readVarInt(buffer, offset);
    if (!nextStateResult) {
      return { incomplete: true, reason: 'Need next state' };
    }
    offset += nextStateResult.bytesRead;

    // 8. Clean and validate hostname, detect Floodgate data
    const rawServerAddress = serverAddressResult.value;
    let floodgateData = null;
    let hasFloodgateBungeeCord = false;

    if (rawServerAddress.startsWith('\x00')) {
      // Floodgate format: \x00<base64data>\x00<hostname>[\x00<ip>\x00<uuid>...]
      const parts = rawServerAddress.split('\x00');
      // parts[0]='' parts[1]=floodgate_blob parts[2]=hostname parts[3]=ip parts[4]=uuid...
      if (parts.length >= 3) {
        floodgateData = parts[1];
        // Geyser already included BungeeCord data when parts has ip + uuid after hostname
        hasFloodgateBungeeCord = parts.length >= 5 && parts[3].length > 0;
      }
    }

    const hostname = cleanHostname(rawServerAddress);
    if (!isValidHostname(hostname)) {
      return {
        success: false,
        error: `Invalid hostname: "${hostname}"`
      };
    }

    // Success!
    return {
      success: true,
      hostname,
      port: serverPort,
      nextState: nextStateResult.value,
      protocolVersion: protocolVersionResult.value,
      totalBytes: offset,
      rawServerAddress,
      floodgateData,         // base64 blob if Floodgate prefix detected, null otherwise
      hasFloodgateBungeeCord // true if Geyser already appended BungeeCord ip+uuid
    };

  } catch (error) {
    return {
      success: false,
      error: `Parse error: ${error.message}`
    };
  }
}

/**
 * Encode a VarInt into a Buffer
 */
export function writeVarInt(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7F;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/**
 * Encode a Minecraft String (VarInt length + UTF-8 bytes)
 */
export function writeString(str) {
  const strBytes = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(strBytes.length), strBytes]);
}

/**
 * Rebuild a Minecraft handshake packet with BungeeCord IP forwarding.
 * Appends \x00<clientIp>\x00<uuid> to the Server Address field so that
 * a Spigot/Paper backend with bungeecord: true can read the real client IP.
 *
 * @param {Object} parsed  - Successful result from parseHandshake
 * @param {string} clientIp - Real client IP to inject
 * @param {string} [uuid]  - Player UUID (dashed). Defaults to zero UUID for offline mode.
 * @returns {Buffer} New handshake packet (length-prefixed)
 */
/**
 * Try to read one complete (uncompressed) Minecraft packet from a buffer.
 * Returns { id, data, rawBytes, totalBytes } or null if incomplete.
 */
export function tryReadPacket(buffer, offset = 0) {
  const lenResult = readVarInt(buffer, offset);
  if (!lenResult) return null;
  const { value: packetLen, bytesRead: lenBytes } = lenResult;
  const dataStart = offset + lenBytes;
  if (buffer.length < dataStart + packetLen) return null;
  const packetData = buffer.slice(dataStart, dataStart + packetLen);
  const idResult = readVarInt(packetData, 0);
  if (!idResult) return null;
  return {
    id: idResult.value,
    data: packetData.slice(idResult.bytesRead),
    rawBytes: buffer.slice(offset, dataStart + packetLen),
    totalBytes: lenBytes + packetLen
  };
}

/**
 * Try to read one complete compressed Minecraft packet from a buffer.
 * (Used after the backend sends Set Compression 0x03.)
 * Returns { id, data, rawBytes, totalBytes } or null if incomplete.
 */
export function tryReadCompressedPacket(buffer, offset = 0) {
  const lenResult = readVarInt(buffer, offset);
  if (!lenResult) return null;
  const { value: packetLen, bytesRead: lenBytes } = lenResult;
  const dataStart = offset + lenBytes;
  if (buffer.length < dataStart + packetLen) return null;
  const packetBytes = buffer.slice(dataStart, dataStart + packetLen);
  const dataLenResult = readVarInt(packetBytes, 0);
  if (!dataLenResult) return null;
  const dataLen = dataLenResult.value;
  let payload;
  if (dataLen === 0) {
    payload = packetBytes.slice(dataLenResult.bytesRead);
  } else {
    try {
      payload = inflateSync(packetBytes.slice(dataLenResult.bytesRead));
    } catch {
      return null;
    }
  }
  const idResult = readVarInt(payload, 0);
  if (!idResult) return null;
  return {
    id: idResult.value,
    data: payload.slice(idResult.bytesRead),
    rawBytes: buffer.slice(offset, dataStart + packetLen),
    totalBytes: lenBytes + packetLen
  };
}

/**
 * Parse a Login Start packet (0x00, login state) to extract the username.
 * Works across 1.7–1.20+ (handles optional UUID field added in 1.19).
 * Returns { username, totalBytes } or null if incomplete/invalid.
 */
export function parseLoginStart(buffer) {
  const packet = tryReadPacket(buffer);
  if (!packet || packet.id !== 0x00) return null;
  const nameResult = readString(packet.data, 0, 16);
  if (!nameResult) return null;
  return { username: nameResult.value, totalBytes: packet.totalBytes };
}

/**
 * Generate an offline-mode UUID (v3 from MD5 of "OfflinePlayer:<username>").
 * Returns a 16-byte Buffer.
 */
export function offlineUUID(username) {
  const bytes = createHash('md5').update(`OfflinePlayer:${username}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30; // version 3
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  return bytes;
}

/**
 * Build a Velocity modern-forwarding Login Plugin Response.
 *
 * @param {number} messageId  - Message ID echoed from Login Plugin Request
 * @param {string} secret     - Shared secret from velocity.toml
 * @param {string} clientIp   - Real client IP
 * @param {Buffer} uuidBytes  - 16-byte UUID
 * @param {string} username   - Player username
 * @returns {Buffer} Complete Login Plugin Response packet
 */
export function buildVelocityResponse(messageId, secret, clientIp, uuidBytes, username) {
  const VELOCITY_FORWARDING_VERSION = 1;
  const payload = Buffer.concat([
    Buffer.from([VELOCITY_FORWARDING_VERSION]),
    writeString(clientIp),
    uuidBytes,          // 16 bytes
    writeString(username),
    writeVarInt(0)      // 0 skin properties (offline mode)
  ]);
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(payload).digest();
  const responseData = Buffer.concat([sig, payload]);
  // Packet: ID=0x02, messageId (VarInt), success=true (0x01), data
  const body = Buffer.concat([writeVarInt(0x02), writeVarInt(messageId), Buffer.from([0x01]), responseData]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

export function buildBungeeCordHandshake(parsed, clientIp, uuid = '00000000-0000-0000-0000-000000000000') {
  let modifiedAddress;

  if (parsed.floodgateData != null) {
    // Preserve Floodgate prefix so the Floodgate plugin on the backend can decrypt
    // the real Bedrock player data (IP, UUID, username, device info, ...).
    // Combined format: \x00<floodgate_blob>\x00<hostname>\x00<ip>\x00<uuid>
    modifiedAddress = `\x00${parsed.floodgateData}\x00${parsed.hostname}\x00${clientIp}\x00${uuid}`;
  } else {
    modifiedAddress = `${parsed.hostname}\x00${clientIp}\x00${uuid}`;
  }

  const payload = Buffer.concat([
    writeVarInt(0x00),
    writeVarInt(parsed.protocolVersion),
    writeString(modifiedAddress),
    Buffer.from([(parsed.port >> 8) & 0xFF, parsed.port & 0xFF]),
    writeVarInt(parsed.nextState)
  ]);

  return Buffer.concat([writeVarInt(payload.length), payload]);
}
