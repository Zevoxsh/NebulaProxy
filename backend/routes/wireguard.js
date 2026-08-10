// @ts-check
import { database } from '../services/database.js';
import { wireguardService } from '../services/wireguardService.js';
import { encryptSecret, decryptSecret } from '../utils/secretCrypto.js';

function safeTunnel(tunnel) {
  const { private_key, ...rest } = tunnel;
  return rest;
}

function safePeer(peer) {
  const { preshared_key, ...rest } = peer;
  return { ...rest, has_preshared_key: Boolean(preshared_key) };
}

async function loadTunnelOr404(reply, id) {
  const tunnel = await database.getWireguardTunnelById(id);
  if (!tunnel) {
    reply.code(404).send({ error: 'Not Found', message: 'WireGuard tunnel not found' });
    return null;
  }
  return tunnel;
}

export async function wireguardRoutes(fastify, _options) {
  // List tunnels with live up/down status.
  fastify.get('/', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const tunnels = await database.getAllWireguardTunnels();
      const enriched = await Promise.all(tunnels.map(async (tunnel) => ({
        ...safeTunnel(tunnel),
        running: await wireguardService.isUp(tunnel.interface_name)
      })));
      reply.send({ success: true, tunnels: enriched });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to list WireGuard tunnels');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to list WireGuard tunnels' });
    }
  });

  // Create a tunnel — generates its keypair server-side, writes the conf,
  // but leaves it DOWN until explicitly enabled (POST /:id/enable).
  fastify.post('/', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'mode', 'address'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          mode: { type: 'string', enum: ['client', 'server'] },
          address: { type: 'string', minLength: 1, maxLength: 64 },
          listenPort: { type: 'integer', minimum: 1, maximum: 65535 },
          mtu: { type: 'integer', minimum: 68, maximum: 9000 },
          dns: { type: 'string', maxLength: 255 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const { name, mode, address, listenPort, mtu, dns } = request.body;

      const existing = await database.getAllWireguardTunnels();
      const interfaceName = await wireguardService.nextInterfaceName(existing.map((t) => t.interface_name));
      const { privateKey, publicKey } = await wireguardService.generateKeypair();

      const tunnel = await database.createWireguardTunnel({
        name,
        mode,
        interfaceName,
        privateKey: encryptSecret(privateKey),
        publicKey,
        address,
        listenPort: listenPort ?? null,
        mtu: mtu ?? null,
        dns: dns ?? null,
        createdBy: request.user.id
      });

      await wireguardService.writeConfig({ ...tunnel, private_key: privateKey }, []);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'wireguard_tunnel_created',
        entityType: 'wireguard_tunnel',
        entityId: tunnel.id,
        details: { name, mode, interface_name: interfaceName },
        ipAddress: request.ip
      });

      reply.code(201).send({ success: true, tunnel: safeTunnel(tunnel) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create WireGuard tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to create WireGuard tunnel' });
    }
  });

  // Tunnel detail: config + peers + live per-peer handshake/transfer stats.
  fastify.get('/:id', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const peers = await database.getWireguardPeersByTunnelId(id);
      const status = await wireguardService.status(tunnel.interface_name);

      reply.send({
        success: true,
        tunnel: { ...safeTunnel(tunnel), running: status.up },
        peers: peers.map((peer) => ({ ...safePeer(peer), status: status.peers[peer.public_key] || null }))
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch WireGuard tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch WireGuard tunnel' });
    }
  });

  fastify.patch('/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          address: { type: 'string', minLength: 1, maxLength: 64 },
          listenPort: { type: 'integer', minimum: 1, maximum: 65535 },
          mtu: { type: 'integer', minimum: 68, maximum: 9000 },
          dns: { type: 'string', maxLength: 255 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const updated = await database.updateWireguardTunnel(id, request.body);
      const peers = await database.getWireguardPeersByTunnelId(id);
      await wireguardService.writeConfig({ ...updated, private_key: decryptSecret(updated.private_key) }, peers);
      if (await wireguardService.isUp(updated.interface_name)) {
        await wireguardService.reload(updated.interface_name);
      }

      reply.send({ success: true, tunnel: safeTunnel(updated) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update WireGuard tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to update WireGuard tunnel' });
    }
  });

  fastify.post('/:id/enable', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const peers = await database.getWireguardPeersByTunnelId(id);
      await wireguardService.writeConfig({ ...tunnel, private_key: decryptSecret(tunnel.private_key) }, peers);
      await wireguardService.up(tunnel.interface_name);
      const updated = await database.setWireguardTunnelEnabled(id, true);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'wireguard_tunnel_enabled',
        entityType: 'wireguard_tunnel',
        entityId: id,
        details: { interface_name: tunnel.interface_name },
        ipAddress: request.ip
      });

      reply.send({ success: true, tunnel: safeTunnel(updated) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to enable WireGuard tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to enable WireGuard tunnel' });
    }
  });

  fastify.post('/:id/disable', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      await wireguardService.down(tunnel.interface_name);
      const updated = await database.setWireguardTunnelEnabled(id, false);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'wireguard_tunnel_disabled',
        entityType: 'wireguard_tunnel',
        entityId: id,
        details: { interface_name: tunnel.interface_name },
        ipAddress: request.ip
      });

      reply.send({ success: true, tunnel: safeTunnel(updated) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to disable WireGuard tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to disable WireGuard tunnel' });
    }
  });

  fastify.post('/:id/rotate-keys', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const { privateKey, publicKey } = await wireguardService.generateKeypair();
      const updated = await database.rotateWireguardTunnelKeys(id, { privateKey: encryptSecret(privateKey), publicKey });
      const peers = await database.getWireguardPeersByTunnelId(id);
      await wireguardService.writeConfig({ ...updated, private_key: privateKey }, peers);
      if (await wireguardService.isUp(tunnel.interface_name)) {
        await wireguardService.reload(tunnel.interface_name);
      }

      await database.createAuditLog({
        userId: request.user.id,
        action: 'wireguard_tunnel_keys_rotated',
        entityType: 'wireguard_tunnel',
        entityId: id,
        details: { interface_name: tunnel.interface_name },
        ipAddress: request.ip
      });

      reply.send({ success: true, tunnel: safeTunnel(updated) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to rotate WireGuard tunnel keys');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to rotate WireGuard tunnel keys' });
    }
  });

  fastify.delete('/:id', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      await wireguardService.deleteConfig(tunnel.interface_name);
      await database.deleteWireguardTunnel(id);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'wireguard_tunnel_deleted',
        entityType: 'wireguard_tunnel',
        entityId: id,
        details: { name: tunnel.name, interface_name: tunnel.interface_name },
        ipAddress: request.ip
      });

      reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete WireGuard tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete WireGuard tunnel' });
    }
  });

  // Export this tunnel's own wg-quick conf (e.g. to load onto a router
  // acting as the far end of a site-to-site link).
  fastify.get('/:id/config', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const peers = await database.getWireguardPeersByTunnelId(id);
      const conf = wireguardService.renderConfig({ ...tunnel, private_key: decryptSecret(tunnel.private_key) }, peers);
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${tunnel.interface_name}.conf"`);
      reply.send(conf);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to export WireGuard tunnel config');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to export WireGuard tunnel config' });
    }
  });

  // ===== PEERS =====

  fastify.post('/:id/peers', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'allowedIps'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          publicKey: { type: 'string', minLength: 40, maxLength: 44 },
          allowedIps: { type: 'string', minLength: 1, maxLength: 1024 },
          endpointHost: { type: 'string', maxLength: 255 },
          endpointPort: { type: 'integer', minimum: 1, maximum: 65535 },
          persistentKeepalive: { type: 'integer', minimum: 1, maximum: 3600 },
          generateKeypair: { type: 'boolean' },
          generatePresharedKey: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const tunnelId = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, tunnelId);
      if (!tunnel) return;

      const {
        name, allowedIps, endpointHost, endpointPort, persistentKeepalive
      } = request.body;
      let { publicKey } = request.body;

      // Peer's own generated private key (if any) is returned once in the
      // response and never persisted — same "shown once" contract as API
      // keys / SOCKS5 passwords elsewhere in this app.
      let generatedPrivateKey = null;
      if (!publicKey && request.body.generateKeypair !== false) {
        const generated = await wireguardService.generateKeypair();
        publicKey = generated.publicKey;
        generatedPrivateKey = generated.privateKey;
      }
      if (!publicKey) {
        return reply.code(400).send({ error: 'Bad Request', message: 'publicKey is required when generateKeypair is false' });
      }

      const presharedKey = request.body.generatePresharedKey
        ? await wireguardService.generatePresharedKey()
        : null;

      const peer = await database.createWireguardPeer({
        tunnelId,
        name,
        publicKey,
        presharedKey: presharedKey ? encryptSecret(presharedKey) : null,
        allowedIps,
        endpointHost: endpointHost ?? null,
        endpointPort: endpointPort ?? null,
        persistentKeepalive: persistentKeepalive ?? null
      });

      const peers = await database.getWireguardPeersByTunnelId(tunnelId);
      await wireguardService.writeConfig({ ...tunnel, private_key: decryptSecret(tunnel.private_key) }, peers);
      if (await wireguardService.isUp(tunnel.interface_name)) {
        await wireguardService.reload(tunnel.interface_name);
      }

      await database.createAuditLog({
        userId: request.user.id,
        action: 'wireguard_peer_added',
        entityType: 'wireguard_peer',
        entityId: peer.id,
        details: { tunnel_id: tunnelId, name, allowed_ips: allowedIps },
        ipAddress: request.ip
      });

      // Ready-to-use client config for this peer, if we generated its keys —
      // treats `allowedIps` as the peer's own tunnel address (works cleanly
      // for the common single-peer/road-warrior case; for a subnet-routing
      // site-to-site peer, configure the far end directly instead).
      const peerConfig = generatedPrivateKey
        ? [
          '[Interface]',
          `PrivateKey = ${generatedPrivateKey}`,
          `Address = ${allowedIps}`,
          tunnel.dns ? `DNS = ${tunnel.dns}` : null,
          '',
          '[Peer]',
          `PublicKey = ${tunnel.public_key}`,
          presharedKey ? `PresharedKey = ${presharedKey}` : null,
          `AllowedIPs = 0.0.0.0/0, ::/0`,
          tunnel.listen_port ? `Endpoint = ${request.hostname}:${tunnel.listen_port}` : null,
          'PersistentKeepalive = 25'
        ].filter((l) => l !== null).join('\n') + '\n'
        : null;

      reply.code(201).send({
        success: true,
        peer: safePeer(peer),
        generatedPrivateKey,
        presharedKey,
        peerConfig
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to add WireGuard peer');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to add WireGuard peer' });
    }
  });

  fastify.patch('/:id/peers/:peerId', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          allowedIps: { type: 'string', minLength: 1, maxLength: 1024 },
          endpointHost: { type: 'string', maxLength: 255 },
          endpointPort: { type: 'integer', minimum: 1, maximum: 65535 },
          persistentKeepalive: { type: 'integer', minimum: 1, maximum: 3600 },
          isEnabled: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const tunnelId = Number.parseInt(request.params.id, 10);
      const peerId = Number.parseInt(request.params.peerId, 10);
      const tunnel = await loadTunnelOr404(reply, tunnelId);
      if (!tunnel) return;

      const peer = await database.getWireguardPeerById(peerId);
      if (!peer || peer.tunnel_id !== tunnelId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Peer not found on this tunnel' });
      }

      const updated = await database.updateWireguardPeer(peerId, request.body);
      const peers = await database.getWireguardPeersByTunnelId(tunnelId);
      await wireguardService.writeConfig({ ...tunnel, private_key: decryptSecret(tunnel.private_key) }, peers);
      if (await wireguardService.isUp(tunnel.interface_name)) {
        await wireguardService.reload(tunnel.interface_name);
      }

      reply.send({ success: true, peer: safePeer(updated) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update WireGuard peer');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to update WireGuard peer' });
    }
  });

  fastify.delete('/:id/peers/:peerId', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const tunnelId = Number.parseInt(request.params.id, 10);
      const peerId = Number.parseInt(request.params.peerId, 10);
      const tunnel = await loadTunnelOr404(reply, tunnelId);
      if (!tunnel) return;

      const peer = await database.getWireguardPeerById(peerId);
      if (!peer || peer.tunnel_id !== tunnelId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Peer not found on this tunnel' });
      }

      await database.deleteWireguardPeer(peerId);
      const peers = await database.getWireguardPeersByTunnelId(tunnelId);
      await wireguardService.writeConfig({ ...tunnel, private_key: decryptSecret(tunnel.private_key) }, peers);
      if (await wireguardService.isUp(tunnel.interface_name)) {
        await wireguardService.reload(tunnel.interface_name);
      }

      await database.createAuditLog({
        userId: request.user.id,
        action: 'wireguard_peer_removed',
        entityType: 'wireguard_peer',
        entityId: peerId,
        details: { tunnel_id: tunnelId, name: peer.name },
        ipAddress: request.ip
      });

      reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete WireGuard peer');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete WireGuard peer' });
    }
  });
}
