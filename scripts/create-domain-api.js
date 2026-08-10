// Create domains via NebulaProxy API using an API key (Node 18+)
// Usage: NEBULA_API_KEY="ta_cle_admin" node create-domain.js

const API_BASE = process.env.NEBULA_API_BASE || 'http://localhost:3000/api';
const API_KEY = 'nbp_live_d0a67d61791892b1ee19098d4b831a2fffcf3000e94a3fb451c9603d181a3066';

if (!API_KEY) {
  console.error('NEBULA_API_KEY manquant');
  process.exit(1);
}

const tests = [
  {
    name: 'http',
    payload: {
      hostname: 'http-test.example.com',
      backendUrl: 'http://1.1.1.1',
      backendPort: '80',
      proxyType: 'http',
      sslEnabled: false
    }
  },
  {
    name: 'https',
    payload: {
      hostname: 'https-test.example.com',
      backendUrl: 'https://1.1.1.1',
      backendPort: '443',
      proxyType: 'http',
      sslEnabled: false
    }
  },
  {
    name: 'tcp',
    portCheck: { port: 23456, protocol: 'tcp' },
    payload: {
      hostname: 'tcp-test.example.com',
      backendUrl: 'tcp://1.1.1.1',
      backendPort: '443',
      proxyType: 'tcp',
      externalPort: 23456
    }
  },
  {
    name: 'udp',
    portCheck: { port: 23457, protocol: 'udp' },
    payload: {
      hostname: 'udp-test.example.com',
      backendUrl: 'udp://1.1.1.1',
      backendPort: '53',
      proxyType: 'udp',
      externalPort: 23457
    }
  },
  {
    name: 'minecraft',
    payload: {
      hostname: 'mc-test.example.com',
      backendUrl: 'tcp://1.1.1.1',
      backendPort: '25565',
      proxyType: 'minecraft'
    }
  }
];

async function apiGet(url) {
  const res = await fetch(url, {
    headers: { 'X-API-Key': API_KEY }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { status: res.status, data };
  }
  return data;
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { status: res.status, data };
  }
  return data;
}

async function createDomain(test) {
  try {
    if (test.portCheck) {
      const { port, protocol } = test.portCheck;
      const check = await apiGet(`${API_BASE}/domains/ports/check?port=${port}&protocol=${protocol}`);
      console.log(`[${test.name}] Port check`, check);
      if (!check.free) {
        console.log(`[${test.name}] Port non libre`, check);
        return;
      }
    }

    const created = await apiPost(`${API_BASE}/domains`, test.payload);
    console.log(`[${test.name}] OK`, created.domain?.id || created);
  } catch (err) {
    console.error(`[${test.name}] ERROR`, err.status || 'ERR', err.data || err);
  }
}

(async () => {
  for (const t of tests) {
    await createDomain(t);
  }
})();
