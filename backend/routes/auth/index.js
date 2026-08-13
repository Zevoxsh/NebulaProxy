// @ts-check
import { basicRoutes } from './basic.js';
import { passkeyRoutes } from './passkeys.js';
import { mfaRoutes } from './mfa.js';
import { passwordRoutes } from './password.js';
import { adminPinRoutes } from './adminPin.js';
import { oidcRoutes } from './oidc.js';

export async function authRoutes(fastify, _options) {
  await fastify.register(basicRoutes);
  await fastify.register(passkeyRoutes);
  await fastify.register(mfaRoutes);
  await fastify.register(passwordRoutes);
  await fastify.register(adminPinRoutes);
  await fastify.register(oidcRoutes);
}
