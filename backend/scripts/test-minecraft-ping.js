#!/usr/bin/env node
/**
 * Test script for Minecraft Server List Ping
 *
 * Usage:
 *   node test-minecraft-ping.js
 *   node test-minecraft-ping.js mc.hypixel.net 25565
 *   node test-minecraft-ping.js localhost 25565
 */

import { minecraftServerListPing } from './services/minecraftServerListPing.js';

const args = process.argv.slice(2);
const hostname = args[0] || 'mc.hypixel.net';
const port = parseInt(args[1]) || 25565;
const timeout = 5000;

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║     Minecraft Server List Ping - Test Tool            ║');
console.log('╚════════════════════════════════════════════════════════╝');
console.log('');
console.log(`[TARGET] Target: ${hostname}:${port}`);
console.log(`[TIMEOUT]  Timeout: ${timeout}ms`);
console.log('');
console.log('Pinging server...');
console.log('');

const startTime = Date.now();

minecraftServerListPing(hostname, port, timeout)
  .then((result) => {
    const totalTime = Date.now() - startTime;

    if (result.success) {
      console.log('┌────────────────────────────────────────────────────┐');
      console.log('│  [OK] SERVER IS ONLINE                               │');
      console.log('└────────────────────────────────────────────────────┘');
      console.log('');
      console.log('[INFO] Server Information:');
      console.log('  ├─ Version:     ' + result.version);
      console.log('  ├─ Protocol:    ' + result.protocol);
      console.log('  ├─ Players:     ' + result.onlinePlayers + '/' + result.maxPlayers + ' online');
      console.log('  ├─ Description: ' + (result.description || 'No description').replace(/\n/g, ' '));
      console.log('  └─ Ping:        ' + result.responseTime + 'ms');
      console.log('');

      if (result.playerSample && result.playerSample.length > 0) {
        console.log('👥 Online Players (sample):');
        result.playerSample.forEach((player, index) => {
          const prefix = index === result.playerSample.length - 1 ? '  └─' : '  ├─';
          console.log(`${prefix} ${player.name}`);
        });
        console.log('');
      }

      if (result.favicon) {
        console.log('[ICON]  Server Icon: Available (base64 encoded)');
        console.log('   Length: ' + result.favicon.length + ' characters');
        console.log('');
      }

      // Player ratio indicator
      const fillRate = result.onlinePlayers / result.maxPlayers;
      const bars = Math.round(fillRate * 20);
      const emptyBars = 20 - bars;
      const barString = '█'.repeat(bars) + '░'.repeat(emptyBars);

      console.log('📈 Server Load:');
      console.log(`  [${barString}] ${Math.round(fillRate * 100)}%`);
      console.log('');

      if (fillRate > 0.9) {
        console.log('[WARNING]  Warning: Server is almost full!');
        console.log('');
      }

      console.log('✨ Total execution time: ' + totalTime + 'ms');
      console.log('');
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  Status: PASS [OK]                                       ║');
      console.log('╚════════════════════════════════════════════════════════╝');

      process.exit(0);
    } else {
      console.log('┌────────────────────────────────────────────────────┐');
      console.log('│  [FAIL] SERVER IS OFFLINE OR UNREACHABLE               │');
      console.log('└────────────────────────────────────────────────────┘');
      console.log('');
      console.log('[FAIL] Error Details:');
      console.log('  ├─ Error:    ' + result.error);
      console.log('  ├─ Ping:     ' + result.responseTime + 'ms');
      console.log('  └─ Total:    ' + totalTime + 'ms');
      console.log('');
      console.log('💡 Troubleshooting:');
      console.log('  • Check if server is online');
      console.log('  • Verify hostname and port are correct');
      console.log('  • Check firewall rules');
      console.log('  • Ensure server accepts status requests');
      console.log('');
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║  Status: FAIL [FAIL]                                       ║');
      console.log('╚════════════════════════════════════════════════════════╝');

      process.exit(1);
    }
  })
  .catch((error) => {
    console.log('┌────────────────────────────────────────────────────┐');
    console.log('│  💥 UNEXPECTED ERROR                               │');
    console.log('└────────────────────────────────────────────────────┘');
    console.log('');
    console.log('Error:', error.message);
    console.log('');
    console.log('Stack trace:');
    console.log(error.stack);
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  Status: ERROR 💥                                      ║');
    console.log('╚════════════════════════════════════════════════════════╝');

    process.exit(2);
  });
