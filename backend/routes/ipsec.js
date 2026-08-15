// @ts-check
import { database } from '../services/database.js';
import { ipsecService } from '../services/ipsecService.js';
import { encryptSecret, decryptSecret } from '../utils/secretCrypto.js';

function safeTunnel(tunnel) {
  const { psk, ...rest } = tunnel;
  return rest;
}

async function loadTunnelOr404(reply, id) {
  const tunnel = await database.getIpsecTunnelById(id);
  if (!tunnel) {
    reply.code(404).send({ error: 'Not Found', message: 'IPsec tunnel not found' });
    return null;
  }
  return tunnel;
}

export async function ipsecRoutes(fastify, _options) {
  // List tunnels with live up/down status.
  fastify.get('/', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const tunnels = await database.getAllIpsecTunnels();
      const enriched = await Promise.all(tunnels.map(async (tunnel) => ({
        ...safeTunnel(tunnel),
        running: await ipsecService.isUp(tunnel.conn_name)
      })));
      reply.send({ success: true, tunnels: enriched });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to list IPsec tunnels');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to list IPsec tunnels' });
    }
  });

  // Create a tunnel — generates a PSK server-side (or accepts one), writes
  // the swanctl config, but leaves it DOWN until explicitly enabled.
  fastify.post('/', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'mode', 'localSubnet', 'remoteSubnet'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          mode: { type: 'string', enum: ['client', 'server'] },
          localId: { type: 'string', maxLength: 255 },
          remoteId: { type: 'string', maxLength: 255 },
          remoteAddr: { type: 'string', maxLength: 255 },
          localSubnet: { type: 'string', minLength: 1, maxLength: 1024 },
          remoteSubnet: { type: 'string', minLength: 1, maxLength: 1024 },
          ikeProposal: { type: 'string', maxLength: 255 },
          espProposal: { type: 'string', maxLength: 255 },
          psk: { type: 'string', minLength: 8, maxLength: 512 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const {
        name, mode, localId, remoteId, remoteAddr, localSubnet, remoteSubnet,
        ikeProposal, espProposal
      } = request.body;

      if (mode === 'client' && !remoteAddr) {
        return reply.code(400).send({ error: 'Bad Request', message: 'remoteAddr is required for a client-mode tunnel (the peer to connect to)' });
      }

      const existing = await database.getAllIpsecTunnels();
      const connName = await ipsecService.nextConnName(existing.map((t) => t.conn_name));
      const psk = request.body.psk || ipsecService.generatePresharedKey();

      const tunnel = await database.createIpsecTunnel({
        name,
        mode,
        connName,
        localId: localId ?? null,
        remoteId: remoteId ?? null,
        remoteAddr: remoteAddr ?? null,
        localSubnet,
        remoteSubnet,
        ikeProposal: ikeProposal || 'aes256-sha256-modp2048',
        espProposal: espProposal || 'aes256-sha256',
        psk: encryptSecret(psk),
        createdBy: request.user.id
      });

      await ipsecService.writeConfig({ ...tunnel, psk });
      await ipsecService.loadAll();

      await database.createAuditLog({
        userId: request.user.id,
        action: 'ipsec_tunnel_created',
        entityType: 'ipsec_tunnel',
        entityId: tunnel.id,
        details: { name, mode, conn_name: connName },
        ipAddress: request.ip
      });

      reply.code(201).send({ success: true, tunnel: safeTunnel(tunnel) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create IPsec tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to create IPsec tunnel' });
    }
  });

  // Tunnel detail: config + live SA status.
  fastify.get('/:id', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const status = await ipsecService.status(tunnel.conn_name);

      reply.send({
        success: true,
        tunnel: { ...safeTunnel(tunnel), running: status.up },
        status
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch IPsec tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch IPsec tunnel' });
    }
  });

  fastify.patch('/:id', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          remoteId: { type: 'string', maxLength: 255 },
          remoteAddr: { type: 'string', maxLength: 255 },
          localSubnet: { type: 'string', minLength: 1, maxLength: 1024 },
          remoteSubnet: { type: 'string', minLength: 1, maxLength: 1024 },
          ikeProposal: { type: 'string', maxLength: 255 },
          espProposal: { type: 'string', maxLength: 255 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const updated = await database.updateIpsecTunnel(id, request.body);
      await ipsecService.writeConfig({ ...updated, psk: decryptSecret(updated.psk) });
      await ipsecService.reload(updated);

      reply.send({ success: true, tunnel: safeTunnel(updated) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update IPsec tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to update IPsec tunnel' });
    }
  });

  fastify.post('/:id/enable', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const updated = await database.setIpsecTunnelEnabled(id, true);
      await ipsecService.writeConfig({ ...updated, psk: decryptSecret(updated.psk) });
      await ipsecService.up(updated.conn_name);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'ipsec_tunnel_enabled',
        entityType: 'ipsec_tunnel',
        entityId: id,
        details: { conn_name: tunnel.conn_name },
        ipAddress: request.ip
      });

      reply.send({ success: true, tunnel: safeTunnel(updated) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to enable IPsec tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to enable IPsec tunnel' });
    }
  });

  fastify.post('/:id/disable', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      await ipsecService.down(tunnel.conn_name);
      const updated = await database.setIpsecTunnelEnabled(id, false);
      await ipsecService.writeConfig({ ...updated, psk: decryptSecret(updated.psk) });
      await ipsecService.loadAll();

      await database.createAuditLog({
        userId: request.user.id,
        action: 'ipsec_tunnel_disabled',
        entityType: 'ipsec_tunnel',
        entityId: id,
        details: { conn_name: tunnel.conn_name },
        ipAddress: request.ip
      });

      reply.send({ success: true, tunnel: safeTunnel(updated) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to disable IPsec tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to disable IPsec tunnel' });
    }
  });

  fastify.post('/:id/rotate-psk', {
    preHandler: fastify.requireAdmin,
    schema: {
      body: {
        type: 'object',
        properties: {
          // Lets an admin pin the PSK to match a peer that's already
          // configured elsewhere (e.g. an existing pfSense tunnel) instead
          // of always generating a fresh random one.
          psk: { type: 'string', minLength: 8, maxLength: 512 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const psk = request.body?.psk || ipsecService.generatePresharedKey();
      const updated = await database.rotateIpsecTunnelPsk(id, encryptSecret(psk));
      await ipsecService.writeConfig({ ...updated, psk });
      await ipsecService.reload(updated);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'ipsec_tunnel_psk_rotated',
        entityType: 'ipsec_tunnel',
        entityId: id,
        details: { conn_name: tunnel.conn_name },
        ipAddress: request.ip
      });

      reply.send({ success: true, tunnel: safeTunnel(updated), psk });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to rotate IPsec tunnel PSK');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to rotate IPsec tunnel PSK' });
    }
  });

  // Reveals the current PSK on demand — the remote peer's device needs it
  // typed in by hand, so (unlike WireGuard's peer keys) this isn't a
  // shown-once secret. Every view is audit logged.
  fastify.get('/:id/psk', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      await database.createAuditLog({
        userId: request.user.id,
        action: 'ipsec_tunnel_psk_viewed',
        entityType: 'ipsec_tunnel',
        entityId: id,
        details: { conn_name: tunnel.conn_name },
        ipAddress: request.ip
      });

      reply.send({ success: true, psk: decryptSecret(tunnel.psk) });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to reveal IPsec tunnel PSK');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to reveal IPsec tunnel PSK' });
    }
  });

  fastify.delete('/:id', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      await ipsecService.deleteConfig(tunnel.conn_name);
      await database.deleteIpsecTunnel(id);

      await database.createAuditLog({
        userId: request.user.id,
        action: 'ipsec_tunnel_deleted',
        entityType: 'ipsec_tunnel',
        entityId: id,
        details: { name: tunnel.name, conn_name: tunnel.conn_name },
        ipAddress: request.ip
      });

      reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete IPsec tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete IPsec tunnel' });
    }
  });

  // Export this tunnel's swanctl connection config (PSK omitted — see
  // GET /:id/psk for that, kept separate since this file is meant to be
  // handed to whoever configures the far end).
  fastify.get('/:id/config', { preHandler: fastify.requireAdmin }, async (request, reply) => {
    try {
      const id = Number.parseInt(request.params.id, 10);
      const tunnel = await loadTunnelOr404(reply, id);
      if (!tunnel) return;

      const conf = ipsecService.renderConfig({ ...tunnel, psk: '<see PSK on the tunnel page>' });
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${tunnel.conn_name}.conf"`);
      reply.send(conf);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to export IPsec tunnel config');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to export IPsec tunnel config' });
    }
  });
}
