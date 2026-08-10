// Setup Wizard JavaScript
let currentStep = 1;
let config = {
  dbMode: 'auto',
  authMode: 'local',
  database: {},
  auth: {},
  services: {},
  advanced: {}
};

function getFrontendUrl() {
  const url = new URL(window.location.href);
  url.port = '3001';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

// Initialize on load
window.addEventListener('DOMContentLoaded', async () => {
  generateSecrets();
  await detectDocker();
  setupDragAndDrop();
});

// Drag and drop for config file
function setupDragAndDrop() {
  const body = document.body;
  const overlay = document.getElementById('dragOverlay');
  let dragCounter = 0;

  body.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (dragCounter === 1) {
      overlay.classList.add('active');
    }
  });

  body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      overlay.classList.remove('active');
    }
  });

  body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  body.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    overlay.classList.remove('active');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.env') || file.name.endsWith('.json')) {
        await handleConfigFileDrop(file);
      } else {
        showNotification('Please drop a .env or .json configuration file', 'error');
      }
    }
  });
}

async function handleConfigFileDrop(file) {
  try {
    const text = await file.text();
    let importedConfig;

    if (file.name.endsWith('.json')) {
      importedConfig = JSON.parse(text);
    } else {
      importedConfig = parseEnvFile(text);
    }

    // Show confirmation
    if (confirm(`Import configuration from ${file.name}? This will skip the wizard and apply settings directly.`)) {
      showNotification('Importing configuration...', 'info');
      await applyAndFinish(importedConfig);
    }
  } catch (error) {
    showNotification(`Failed to import config: ${error.message}`, 'error');
  }
}

function parseEnvFile(content) {
  const config = {};
  const lines = content.split('\n');

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) config[key] = value;
  });

  return config;
}

async function applyAndFinish(importedConfig) {
  try {
    const response = await fetch('/api/setup/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importedConfig)
    });

    const result = await response.json();

    if (result.success) {
      showNotification('Configuration imported successfully! Starting services...', 'success');
      setTimeout(() => {
        window.location.href = getFrontendUrl();
      }, 2000);
    } else {
      showNotification(`Import failed: ${getSetupErrorMessage(result, 'Unknown import error')}`, 'error');
    }
  } catch (error) {
    showNotification(`Import failed: ${error.message}`, 'error');
  }
}

function getSetupErrorMessage(result, fallback = 'Unknown error') {
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    return result.errors.join(', ');
  }

  if (typeof result?.error === 'string' && result.error.trim()) {
    return result.error;
  }

  if (typeof result?.message === 'string' && result.message.trim()) {
    return result.message;
  }

  return fallback;
}

// Generate random secrets
function generateSecrets() {
  document.getElementById('jwtSecret').value = generateSecret(64);
}

function generateSecret(length = 64) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Detect Docker availability
async function detectDocker() {
  try {
    const response = await fetch('/api/setup/detect/docker');
    const data = await response.json();

    const statusDiv = document.getElementById('dbDetectionStatus');

    if (data.available) {
      statusDiv.innerHTML = `
        <div class="status-badge status-success">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
          Docker detected - Automatic setup available
        </div>
      `;
      document.getElementById('dbAutoStatus').classList.remove('hidden');
      selectDbMode('auto'); // Auto-select
    } else {
      statusDiv.innerHTML = `
        <div class="status-badge status-warning">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
          Docker not available - Manual configuration required
        </div>
      `;
      selectDbMode('manual');
    }
  } catch (error) {
    console.error('Failed to detect Docker:', error);
  }
}

// Database mode selection
function selectDbMode(mode) {
  config.dbMode = mode;

  const autoCard = document.getElementById('dbAutoCard');
  const manualCard = document.getElementById('dbManualCard');
  const manualForm = document.getElementById('dbManualForm');

  autoCard.classList.remove('selected');
  manualCard.classList.remove('selected');

  if (mode === 'auto') {
    autoCard.classList.add('selected');
    manualForm.classList.add('hidden');
  } else {
    manualCard.classList.add('selected');
    manualForm.classList.remove('hidden');
  }
}

// Test database connection
async function testDbConnection() {
  const host = document.getElementById('dbHost').value;
  const port = document.getElementById('dbPort').value;
  const database = document.getElementById('dbName').value;
  const user = document.getElementById('dbUser').value;
  const password = document.getElementById('dbPassword').value;

  const resultDiv = document.getElementById('dbTestResult');
  resultDiv.innerHTML = '<div class="status-badge status-info"><span class="spinner"></span> Testing connection...</div>';

  try {
    const response = await fetch('/api/setup/test/postgres', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, database, user, password })
    });

    const data = await response.json();

    if (data.success) {
      resultDiv.innerHTML = `
        <div class="status-badge status-success">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
          Connection successful
        </div>
      `;
    } else {
      resultDiv.innerHTML = `
        <div class="status-badge status-error">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
          Connection failed: ${data.error}
        </div>
      `;
    }
  } catch (error) {
    resultDiv.innerHTML = `
      <div class="status-badge status-error">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
        Test failed: ${error.message}
      </div>
    `;
  }
}

// Authentication mode selection
function selectAuthMode(mode) {
  config.authMode = mode;

  const localCard = document.getElementById('authLocalCard');
  const ldapCard = document.getElementById('authLdapCard');
  const ldapForm = document.getElementById('authLdapForm');

  localCard.classList.remove('selected');
  ldapCard.classList.remove('selected');

  if (mode === 'local') {
    localCard.classList.add('selected');
    ldapForm.classList.add('hidden');
  } else {
    ldapCard.classList.add('selected');
    ldapForm.classList.remove('hidden');
  }
}

// Toggle SMTP form
function toggleSmtpForm() {
  const enabled = document.getElementById('smtpEnabled').checked;
  const form = document.getElementById('smtpForm');

  if (enabled) {
    form.classList.remove('hidden');
  } else {
    form.classList.add('hidden');
  }
}

// Navigation
function nextStep() {
  if (currentStep < 4) {
    // Validate current step
    if (!validateStep(currentStep)) {
      return;
    }

    currentStep++;
    updateStepDisplay();

    if (currentStep === 4) {
      showConfigSummary();
    }
  }
}

function previousStep() {
  if (currentStep > 1) {
    currentStep--;
    updateStepDisplay();
  }
}

function validateStep(step) {
  if (step === 1) {
    if (config.dbMode === 'manual') {
      const host = document.getElementById('dbHost').value;
      const password = document.getElementById('dbPassword').value;

      if (!host || !password) {
        showNotification('Please fill in all database fields', 'error');
        return false;
      }
    }
  }

  if (step === 2) {
    if (config.authMode === 'ldap') {
      const host = document.getElementById('ldapHost').value;
      const baseDN = document.getElementById('ldapBaseDN').value;

      if (!host || !baseDN) {
        showNotification('Please fill in required LDAP fields', 'error');
        return false;
      }
    }
  }

  return true;
}

function updateStepDisplay() {
  // Update step indicators
  document.querySelectorAll('.step').forEach((step, index) => {
    const stepNum = index + 1;
    step.classList.remove('active', 'completed');

    if (stepNum < currentStep) {
      step.classList.add('completed');
    } else if (stepNum === currentStep) {
      step.classList.add('active');
    }
  });

  // Update step content
  document.querySelectorAll('.step-content').forEach((content, index) => {
    const stepNum = index + 1;
    content.classList.remove('active');

    if (stepNum === currentStep) {
      content.classList.add('active');
    }
  });

  // Update buttons
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const finishBtn = document.getElementById('finishBtn');

  prevBtn.disabled = currentStep === 1;

  if (currentStep === 4) {
    nextBtn.classList.add('hidden');
    finishBtn.classList.remove('hidden');
  } else {
    nextBtn.classList.remove('hidden');
    finishBtn.classList.add('hidden');
  }
}

function showConfigSummary() {
  const summaryDiv = document.getElementById('configSummary');
  const summary = [];

  // Database
  if (config.dbMode === 'auto') {
    summary.push({
      icon: '[SAVE]',
      label: 'Database',
      value: 'Automatic PostgreSQL container'
    });
  } else {
    const host = document.getElementById('dbHost').value;
    const database = document.getElementById('dbName').value;
    summary.push({
      icon: '[SAVE]',
      label: 'Database',
      value: `${host} / ${database}`
    });
  }

  // Authentication
  summary.push({
    icon: '🔐',
    label: 'Authentication',
    value: config.authMode === 'local' ? 'Local (built-in)' : 'LDAP/Active Directory'
  });

  // Redis
  const redisHost = document.getElementById('redisHost').value;
  summary.push({
    icon: '🔴',
    label: 'Redis',
    value: `${redisHost}:${document.getElementById('redisPort').value}`
  });

  // SMTP
  const smtpEnabled = document.getElementById('smtpEnabled').checked;
  summary.push({
    icon: '[EMAIL]',
    label: 'Email',
    value: smtpEnabled ? document.getElementById('smtpHost').value : 'Disabled'
  });

  // Render summary
  summaryDiv.innerHTML = summary.map(item => `
    <div class="flex items-center gap-3 p-3 bg-white/5 rounded">
      <span class="text-2xl">${item.icon}</span>
      <div class="flex-1">
        <div class="text-white/60 text-xs">${item.label}</div>
        <div class="text-white font-medium">${item.value}</div>
      </div>
    </div>
  `).join('');
}

async function finishSetup() {
  const finishBtn = document.getElementById('finishBtn');
  const statusDiv = document.getElementById('finalizeStatus');

  finishBtn.disabled = true;
  finishBtn.innerHTML = '<span class="flex items-center gap-2">Setting up<span class="spinner"></span></span>';

  statusDiv.innerHTML = '<div class="status-badge status-info"><span class="spinner"></span> Configuring services...</div>';

  try {
    // Collect all configuration
    const finalConfig = await buildFinalConfig();

    // Send to backend
    const response = await fetch('/api/setup/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalConfig)
    });

    const result = await response.json();

    if (result.success) {
      statusDiv.innerHTML = `
        <div class="status-badge status-success">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
          Setup completed successfully! Redirecting...
        </div>
      `;

      setTimeout(() => {
        window.location.href = getFrontendUrl();
      }, 2000);
    } else {
      statusDiv.innerHTML = `
        <div class="status-badge status-error">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
          Setup failed: ${getSetupErrorMessage(result, 'Unknown setup error')}
        </div>
      `;

      finishBtn.disabled = false;
      finishBtn.innerHTML = '<span class="flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>Finish Setup</span>';
    }
  } catch (error) {
    statusDiv.innerHTML = `
      <div class="status-badge status-error">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
        Setup failed: ${error.message}
      </div>
    `;

    finishBtn.disabled = false;
    finishBtn.innerHTML = '<span class="flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>Finish Setup</span>';
  }
}

async function buildFinalConfig() {
  const config = {
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: document.getElementById('apiPort').value || '3000',
    FRONTEND_PORT: '3001',
    FRONTEND_BUILD_ON_START: 'false',
    FRONTEND_DIST_PATH: 'frontend/dist',

    JWT_SECRET: document.getElementById('jwtSecret').value,
    PROXY_CHECK_TOKEN: generateSecret(32),
    AUTH_MODE: document.getElementById('authLocalCard').classList.contains('selected') ? 'local' : 'ldap',

    // Database
    DB_MODE: document.getElementById('dbAutoCard').classList.contains('selected') ? 'auto' : 'manual',
    DB_TYPE: 'postgresql',

    // Proxy
    PROXY_ENABLED: 'true',
    ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:3000,http://localhost:3001',
    ALLOW_PRIVATE_BACKENDS: 'false',

    // Health Checks
    HEALTHCHECK_INTERVAL_SECONDS: '5',
    HEALTHCHECK_CONCURRENCY: '10',
    HEALTHCHECK_TIMEOUT_MS: '10000',
    HEALTHCHECK_CLEANUP_EVERY: '100',

    // Logs
    LOG_RETENTION_DAYS: '30',
    LOG_CLEANUP_INTERVAL_HOURS: '24',

    // SSL/ACME
    ACME_EMAIL: document.getElementById('acmeEmail').value,

    // Frontend
    VITE_API_BASE_URL: '/api',
    ALLOW_INSECURE_BACKENDS: 'false',
  };

  // Manual database config
  if (config.DB_MODE === 'manual') {
    config.DB_HOST = document.getElementById('dbHost').value;
    config.DB_PORT = document.getElementById('dbPort').value || '5432';
    config.DB_NAME = document.getElementById('dbName').value || 'nebulaproxy';
    config.DB_USER = document.getElementById('dbUser').value || 'nebulaproxy';
    config.DB_PASSWORD = document.getElementById('dbPassword').value;
  }

  // LDAP config
  if (config.AUTH_MODE === 'ldap') {
    const ldapHost = document.getElementById('ldapHost').value;
    const ldapPort = document.getElementById('ldapPort').value || '389';
    config.LDAP_URL = `ldap://${ldapHost}:${ldapPort}`;
    config.LDAP_BASE_DN = document.getElementById('ldapBaseDN').value;
    config.LDAP_BIND_DN = document.getElementById('ldapBindDN').value;
    config.LDAP_BIND_PASSWORD = document.getElementById('ldapBindPassword').value;
    config.LDAP_ADMIN_GROUP = document.getElementById('ldapAdminGroup')?.value || '';
    config.LDAP_USER_GROUP = document.getElementById('ldapUserGroup')?.value || '';
    config.LDAP_REQUIRE_GROUP = document.getElementById('ldapRequireGroup')?.checked ? 'true' : 'false';
  }

  // SMTP config
  const smtpEnabled = document.getElementById('smtpEnabled').checked;
  if (smtpEnabled) {
    config.SMTP_HOST = document.getElementById('smtpHost').value;
    config.SMTP_PORT = document.getElementById('smtpPort').value || '587';
    config.SMTP_USER = document.getElementById('smtpUser').value;
    config.SMTP_PASS = document.getElementById('smtpPassword').value;
    config.SMTP_SECURE = 'false';
    config.SMTP_TLS_REJECT_UNAUTHORIZED = 'true';
    config.SMTP_FROM_NAME = 'NebulaProxy';
    config.SMTP_FROM_EMAIL = document.getElementById('smtpFromEmail')?.value || '';
  } else {
    config.SMTP_HOST = '';
    config.SMTP_PORT = '587';
    config.SMTP_SECURE = 'false';
    config.SMTP_USER = '';
    config.SMTP_PASS = '';
    config.SMTP_TLS_REJECT_UNAUTHORIZED = 'true';
    config.SMTP_FROM_NAME = 'NebulaProxy';
    config.SMTP_FROM_EMAIL = '';
  }

  return config;
}

function showNotification(message, type = 'info') {
  // Simple notification implementation
  alert(message);
}
