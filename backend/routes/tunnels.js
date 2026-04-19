import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { database } from '../services/database.js';
import { allocateAvailablePort } from '../services/portAllocator.js';
import { tunnelRelayService } from '../services/tunnelRelayService.js';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomCode = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentScriptCandidates = [
  path.join(__dirname, '..', 'scripts', 'tunnel-agent.js'),
  '/repo/backend/scripts/tunnel-agent.js'
];

async function readAgentScriptContent() {
  for (const candidatePath of agentScriptCandidates) {
    try {
      if (fs.existsSync(candidatePath)) {
        return await fs.promises.readFile(candidatePath, 'utf8');
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Tunnel agent script not found. Checked: ${agentScriptCandidates.join(', ')}`);
}

async function canAccessTunnel(tunnel, userId, isAdmin) {
  if (isAdmin) return true;
  if (tunnel.user_id === userId) return true;
  if (tunnel.team_id && await database.isTeamMember(tunnel.team_id, userId)) return true;
  const access = await database.getTunnelAccessEntry(tunnel.id, userId);
  if (access) return true;
  return false;
}

async function canManageTunnel(tunnel, userId, isAdmin) {
  if (isAdmin) return true;
  if (tunnel.user_id === userId) return true;
  const access = await database.getTunnelAccessEntry(tunnel.id, userId);
  return access?.role === 'manage';
}

function buildPublicHostname(tunnel, protocol) {
  return `${protocol}.${tunnel.id}.${config.tunnels.publicDomain}`;
}

function getPublicBaseUrl(request) {
  const headers = request?.headers || {};
  const forwardedProto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (request?.socket?.encrypted ? 'https' : 'http');
  const host = forwardedHost || String(headers.host || '').trim() || `127.0.0.1:${config.port}`;
  return `${protocol}://${host}`;
}

function buildInstallCommands(baseUrl, code) {
  const encodedCode = encodeURIComponent(code);
  const linuxInstallerUrl = `${baseUrl}/api/tunnels/install.sh?code=${encodedCode}`;
  const windowsInstallerUrl = `${baseUrl}/api/tunnels/install.ps1?code=${encodedCode}`;

  return {
    linuxInstallerUrl,
    windowsInstallerUrl,
    linuxCommand: `curl -fsSL "${linuxInstallerUrl}" | bash`,
    windowsCommand: `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr '${windowsInstallerUrl}' -UseBasicParsing | iex"`
  };
}

function buildLinuxInstallerScript({ baseUrl, code }) {
  const safeBaseUrl = JSON.stringify(baseUrl);
  const safeCode = JSON.stringify(code);

  return `#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "[nebula-tunnel] Node.js est requis (version 18+)."
  echo "[nebula-tunnel] Installe Node puis relance la commande."
  exit 1
fi

API_BASE=${safeBaseUrl}
ENROLL_CODE=${safeCode}
AGENT_NAME="$(hostname 2>/dev/null || echo tunnel-agent)"
INSTALL_DIR="$HOME/.nebula-tunnel"
AGENT_FILE="$INSTALL_DIR/tunnel-agent.mjs"
CONFIG_FILE="$INSTALL_DIR/agent-config.json"
LOG_FILE="$INSTALL_DIR/agent.log"

mkdir -p "$INSTALL_DIR"
curl -fsSL "$API_BASE/api/tunnels/agent-script" -o "$AGENT_FILE"

node "$AGENT_FILE" enroll --server "$API_BASE" --code "$ENROLL_CODE" --name "$AGENT_NAME" --config "$CONFIG_FILE"

if command -v nohup >/dev/null 2>&1; then
  nohup node "$AGENT_FILE" run --server "$API_BASE" --config "$CONFIG_FILE" > "$LOG_FILE" 2>&1 &
  echo "[nebula-tunnel] Agent démarré en arrière-plan."
  echo "[nebula-tunnel] Logs: $LOG_FILE"
else
  node "$AGENT_FILE" run --server "$API_BASE" --config "$CONFIG_FILE"
fi
`;
}

function buildWindowsInstallerScript({ baseUrl, code }) {
  const safeBaseUrl = JSON.stringify(baseUrl);
  const safeCode = JSON.stringify(code);

  return `
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 18+ est requis. Installe Node puis relance la commande."
  exit 1
}

$ApiBase = ${safeBaseUrl}
$EnrollCode = ${safeCode}
$AgentName = $env:COMPUTERNAME
$InstallDir = Join-Path $env:USERPROFILE ".nebula-tunnel"
$AgentFile = Join-Path $InstallDir "tunnel-agent.mjs"
$ConfigFile = Join-Path $InstallDir "agent-config.json"
$LogFile = Join-Path $InstallDir "agent.log"

New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null
Invoke-WebRequest -Uri "$ApiBase/api/tunnels/agent-script" -OutFile $AgentFile

node $AgentFile enroll --server $ApiBase --code $EnrollCode --name $AgentName --config $ConfigFile

$process = Start-Process -FilePath node -ArgumentList @($AgentFile, 'run', '--server', $ApiBase, '--config', $ConfigFile) -RedirectStandardOutput $LogFile -RedirectStandardError $LogFile -WindowStyle Hidden -PassThru
Write-Host "[nebula-tunnel] Agent démarré. PID: $($process.Id)"
Write-Host "[nebula-tunnel] Logs: $LogFile"
`;
}

export async function tunnelRoutes(fastify, options) {
  fastify.get('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const tunnels = isAdmin
        ? await database.getAllTunnels()
        : await database.getAccessibleTunnelsByUserId(userId);

      const withRelations = await Promise.all(tunnels.map(async (tunnel) => ({
        ...tunnel,
        agents: await database.getTunnelAgents(tunnel.id),
        bindings: await database.getTunnelBindings(tunnel.id),
        access: await database.getTunnelAccessEntries(tunnel.id)
      })));

      reply.send({ success: true, tunnels: withRelations, count: withRelations.length });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch tunnels');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch tunnels' });
    }
  });

  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', maxLength: 2000 },
          provider: { type: 'string', enum: ['cloudflare', 'manual'] },
          publicDomain: { type: 'string', minLength: 1, maxLength: 255 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const { name, description, provider = 'cloudflare', publicDomain } = request.body;

      const tunnel = await database.createTunnel({
        userId,
        name,
        description: description || null,
        provider,
        publicDomain: publicDomain || config.tunnels.publicDomain
      });

      await database.createAuditLog({
        userId,
        action: 'tunnel_created',
        entityType: 'tunnel',
        entityId: tunnel.id,
        details: { name: tunnel.name, provider: tunnel.provider, public_domain: tunnel.public_domain },
        ipAddress: request.ip
      });

      reply.code(201).send({ success: true, tunnel });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to create tunnel' });
    }
  });

  fastify.delete('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const tunnel = await database.getTunnelById(tunnelId);

      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }

      if (!await canManageTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to delete this tunnel' });
      }

      await database.deleteTunnel(tunnelId);
      await tunnelRelayService.reloadBindings();

      await database.createAuditLog({
        userId: request.user.id,
        action: 'tunnel_deleted',
        entityType: 'tunnel',
        entityId: tunnelId,
        details: { name: tunnel.name, provider: tunnel.provider, public_domain: tunnel.public_domain },
        ipAddress: request.ip
      });

      reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete tunnel' });
    }
  });

  fastify.get('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const tunnel = await database.getTunnelById(tunnelId);

      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }

      if (!await canAccessTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to access this tunnel' });
      }

      reply.send({
        success: true,
        tunnel: {
          ...tunnel,
          agents: await database.getTunnelAgents(tunnelId),
          bindings: await database.getTunnelBindings(tunnelId),
          access: await database.getTunnelAccessEntries(tunnelId)
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch tunnel');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch tunnel' });
    }
  });

  fastify.post('/:id/enrollment-code', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: { ttlMinutes: { type: 'integer', minimum: 1, maximum: 1440 } },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const tunnel = await database.getTunnelById(tunnelId);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }
      if (!await canManageTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to modify this tunnel' });
      }

      const code = randomCode(12);
      const ttlMinutes = request.body.ttlMinutes || config.tunnels.enrollmentCodeTtlMinutes;
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      const baseUrl = getPublicBaseUrl(request);
      const commands = buildInstallCommands(baseUrl, code);

      await database.updateTunnelEnrollmentCode(tunnelId, sha256(code), expiresAt);

      reply.send({ success: true, code, expiresAt, ...commands });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to generate tunnel enrollment code');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to generate enrollment code' });
    }
  });

  const sendAgentScript = async (request, reply) => {
    try {
      const content = await readAgentScriptContent();
      reply.type('application/javascript; charset=utf-8').send(content);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch tunnel agent script');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch agent script' });
    }
  };

  // Prefer extensionless path to avoid frontend nginx static .js routing conflicts.
  fastify.get('/agent-script', sendAgentScript);
  // Backward compatible endpoint for older installers.
  fastify.get('/agent-script.js', sendAgentScript);

  fastify.get('/install.sh', {
    schema: {
      querystring: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 8, maxLength: 256 }
        },
        additionalProperties: true
      }
    }
  }, async (request, reply) => {
    try {
      const baseUrl = getPublicBaseUrl(request);
      const code = String(request.query.code || '').trim();
      const script = buildLinuxInstallerScript({ baseUrl, code });
      reply.type('text/x-shellscript; charset=utf-8').send(script);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to generate Linux tunnel installer');
      const headers = request?.headers || {};
      const host = String(headers['x-forwarded-host'] || headers.host || `127.0.0.1:${config.port}`).trim();
      const protocol = String(headers['x-forwarded-proto'] || (request?.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim() || 'http';
      const fallbackBaseUrl = `${protocol}://${host}`;
      const code = String(request?.query?.code || '').trim();
      reply.type('text/x-shellscript; charset=utf-8').send(buildLinuxInstallerScript({ baseUrl: fallbackBaseUrl, code }));
    }
  });

  fastify.get('/install.ps1', {
    schema: {
      querystring: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 8, maxLength: 256 }
        },
        additionalProperties: true
      }
    }
  }, async (request, reply) => {
    try {
      const baseUrl = getPublicBaseUrl(request);
      const code = String(request.query.code || '').trim();
      const script = buildWindowsInstallerScript({ baseUrl, code });
      reply.type('text/plain; charset=utf-8').send(script);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to generate Windows tunnel installer');
      const headers = request?.headers || {};
      const host = String(headers['x-forwarded-host'] || headers.host || `127.0.0.1:${config.port}`).trim();
      const protocol = String(headers['x-forwarded-proto'] || (request?.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim() || 'http';
      const fallbackBaseUrl = `${protocol}://${host}`;
      const code = String(request?.query?.code || '').trim();
      reply.type('text/plain; charset=utf-8').send(buildWindowsInstallerScript({ baseUrl: fallbackBaseUrl, code }));
    }
  });

  fastify.post('/enroll', {
    schema: {
      body: {
        type: 'object',
        required: ['code', 'name'],
        properties: {
          code: { type: 'string', minLength: 16, maxLength: 128 },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          platform: { type: 'string', maxLength: 64 },
          osName: { type: 'string', maxLength: 64 },
          arch: { type: 'string', maxLength: 64 },
          version: { type: 'string', maxLength: 32 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const { code, name, platform, osName, arch, version } = request.body;
      const tunnel = await database.consumeTunnelEnrollmentCode(sha256(code));

      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Enrollment code is invalid or expired' });
      }

      const agentToken = randomCode(24);
      const agent = await database.createTunnelAgent({
        tunnelId: tunnel.id,
        name,
        platform,
        osName,
        arch,
        version,
        agentTokenHash: sha256(agentToken)
      });

      await database.createAuditLog({
        userId: tunnel.user_id,
        action: 'tunnel_enrolled',
        entityType: 'tunnel',
        entityId: tunnel.id,
        details: { agent_id: agent.id, agent_name: name },
        ipAddress: request.ip
      });

      reply.send({ success: true, tunnel, agent, agentToken });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to enroll tunnel agent');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to enroll tunnel agent' });
    }
  });

  fastify.get('/:id/bindings', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const tunnel = await database.getTunnelById(tunnelId);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }
      if (!await canAccessTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to access this tunnel' });
      }

      reply.send({
        success: true,
        bindings: await database.getTunnelBindings(tunnelId),
        access: await database.getTunnelAccessEntries(tunnelId)
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch tunnel bindings');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch tunnel bindings' });
    }
  });

  fastify.post('/:id/bindings', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['label', 'localPort'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 255 },
          protocol: { type: 'string', enum: ['tcp', 'udp'] },
          agentId: { type: ['integer', 'null'], minimum: 1 },
          localPort: { type: 'integer', minimum: 1, maximum: 65535 },
          publicPort: { type: ['integer', 'null'], minimum: 1, maximum: 65535 },
          targetHost: { type: 'string', minLength: 1, maxLength: 255 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const tunnel = await database.getTunnelById(tunnelId);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }
      if (!await canManageTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to modify this tunnel' });
      }

      const { label, protocol = 'tcp', localPort, publicPort, targetHost = '127.0.0.1', agentId: requestedAgentId } = request.body;

      let effectiveAgentId = requestedAgentId ?? null;
      if (effectiveAgentId !== null) {
        const agent = await database.getTunnelAgentById(effectiveAgentId);
        if (!agent || Number(agent.tunnel_id) !== tunnelId) {
          return reply.code(400).send({ error: 'Bad Request', message: 'Invalid agent for this tunnel' });
        }
      } else {
        const agents = await database.getTunnelAgents(tunnelId);
        const preferredAgent = agents.find((agent) => agent.status === 'online') || agents[0] || null;
        effectiveAgentId = preferredAgent ? preferredAgent.id : null;
      }

      const effectivePublicPort = publicPort ?? await allocateAvailablePort(protocol, {
        minPort: config.tunnels.portRangeMin,
        maxPort: config.tunnels.portRangeMax
      });
      const publicHostname = buildPublicHostname(tunnel, protocol);

      const binding = await database.createTunnelBinding({
        tunnelId,
        agentId: effectiveAgentId,
        label,
        protocol,
        localPort,
        publicPort: effectivePublicPort,
        publicHostname,
        targetHost
      });

      await tunnelRelayService.reloadBindings();

      await database.createAuditLog({
        userId: request.user.id,
        action: 'tunnel_binding_created',
        entityType: 'tunnel',
        entityId: tunnelId,
        details: { binding_id: binding.id, label, protocol, local_port: localPort, public_port: effectivePublicPort },
        ipAddress: request.ip
      });

      reply.code(201).send({
        success: true,
        binding,
        accessUrl: `${publicHostname}:${effectivePublicPort}`
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create tunnel binding');
      reply.code(500).send({ error: 'Internal Server Error', message: error.message || 'Failed to create tunnel binding' });
    }
  });

  fastify.delete('/:id/bindings/:bindingId', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const bindingId = parseInt(request.params.bindingId, 10);
      const tunnel = await database.getTunnelById(tunnelId);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }
      if (!await canManageTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to modify this tunnel' });
      }

      const binding = await database.getTunnelBindingById(bindingId);
      if (!binding || Number(binding.tunnel_id) !== tunnelId) {
        return reply.code(404).send({ error: 'Not Found', message: 'Binding not found' });
      }

      await database.deleteTunnelBinding(bindingId);
      await tunnelRelayService.reloadBindings();
      reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete tunnel binding');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete tunnel binding' });
    }
  });

  fastify.get('/:id/access', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const tunnel = await database.getTunnelById(tunnelId);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }
      if (!await canManageTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to manage this tunnel' });
      }

      reply.send({
        success: true,
        access: await database.getTunnelAccessEntries(tunnelId)
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch tunnel access');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to fetch tunnel access' });
    }
  });

  fastify.post('/:id/access', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'integer', minimum: 1 },
          role: { type: 'string', enum: ['view', 'manage'] }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const tunnel = await database.getTunnelById(tunnelId);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }
      if (!await canManageTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to manage this tunnel' });
      }

      const { userId, role = 'view' } = request.body;
      const access = await database.grantTunnelAccess({
        tunnelId,
        userId,
        role,
        grantedBy: request.user.id
      });

      reply.code(201).send({ success: true, access });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to grant tunnel access');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to grant tunnel access' });
    }
  });

  fastify.delete('/:id/access/:userId', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const tunnelId = parseInt(request.params.id, 10);
      const userId = parseInt(request.params.userId, 10);
      const tunnel = await database.getTunnelById(tunnelId);
      if (!tunnel) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tunnel not found' });
      }
      if (!await canManageTunnel(tunnel, request.user.id, request.user.role === 'admin')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'You do not have permission to manage this tunnel' });
      }

      await database.revokeTunnelAccess(tunnelId, userId);
      reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to revoke tunnel access');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to revoke tunnel access' });
    }
  });

  fastify.post('/agents/:id/heartbeat', {
    schema: {
      body: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['online', 'offline'] },
          version: { type: 'string', maxLength: 32 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const agentId = parseInt(request.params.id, 10);
      const agentToken = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!agentToken) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Missing agent token' });
      }

      const agent = await database.getTunnelAgentById(agentId);
      if (!agent || agent.agent_token_hash !== sha256(agentToken)) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid agent token' });
      }

      const updatedAgent = await database.updateTunnelAgentHeartbeat(agentId, { status: request.body.status || 'online' });
      const bindings = await database.getTunnelBindingsByAgentId(agentId);

      reply.send({
        success: true,
        agent: updatedAgent,
        tunnel: await database.getTunnelById(agent.tunnel_id),
        bindings
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to process tunnel heartbeat');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to process tunnel heartbeat' });
    }
  });
}
