import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import net from 'net';
import tls from 'tls';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const host = process.env.SMTP_HOST || '';
const port = Number(process.env.SMTP_PORT || '587');
const secure = process.env.SMTP_SECURE === 'true';
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || '10000');
const rejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false';

if (!host) {
  console.error('[SMTP TEST] SMTP_HOST is required.');
  process.exit(1);
}

const maskSecret = (value) => {
  if (!value) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
};

console.log('[SMTP TEST] Config');
console.log(`  host: ${host}`);
console.log(`  port: ${port}`);
console.log(`  secure: ${secure}`);
console.log(`  user: ${user || '(none)'}`);
console.log(`  pass: ${pass ? maskSecret(pass) : '(none)'}`);
console.log(`  timeout: ${timeoutMs}ms`);
console.log(`  tls.rejectUnauthorized: ${rejectUnauthorized}`);

const connectTcp = () => new Promise((resolve, reject) => {
  const onError = (error) => {
    reject(error);
  };

  if (secure) {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized,
        timeout: timeoutMs
      },
      () => {
        console.log('[SMTP TEST] TLS connect: OK');
        socket.end();
        resolve();
      }
    );

    socket.on('error', onError);
    socket.on('timeout', () => {
      socket.destroy(new Error('TLS connection timed out'));
    });
    return;
  }

  const socket = net.connect({ host, port }, () => {
    console.log('[SMTP TEST] TCP connect: OK');
    socket.end();
    resolve();
  });

  socket.setTimeout(timeoutMs);
  socket.on('error', onError);
  socket.on('timeout', () => {
    socket.destroy(new Error('TCP connection timed out'));
  });
});

const verifySmtp = async () => {
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    tls: {
      rejectUnauthorized
    }
  });

  await transport.verify();
  console.log('[SMTP TEST] Nodemailer verify: OK');
};

try {
  await connectTcp();
  await verifySmtp();
  console.log('[SMTP TEST] Result: SUCCESS');
} catch (error) {
  console.error('[SMTP TEST] Result: FAILED');
  console.error('  message:', error.message || error);
  if (error.code) {
    console.error('  code:', error.code);
  }
  if (error.command) {
    console.error('  command:', error.command);
  }
  process.exit(1);
}
