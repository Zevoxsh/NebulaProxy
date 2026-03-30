#!/usr/bin/env node

/**
 * Configuration Manager CLI
 * Manage NebulaProxy configuration stored in Redis
 */

import Redis from 'ioredis';
import { createInterface } from 'readline';

const REDIS_CONFIG_KEY = 'nebulaproxy:config';

// Command line arguments
const command = process.argv[2];
const args = process.argv.slice(3);

// Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

// Create readline interface
const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Connect to Redis
async function connectRedis() {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = process.env.REDIS_PORT || 6379;
  const redisPassword = process.env.REDIS_PASSWORD || '';
  const redisDb = process.env.REDIS_DB || 0;

  log(`\nConnecting to Redis at ${redisHost}:${redisPort}...`, colors.cyan);

  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    password: redisPassword || undefined,
    db: redisDb,
    retryStrategy: () => null
  });

  try {
    await redis.ping();
    log('✓ Connected to Redis\n', colors.green);
    return redis;
  } catch (error) {
    log('✗ Failed to connect to Redis', colors.red);
    log(`Error: ${error.message}\n`, colors.red);
    process.exit(1);
  }
}

// Get current configuration
async function getConfig(redis) {
  const configJson = await redis.get(REDIS_CONFIG_KEY);
  if (!configJson) {
    return null;
  }
  return JSON.parse(configJson);
}

// Save configuration
async function saveConfig(redis, config) {
  await redis.set(REDIS_CONFIG_KEY, JSON.stringify(config, null, 2));
}

// Show current configuration
async function showConfig(redis) {
  const config = await getConfig(redis);

  if (!config) {
    log('No configuration found in Redis.', colors.yellow);
    log('Run the setup wizard to create initial configuration.\n', colors.yellow);
    return;
  }

  log('Current Configuration:', colors.bright);
  log('═'.repeat(60), colors.cyan);

  // Mask sensitive data
  const maskedConfig = JSON.parse(JSON.stringify(config));
  if (maskedConfig.database?.password) {
    maskedConfig.database.password = '***MASKED***';
  }
  if (maskedConfig.redis?.password) {
    maskedConfig.redis.password = '***MASKED***';
  }
  if (maskedConfig.jwtSecret) {
    maskedConfig.jwtSecret = '***MASKED***';
  }
  if (maskedConfig.ldap?.bindPassword) {
    maskedConfig.ldap.bindPassword = '***MASKED***';
  }
  if (maskedConfig.smtp?.password) {
    maskedConfig.smtp.password = '***MASKED***';
  }

  console.log(JSON.stringify(maskedConfig, null, 2));
  log('\n' + '═'.repeat(60), colors.cyan);
}

// Update a configuration value
async function updateConfig(redis, path, value) {
  const config = await getConfig(redis);

  if (!config) {
    log('No configuration found. Cannot update.', colors.red);
    return;
  }

  // Parse the path (e.g., "database.password" -> ["database", "password"])
  const keys = path.split('.');
  let current = config;

  // Navigate to the parent object
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) {
      log(`Path not found: ${keys.slice(0, i + 1).join('.')}`, colors.red);
      return;
    }
    current = current[keys[i]];
  }

  const lastKey = keys[keys.length - 1];
  const oldValue = current[lastKey];

  // Convert value to appropriate type
  let newValue = value;
  if (value === 'true') newValue = true;
  else if (value === 'false') newValue = false;
  else if (value === 'null') newValue = null;
  else if (!isNaN(value) && value !== '') newValue = Number(value);

  current[lastKey] = newValue;

  await saveConfig(redis, config);

  log('\n✓ Configuration updated successfully!', colors.green);
  log(`\nPath: ${path}`, colors.cyan);
  log(`Old value: ${JSON.stringify(oldValue)}`, colors.yellow);
  log(`New value: ${JSON.stringify(newValue)}`, colors.green);
  log('\nWARNING:  Restart the application for changes to take effect.\n', colors.yellow);
}

// Reset configuration
async function resetConfig(redis) {
  log('\nWARNING:  WARNING: This will delete all configuration from Redis!', colors.red);
  log('The setup wizard will run on next startup.\n', colors.yellow);

  const answer = await question('Are you sure? (yes/no): ');

  if (answer.toLowerCase() === 'yes') {
    await redis.del(REDIS_CONFIG_KEY);
    log('\n✓ Configuration deleted. Run the setup wizard on next startup.\n', colors.green);
  } else {
    log('\nCancelled.\n', colors.yellow);
  }
}

// Interactive configuration editor
async function interactiveEdit(redis) {
  const config = await getConfig(redis);

  if (!config) {
    log('No configuration found. Run setup wizard first.', colors.red);
    return;
  }

  log('\n' + colors.bright + 'Interactive Configuration Editor' + colors.reset);
  log('═'.repeat(60), colors.cyan);
  log('Common settings you might want to change:\n');

  const options = [
    { label: 'Database Password', path: 'database.password', current: '***' },
    { label: 'Database Host', path: 'database.host', current: config.database?.host },
    { label: 'Database Port', path: 'database.port', current: config.database?.port },
    { label: 'Database Name', path: 'database.name', current: config.database?.name },
    { label: 'Database User', path: 'database.user', current: config.database?.user },
    { label: 'JWT Secret', path: 'jwtSecret', current: '***' },
    { label: 'LDAP Server', path: 'ldap.url', current: config.ldap?.url },
    { label: 'LDAP Bind DN', path: 'ldap.bindDN', current: config.ldap?.bindDN },
    { label: 'SMTP Host', path: 'smtp.host', current: config.smtp?.host },
    { label: 'SMTP Port', path: 'smtp.port', current: config.smtp?.port },
    { label: 'Admin Email', path: 'adminEmail', current: config.adminEmail }
  ];

  options.forEach((opt, i) => {
    console.log(`${i + 1}. ${opt.label.padEnd(25)} = ${opt.current || '(not set)'}`);
  });

  console.log('0. Exit\n');

  const choice = await question('Select option to edit (0-' + options.length + '): ');
  const index = parseInt(choice) - 1;

  if (choice === '0') {
    log('\nExiting.\n', colors.yellow);
    return;
  }

  if (index >= 0 && index < options.length) {
    const option = options[index];
    const newValue = await question(`\nEnter new value for ${option.label}: `);

    if (newValue) {
      await updateConfig(redis, option.path, newValue);
    } else {
      log('\nCancelled.\n', colors.yellow);
    }
  } else {
    log('\nInvalid option.\n', colors.red);
  }
}

// Export configuration to file
async function exportConfig(redis, filename) {
  const config = await getConfig(redis);

  if (!config) {
    log('No configuration found.', colors.red);
    return;
  }

  const fs = await import('fs');
  fs.writeFileSync(filename, JSON.stringify(config, null, 2));
  log(`\n✓ Configuration exported to: ${filename}\n`, colors.green);
  log('WARNING:  This file contains sensitive data. Keep it secure!\n', colors.yellow);
}

// Import configuration from file
async function importConfig(redis, filename) {
  const fs = await import('fs');

  if (!fs.existsSync(filename)) {
    log(`File not found: ${filename}`, colors.red);
    return;
  }

  const configJson = fs.readFileSync(filename, 'utf8');
  const config = JSON.parse(configJson);

  log('\nWARNING:  This will replace the current configuration!', colors.yellow);
  const answer = await question('Continue? (yes/no): ');

  if (answer.toLowerCase() === 'yes') {
    await saveConfig(redis, config);
    log('\n✓ Configuration imported successfully!\n', colors.green);
    log('WARNING:  Restart the application for changes to take effect.\n', colors.yellow);
  } else {
    log('\nCancelled.\n', colors.yellow);
  }
}

// Show help
function showHelp() {
  log('\nNebulaProxy Configuration Manager', colors.bright);
  log('═'.repeat(60), colors.cyan);
  log('\nUsage: node config-manager.js <command> [options]\n');
  log('Commands:', colors.bright);
  log('  show                  Show current configuration');
  log('  edit                  Interactive configuration editor');
  log('  set <path> <value>    Set a configuration value');
  log('  reset                 Delete configuration (run setup wizard again)');
  log('  export <file>         Export configuration to JSON file');
  log('  import <file>         Import configuration from JSON file');
  log('  help                  Show this help message');

  log('\nExamples:', colors.bright);
  log('  node config-manager.js show');
  log('  node config-manager.js edit');
  log('  node config-manager.js set database.password myNewPassword');
  log('  node config-manager.js set database.host 192.168.1.100');
  log('  node config-manager.js export config-backup.json');
  log('  node config-manager.js import config-backup.json');
  log('  node config-manager.js reset\n');

  log('Environment Variables:', colors.bright);
  log('  REDIS_HOST     Redis host (default: localhost)');
  log('  REDIS_PORT     Redis port (default: 6379)');
  log('  REDIS_PASSWORD Redis password (optional)');
  log('  REDIS_DB       Redis database number (default: 0)\n');
}

// Main
async function main() {
  if (!command || command === 'help') {
    showHelp();
    rl.close();
    return;
  }

  const redis = await connectRedis();

  try {
    switch (command) {
      case 'show':
        await showConfig(redis);
        break;

      case 'edit':
        await interactiveEdit(redis);
        break;

      case 'set':
        if (args.length < 2) {
          log('Usage: node config-manager.js set <path> <value>', colors.red);
          log('Example: node config-manager.js set database.password myPassword\n', colors.yellow);
        } else {
          await updateConfig(redis, args[0], args[1]);
        }
        break;

      case 'reset':
        await resetConfig(redis);
        break;

      case 'export':
        if (args.length < 1) {
          log('Usage: node config-manager.js export <filename>', colors.red);
        } else {
          await exportConfig(redis, args[0]);
        }
        break;

      case 'import':
        if (args.length < 1) {
          log('Usage: node config-manager.js import <filename>', colors.red);
        } else {
          await importConfig(redis, args[0]);
        }
        break;

      default:
        log(`Unknown command: ${command}\n`, colors.red);
        showHelp();
    }
  } catch (error) {
    log(`\nError: ${error.message}`, colors.red);
    console.error(error);
  } finally {
    redis.disconnect();
    rl.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
