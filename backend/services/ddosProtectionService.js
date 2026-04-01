import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { database } from './database.js';

// ── Blocklist sources ───────────────────────────────────────────────────────

const BLOCKLIST_SOURCES = [
  { key: 'blocklist_de',     url: 'https://lists.blocklist.de/lists/all.txt' },
  { key: 'emerging_threats', url: 'https://rules.emergingthreats.net/blockrules/compromised-ips.txt' },
  { key: 'ci_badguys',       url: 'https://cinsscore.com/list/ci-badguys.txt' }
];

const SYNC_INTERVAL_MS   = 6 * 60 * 60 * 1000; // 6 hours
const CHALLENGE_SECRET   = crypto.randomBytes(32).toString('hex');
const EVENT_LOG_INTERVAL = 500; // ms — debounce event inserts

// ── IP / CIDR utilities ─────────────────────────────────────────────────────

function ipToLong(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const oct = parseInt(p, 10);
    if (isNaN(oct) || oct < 0 || oct > 255) return null;
    n = (n * 256) + oct;
  }
  return n >>> 0;
}

function cidrContains(cidr, ipLong) {
  if (cidr.includes('/')) {
    const [base, bits] = cidr.split('/');
    const baseLong = ipToLong(base);
    if (baseLong === null) return false;
    const prefixLen = parseInt(bits, 10);
    if (prefixLen === 0) return true;
    const mask = (~0 << (32 - prefixLen)) >>> 0;
    return (baseLong & mask) === (ipLong & mask);
  }
  const baseLong = ipToLong(cidr);
  return baseLong !== null && baseLong === ipLong;
}

function isPrivateIp(ip) {
  if (!ip || ip === '::1' || ip === 'localhost') return true;
  const clean = ip.replace(/^::ffff:/, '');
  if (clean === '127.0.0.1') return true;
  const long = ipToLong(clean);
  if (long === null) return false; // IPv6 — not blocking
  return cidrContains('10.0.0.0/8', long) ||
         cidrContains('172.16.0.0/12', long) ||
         cidrContains('192.168.0.0/16', long);
}

function parseIpList(text) {
  const entries = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const entry = trimmed.split(/[\s,;#]/)[0].split(':')[0].trim(); // strip port if any
    if (entry && /^[\d.:/]+$/.test(entry)) entries.add(entry);
  }
  return entries;
}

// ── Challenge utilities ─────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Normalize an answer for comparison (lowercase, no accent, no spaces)
function normalizeAnswer(a) {
  return String(a).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

// Build a challenge token — answer is NOT stored in plaintext (HMAC only)
function buildChallengeToken(ip, answer) {
  const expires = Math.floor(Date.now() / 1000) + 600;
  const norm    = normalizeAnswer(answer);
  const sig     = crypto.createHmac('sha256', CHALLENGE_SECRET).update(`${ip}:${norm}:${expires}`).digest('hex').slice(0, 20);
  return `${expires}.${sig}`;
}

// Verify user answer against a challenge token
function verifyChallengeAnswer(ip, token, userAnswer) {
  if (!token || userAnswer === undefined || userAnswer === '') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiresStr, sig] = parts;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const norm     = normalizeAnswer(userAnswer);
  const expected = crypto.createHmac('sha256', CHALLENGE_SECRET).update(`${ip}:${norm}:${expires}`).digest('hex').slice(0, 20);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

// null = all types active; array = only listed types active
let _enabledTypes = null;

// ── Challenge catalogue ──────────────────────────────────────────────────────

const _COLORS = [
  { name: 'rouge',  hex: '#ef4444' },
  { name: 'bleu',   hex: '#3b82f6' },
  { name: 'vert',   hex: '#22c55e' },
  { name: 'jaune',  hex: '#eab308' },
  { name: 'violet', hex: '#a855f7' },
  { name: 'orange', hex: '#f97316' },
];

const _WORDS = ['PROXY', 'CLOUD', 'GUARD', 'BLOCK', 'FLAME', 'STORM', 'GATE', 'VAULT'];

const _RIDDLES = [
  { q: "Quel animal chante 'cocorico' ?",                 a: 'coq'     },
  { q: "Combien de côtés a un carré ?",                   a: '4'       },
  { q: "Quelle est la couleur du ciel par beau temps ?",  a: 'bleu'    },
  { q: "Quel est le fruit jaune qu'on épluche ?",         a: 'banane'  },
  { q: "Combien de jours dans une semaine ?",             a: '7'       },
  { q: "Combien de mois dans une année ?",                a: '12'      },
  { q: "Quel est l'opposé de 'chaud' ?",                  a: 'froid'   },
  { q: "Quelle est la capitale de la France ?",           a: 'paris'   },
  { q: "Combien font 10 × 10 ?",                          a: '100'     },
  { q: "Quel est le 1er mois de l'année ?",               a: 'janvier' },
];

const _ROMAN = {4:'IV',5:'V',6:'VI',7:'VII',8:'VIII',9:'IX',10:'X',
  11:'XI',12:'XII',13:'XIII',14:'XIV',15:'XV',16:'XVI',17:'XVII',18:'XVIII',
  19:'XIX',20:'XX',21:'XXI',22:'XXII',23:'XXIII',24:'XXIV',25:'XXV',
  30:'XXX',40:'XL',50:'L',60:'LX',70:'LXX',80:'LXXX',90:'XC',100:'C'};

const _SYMS = ['★', '●', '▲', '◆', '✦', '◉', '♦'];

// Returns { type, question, token, display, options, gameSecret }
// display     = extra HTML snippet (symbols row, word card, colored text…)
// options     = array of strings for click-to-choose challenges, null otherwise
// gameSecret  = random hex used as the answer for interactive game challenges
function generateChallenge(ip) {
  const ALL_TYPES = [
    'math_add', 'math_sub', 'math_mul',
    'seq_arith', 'seq_geo',
    'count_symbols',
    'word_reverse', 'anagram',
    'roman', 'alphabet',
    'odd_out', 'stroop', 'riddle',
    'morpion', 'simon', 'whack', 'sort_nums',
    'find_emoji', 'rps', 'speed_click', 'slider',
  ];
  const TYPES = (_enabledTypes && _enabledTypes.length > 0)
    ? ALL_TYPES.filter(t => _enabledTypes.includes(t))
    : ALL_TYPES;
  const type = TYPES[randInt(0, TYPES.length - 1)];
  let question, answer, display = '', options = null, gameSecret = null;

  switch (type) {

    // ── 1. Addition ──────────────────────────────────────────────────────────
    case 'math_add': {
      const a = randInt(5, 50), b = randInt(5, 50);
      answer   = a + b;
      question = `${a} + ${b} = ?`;
      break;
    }

    // ── 2. Soustraction ─────────────────────────────────────────────────────
    case 'math_sub': {
      const a = randInt(10, 50), b = randInt(1, 10);
      answer   = a - b;
      question = `${a} − ${b} = ?`;
      break;
    }

    // ── 3. Multiplication ────────────────────────────────────────────────────
    case 'math_mul': {
      const a = randInt(2, 12), b = randInt(2, 12);
      answer   = a * b;
      question = `${a} × ${b} = ?`;
      break;
    }

    // ── 4. Suite arithmétique ────────────────────────────────────────────────
    case 'seq_arith': {
      const s = randInt(1, 15), d = randInt(2, 8);
      answer   = s + 4 * d;
      question = `Quelle est la suite ? ${s}, ${s+d}, ${s+2*d}, ${s+3*d}, __ ?`;
      break;
    }

    // ── 5. Suite géométrique ─────────────────────────────────────────────────
    case 'seq_geo': {
      const s = randInt(1, 4), r = randInt(2, 3);
      answer   = s * Math.pow(r, 4);
      question = `Quelle est la suite ? ${s}, ${s*r}, ${s*r**2}, ${s*r**3}, __ ?`;
      break;
    }

    // ── 6. Compter des symboles ──────────────────────────────────────────────
    case 'count_symbols': {
      const sym = _SYMS[randInt(0, _SYMS.length - 1)];
      const cnt = randInt(5, 15);
      answer   = cnt;
      question = `Combien de <span class="sym-inline">${sym}</span> apparaissent ci-dessous ?`;
      display  = `<div class="sym-display">${Array(cnt).fill(sym).join(' ')}</div>`;
      break;
    }

    // ── 7. Mot à l'envers ────────────────────────────────────────────────────
    case 'word_reverse': {
      const word = _WORDS[randInt(0, _WORDS.length - 1)];
      answer   = word.split('').reverse().join('');
      question = `Écrivez ce mot à l'envers :`;
      display  = `<div class="word-card">${word}</div>`;
      break;
    }

    // ── 8. Anagramme ─────────────────────────────────────────────────────────
    case 'anagram': {
      const word = _WORDS[randInt(0, _WORDS.length - 1)];
      let sh = word.split('').sort(() => Math.random() - 0.5).join('');
      if (sh === word) sh = word.split('').reverse().join('');
      answer   = word;
      question = `Quel mot se cache dans ces lettres ?`;
      display  = `<div class="word-card letter-scatter">${sh.split('').map(l => `<span>${l}</span>`).join('')}</div>`;
      break;
    }

    // ── 9. Chiffres romains ──────────────────────────────────────────────────
    case 'roman': {
      const vals = Object.keys(_ROMAN).map(Number);
      const val  = vals[randInt(0, vals.length - 1)];
      answer   = val;
      question = `Convertissez en chiffres arabes :`;
      display  = `<div class="word-card roman">${_ROMAN[val]}</div>`;
      break;
    }

    // ── 10. Position dans l'alphabet ─────────────────────────────────────────
    case 'alphabet': {
      const pos = randInt(1, 20);
      answer   = String.fromCharCode(64 + pos);
      question = `Quelle est la ${pos}${pos === 1 ? 'ère' : 'ème'} lettre de l'alphabet ?`;
      break;
    }

    // ── 11. L'intrus (parité) ─────────────────────────────────────────────────
    case 'odd_out': {
      const wantEven = randInt(0, 1) === 0;
      const nums = new Set();
      while (nums.size < 4) {
        const n = randInt(2, 30);
        if (wantEven ? n % 2 === 0 : n % 2 !== 0) nums.add(n);
      }
      let outlier = randInt(2, 31);
      if (wantEven ? outlier % 2 === 0 : outlier % 2 !== 0) outlier++;
      const list = [...nums];
      list.splice(randInt(0, list.length), 0, outlier);
      answer   = String(outlier);
      question = wantEven
        ? `Cliquez sur le nombre <b>impair</b> parmi ceux-ci :`
        : `Cliquez sur le nombre <b>pair</b> parmi ceux-ci :`;
      options  = list.map(String);
      break;
    }

    // ── 12. Test de Stroop (couleur du texte) ─────────────────────────────────
    case 'stroop': {
      const textColorIdx = randInt(0, _COLORS.length - 1);
      const wordIdx      = (textColorIdx + randInt(1, _COLORS.length - 1)) % _COLORS.length;
      const textColor    = _COLORS[textColorIdx];
      const dispWord     = _COLORS[wordIdx].name.toUpperCase();
      answer   = textColor.name;
      question = `De quelle <b>couleur</b> est écrit ce mot ?`;
      display  = `<div class="color-word" style="color:${textColor.hex}">${dispWord}</div>`;
      options  = _COLORS.map(c => c.name);
      break;
    }

    // ── 13. Devinette ────────────────────────────────────────────────────────
    case 'riddle': {
      const r  = _RIDDLES[randInt(0, _RIDDLES.length - 1)];
      answer   = r.a;
      question = r.q;
      break;
    }

    // ── 14. Morpion (Tic-Tac-Toe) ────────────────────────────────────────────
    case 'morpion': {
      gameSecret = crypto.randomBytes(4).toString('hex');
      answer     = gameSecret;
      question   = 'Battez (ou égalisez) notre IA au morpion !';
      break;
    }

    // ── 15. Simon Says ───────────────────────────────────────────────────────
    case 'simon': {
      gameSecret = crypto.randomBytes(4).toString('hex');
      answer     = gameSecret;
      question   = 'Mémorisez et répétez la séquence de couleurs !';
      break;
    }

    // ── 16. Whack-a-Mole ─────────────────────────────────────────────────────
    case 'whack': {
      gameSecret = crypto.randomBytes(4).toString('hex');
      answer     = gameSecret;
      question   = 'Frappez 5 taupes pour passer ! 🐭';
      break;
    }

    // ── 17. Cliquer dans l'ordre croissant ───────────────────────────────────
    case 'sort_nums': {
      gameSecret = crypto.randomBytes(4).toString('hex');
      answer     = gameSecret;
      question   = 'Cliquez les nombres du plus petit au plus grand !';
      break;
    }

    // ── 18. Trouve l'emoji ────────────────────────────────────────────────────
    case 'find_emoji': {
      gameSecret = crypto.randomBytes(4).toString('hex');
      answer     = gameSecret;
      question   = 'Trouvez et cliquez tous les emojis identiques !';
      break;
    }

    // ── 19. Pierre-Feuille-Ciseaux ────────────────────────────────────────────
    case 'rps': {
      gameSecret = crypto.randomBytes(4).toString('hex');
      answer     = gameSecret;
      question   = "Battez l'IA au Pierre-Feuille-Ciseaux !";
      break;
    }

    // ── 20. Clic rapide ───────────────────────────────────────────────────────
    case 'speed_click': {
      gameSecret = crypto.randomBytes(4).toString('hex');
      answer     = gameSecret;
      question   = 'Cliquez 7 fois sur le bouton avant la fin !';
      break;
    }

    // ── 21. Glisseur de précision ─────────────────────────────────────────────
    case 'slider': {
      gameSecret = crypto.randomBytes(4).toString('hex');
      answer     = gameSecret;
      question   = 'Glissez le curseur dans la zone verte et validez !';
      break;
    }
  }

  return { type, question, token: buildChallengeToken(ip, answer), display, options, gameSecret };
}

// Keep legacy name as alias (used by proxyManager + server)
function verifyMathToken(ip, token, userAnswer) {
  return verifyChallengeAnswer(ip, token, userAnswer);
}

// Bypass cookie token (set after challenge is solved, valid 1h)
function generateChallengeToken(ip) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const data    = `${ip}:${expires}`;
  const sig     = crypto.createHmac('sha256', CHALLENGE_SECRET).update(data).digest('hex').slice(0, 16);
  return `${expires}.${sig}`;
}

function verifyChallengeToken(ip, token) {
  if (!token) return false;
  const [expiresStr, sig] = token.split('.');
  if (!expiresStr || !sig) return false;
  const expires = parseInt(expiresStr, 10);
  if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', CHALLENGE_SECRET).update(`${ip}:${expires}`).digest('hex').slice(0, 16);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

// ── Fetch helper ────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ── Service ─────────────────────────────────────────────────────────────────

class DdosProtectionService {
  constructor() {
    this.redis = null;
    this._syncTimer = null;

    // L1 in-process caches (rebuilt on every blocklist sync)
    this._blocklistIpSet  = new Set();   // exact IPs — O(1) lookup
    this._blocklistCidrs  = [];          // CIDR strings for subnet matching
    this._whitelistIpSet  = new Set();
    this._whitelistCidrs  = [];

    // Per-IP concurrent connection tracking (domainId:ip -> count)
    this._connectionCount = new Map();

    // Socket registry: "domainId:ip" -> Set of net.Socket
    // Used to immediately destroy existing connections when an IP is banned
    this._socketRegistry = new Map();

    // Deferred event queue (batch inserts to avoid DB hammering)
    this._eventQueue = [];
    this._eventFlushTimer = null;

    this._initialized = false;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(redisClient) {
    this.redis = redisClient;
    this._initialized = true;

    await this._loadWhitelist();
    // Refresh whitelist every 5 min
    setInterval(() => this._loadWhitelist().catch(() => {}), 5 * 60 * 1000);

    // Load enabled challenge types from Redis
    await this._loadEnabledTypes().catch(() => {});

    // Initial blocklist sync (non-blocking)
    this.syncAllBlocklists().catch(err => console.error('[DDoS] Initial sync failed:', err.message));

    // Periodic sync every 6h
    this._syncTimer = setInterval(() => {
      this.syncAllBlocklists().catch(err => console.error('[DDoS] Periodic sync failed:', err.message));
    }, SYNC_INTERVAL_MS);

    // Event flush every 500ms
    this._eventFlushTimer = setInterval(() => this._flushEvents(), EVENT_LOG_INTERVAL);

    console.log('[DDoS] Protection service initialized (enterprise mode)');
  }

  // ── Challenge type selection ──────────────────────────────────────────────

  static get ALL_CHALLENGE_TYPES() {
    return [
      { id: 'math_add',      label: 'Addition',              desc: '23 + 45 = ?',                    category: 'Maths'  },
      { id: 'math_sub',      label: 'Soustraction',          desc: '67 − 12 = ?',                    category: 'Maths'  },
      { id: 'math_mul',      label: 'Multiplication',        desc: '7 × 8 = ?',                      category: 'Maths'  },
      { id: 'seq_arith',     label: 'Suite arithmétique',    desc: '3, 7, 11, __ ?',                 category: 'Maths'  },
      { id: 'seq_geo',       label: 'Suite géométrique',     desc: '2, 6, 18, __ ?',                 category: 'Maths'  },
      { id: 'count_symbols', label: 'Compter les symboles',  desc: '★★★★★ → combien ?',             category: 'Texte'  },
      { id: 'word_reverse',  label: 'Mot à l\'envers',       desc: 'PROXY → YXORP',                  category: 'Texte'  },
      { id: 'anagram',       label: 'Anagramme',             desc: 'P·R·O·X·Y → trouver le mot',     category: 'Texte'  },
      { id: 'roman',         label: 'Chiffres romains',      desc: 'XIV → 14',                       category: 'Texte'  },
      { id: 'alphabet',      label: 'Position alphabet',     desc: '7ème lettre → G',                category: 'Texte'  },
      { id: 'odd_out',       label: 'L\'intrus',             desc: 'Cliquer le nombre impair',       category: 'Texte'  },
      { id: 'stroop',        label: 'Test de Stroop',        desc: 'Cliquer la couleur du texte',    category: 'Texte'  },
      { id: 'riddle',        label: 'Devinette',             desc: 'Cocorico → coq',                 category: 'Texte'  },
      { id: 'morpion',       label: 'Morpion',               desc: 'Tic-Tac-Toe contre l\'IA',       category: 'Jeux'   },
      { id: 'simon',         label: 'Simon Says',            desc: '3 couleurs à mémoriser',         category: 'Jeux'   },
      { id: 'whack',         label: 'Whack-a-Mole',         desc: 'Frapper 4 taupes',               category: 'Jeux'   },
      { id: 'sort_nums',     label: 'Trier les nombres',     desc: 'Cliquer du + petit au + grand',  category: 'Jeux'   },
      { id: 'find_emoji',    label: 'Chercher les emojis',   desc: 'Trouver 3 emojis identiques',    category: 'Jeux'   },
      { id: 'rps',           label: 'Pierre-Feuille-Ciseaux', desc: 'Battre l\'IA',                 category: 'Jeux'   },
      { id: 'speed_click',   label: 'Clic rapide',           desc: '5 clics en 7 secondes',          category: 'Jeux'   },
      { id: 'slider',        label: 'Glisseur de précision', desc: 'Viser la zone verte',            category: 'Jeux'   },
    ];
  }

  async _loadEnabledTypes() {
    if (!this.redis) return;
    const val = await this.redis.get('ddos:challenge:enabled_types');
    if (val) _enabledTypes = JSON.parse(val);
  }

  async setEnabledChallengeTypes(types) {
    _enabledTypes = Array.isArray(types) && types.length > 0 ? types : null;
    if (this.redis) {
      if (_enabledTypes) await this.redis.set('ddos:challenge:enabled_types', JSON.stringify(_enabledTypes));
      else               await this.redis.del('ddos:challenge:enabled_types');
    }
  }

  getEnabledChallengeTypes() {
    return _enabledTypes;
  }

  // ── Whitelist ─────────────────────────────────────────────────────────────

  async _loadWhitelist() {
    try {
      const result = await database.execute('SELECT cidr FROM ddos_whitelist');
      const ipSet  = new Set();
      const cidrs  = [];
      for (const { cidr } of (result?.rows || [])) {
        if (cidr.includes('/')) cidrs.push(cidr);
        else ipSet.add(cidr);
      }
      this._whitelistIpSet = ipSet;
      this._whitelistCidrs = cidrs;
    } catch (_) {}
  }

  _isWhitelisted(ip) {
    if (this._whitelistIpSet.has(ip)) return true;
    const long = ipToLong(ip);
    if (long === null) return false;
    return this._whitelistCidrs.some(c => cidrContains(c, long));
  }

  async addWhitelist(cidr, description) {
    await database.execute(
      `INSERT INTO ddos_whitelist (cidr, description) VALUES ($1, $2)
       ON CONFLICT (cidr) DO UPDATE SET description = $2`,
      [cidr, description || '']
    );
    await this._loadWhitelist();
  }

  async removeWhitelist(id) {
    await database.execute(`DELETE FROM ddos_whitelist WHERE id = $1`, [id]);
    await this._loadWhitelist();
  }

  async getWhitelist() {
    const r = await database.execute(`SELECT * FROM ddos_whitelist ORDER BY created_at DESC`);
    return r?.rows || [];
  }

  // ── Blocklist sync ────────────────────────────────────────────────────────

  async syncAllBlocklists() {
    console.log('[DDoS] Syncing threat intelligence blocklists...');
    const combinedIps   = new Set();
    const combinedCidrs = new Set();

    for (const source of BLOCKLIST_SOURCES) {
      try {
        const text    = await fetchUrl(source.url);
        const entries = parseIpList(text);
        let count = 0;

        for (const entry of entries) {
          if (entry.includes('/')) combinedCidrs.add(entry);
          else                      combinedIps.add(entry);
          count++;
        }

        // Store in Redis for persistence across restarts
        if (this.redis && count > 0) {
          const key      = `ddos:blocklist:${source.key}`;
          const arr      = Array.from(entries);
          const pipeline = this.redis.pipeline();
          pipeline.del(key);
          for (let i = 0; i < arr.length; i += 1000) {
            pipeline.sadd(key, ...arr.slice(i, i + 1000));
          }
          pipeline.expire(key, 25 * 3600);
          await pipeline.exec();
        }

        await database.execute(
          `UPDATE ddos_blocklist_meta
             SET last_fetched = NOW(), ip_count = $1, last_error = NULL, updated_at = NOW()
           WHERE source = $2`,
          [count, source.key]
        ).catch(() => {});

        console.log(`[DDoS] ${source.key}: ${count} entries (${combinedCidrs.size} CIDRs so far)`);
      } catch (err) {
        console.error(`[DDoS] Failed to sync ${source.key}:`, err.message);
        await database.execute(
          `UPDATE ddos_blocklist_meta SET last_error = $1, updated_at = NOW() WHERE source = $2`,
          [err.message, source.key]
        ).catch(() => {});
      }
    }

    this._blocklistIpSet = combinedIps;
    this._blocklistCidrs = Array.from(combinedCidrs);

    console.log(`[DDoS] Sync done. ${combinedIps.size} IPs + ${combinedCidrs.size} CIDRs`);
    return { ips: combinedIps.size, cidrs: combinedCidrs.size };
  }

  _isBlacklisted(ip) {
    if (this._blocklistIpSet.has(ip)) return true;
    const long = ipToLong(ip);
    if (long === null) return false;
    return this._blocklistCidrs.some(c => cidrContains(c, long));
  }

  // ── Main check (hot path) ─────────────────────────────────────────────────

  async check(ip, domainId, domain) {
    if (!domain?.ddos_protection_enabled) return { blocked: false };
    if (!ip) return { blocked: false };

    const cleanIp = ip.replace(/^::ffff:/, '');

    if (isPrivateIp(cleanIp)) {
      // Private/loopback IPs are never subject to DDoS protection
      return { blocked: false };
    }

    // 0. Whitelist (highest priority — always allow)
    if (this._isWhitelisted(cleanIp)) return { blocked: false };

    // 1. L1 blocklist (synchronous, µs — no I/O)
    if (this._isBlacklisted(cleanIp)) {
      this._queueEvent(cleanIp, domainId, 'blocklist', {});
      this._banIpAsync(cleanIp, null, 'blocklist', 'auto', null); // permanent
      return { blocked: true, reason: 'blocklist' };
    }

    // 2. Redis ban check (global + domain)
    try {
      if (this.redis) {
        const [g, d] = await Promise.all([
          this.redis.get(`ddos:ban:global:${cleanIp}`),
          domainId ? this.redis.get(`ddos:ban:domain:${domainId}:${cleanIp}`) : Promise.resolve(null)
        ]);
        if (g) return { blocked: true, reason: `banned: ${g}` };
        if (d) return { blocked: true, reason: `banned: ${d}` };
      }
    } catch (_) {}

    // 3. Concurrent connections per IP
    const maxConns = domain.ddos_max_connections_per_ip || 50;
    const currentConns = this._connectionCount.get(`${domainId}:${cleanIp}`) || 0;
    if (currentConns > maxConns) {
      const reason = `too-many-connections (${currentConns}/${maxConns})`;
      await this.banIp(cleanIp, domainId, reason, 'auto', domain.ddos_ban_duration_sec || 3600);
      this._queueEvent(cleanIp, domainId, 'too-many-connections', { count: currentConns, limit: maxConns });
      return { blocked: true, reason };
    }

    // 4. Connections per minute
    const cpmLimit = domain.ddos_connections_per_minute || 0;
    if (cpmLimit > 0 && this.redis) {
      const r = await this._checkCpm(cleanIp, domainId, cpmLimit, domain.ddos_ban_duration_sec || 3600);
      if (r.blocked) return r;
    }

    // 5. Requests per second (sliding window)
    const rpsResult = await this._checkRps(cleanIp, domainId, domain);
    if (rpsResult.blocked) return rpsResult;

    // 6. Behavioral: 4xx error rate
    if (domain.ddos_ban_on_4xx_rate && this.redis) {
      const b = await this._checkBehavioral4xx(cleanIp, domainId, domain);
      if (b.blocked) return b;
    }

    return { blocked: false };
  }

  // ── Rate limiters ─────────────────────────────────────────────────────────

  async _checkCpm(ip, domainId, limit, banDuration) {
    const slot  = Math.floor(Date.now() / 60000);
    const k1    = `ddos:cpm:${domainId}:${ip}:${slot}`;
    const k2    = `ddos:cpm:${domainId}:${ip}:${slot - 1}`;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(k1);
      pipeline.expire(k1, 120);
      pipeline.get(k2);
      const res   = await pipeline.exec();
      const total = (parseInt(res[0][1]) || 0) + (parseInt(res[2][1]) || 0);
      if (total > limit) {
        const reason = `connections-per-minute (${total}/${limit})`;
        await this.banIp(ip, domainId, reason, 'auto', banDuration);
        this._queueEvent(ip, domainId, 'connections-per-minute', { count: total, limit });
        return { blocked: true, reason };
      }
    } catch (_) {}
    return { blocked: false };
  }

  async _checkRps(ip, domainId, domain) {
    if (!this.redis || !domainId) return { blocked: false };
    const threshold   = domain.ddos_req_per_second   || 100;
    const banDuration = domain.ddos_ban_duration_sec  || 3600;
    const slot        = Math.floor(Date.now() / 1000);
    const k1          = `ddos:rate:${domainId}:${ip}:${slot}`;
    const k2          = `ddos:rate:${domainId}:${ip}:${slot - 1}`;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(k1);
      pipeline.expire(k1, 5);
      pipeline.get(k2);
      const res   = await pipeline.exec();
      const total = (parseInt(res[0][1]) || 0) + (parseInt(res[2][1]) || 0);
      if (total > threshold) {
        const reason = `rate-limit (${total} req/s > ${threshold})`;
        await this.banIp(ip, domainId, reason, 'auto', banDuration);
        this._queueEvent(ip, domainId, 'rate-limit', { rps: total, threshold });
        return { blocked: true, reason };
      }
    } catch (_) {}
    return { blocked: false };
  }

  async _checkBehavioral4xx(ip, domainId, domain) {
    const key = `ddos:4xx:${domainId}:${ip}`;
    try {
      const count = parseInt(await this.redis.get(key) || 0);
      const limit = 50; // 50 errors in 5-minute window
      if (count > limit) {
        const reason = `behavioral-4xx (${count} errors in 5min)`;
        await this.banIp(ip, domainId, reason, 'auto', domain.ddos_ban_duration_sec || 3600);
        this._queueEvent(ip, domainId, 'behavioral-4xx', { count, limit });
        return { blocked: true, reason };
      }
    } catch (_) {}
    return { blocked: false };
  }

  // ── Connection tracking ───────────────────────────────────────────────────

  trackConnectionOpen(ip, domainId) {
    if (!ip || !domainId) return;
    const clean = ip.replace(/^::ffff:/, '');
    const key   = `${domainId}:${clean}`;
    this._connectionCount.set(key, (this._connectionCount.get(key) || 0) + 1);
  }

  trackConnectionClose(ip, domainId) {
    if (!ip || !domainId) return;
    const clean = ip.replace(/^::ffff:/, '');
    const key   = `${domainId}:${clean}`;
    const n     = (this._connectionCount.get(key) || 1) - 1;
    if (n <= 0) this._connectionCount.delete(key);
    else        this._connectionCount.set(key, n);
  }

  /**
   * Register an open socket so it can be killed immediately on ban.
   * Call this right after the DDoS check passes for a TCP connection.
   */
  registerSocket(ip, domainId, socket) {
    if (!ip || !domainId || !socket) return;
    const clean = ip.replace(/^::ffff:/, '');
    const key   = `${domainId}:${clean}`;
    if (!this._socketRegistry.has(key)) this._socketRegistry.set(key, new Set());
    this._socketRegistry.get(key).add(socket);
  }

  /**
   * Unregister a socket when it closes normally.
   */
  unregisterSocket(ip, domainId, socket) {
    if (!ip || !domainId || !socket) return;
    const clean = ip.replace(/^::ffff:/, '');
    const key   = `${domainId}:${clean}`;
    const set   = this._socketRegistry.get(key);
    if (set) {
      set.delete(socket);
      if (set.size === 0) this._socketRegistry.delete(key);
    }
  }

  /**
   * Immediately destroy all open sockets for a given IP (+ optionally a specific domain).
   * Called internally by banIp.
   */
  _killSockets(cleanIp, domainId) {
    const destroy = (key) => {
      const set = this._socketRegistry.get(key);
      if (!set) return;
      for (const sock of set) {
        try { sock.destroy(); } catch (_) {}
      }
      this._socketRegistry.delete(key);
    };

    if (domainId) {
      destroy(`${domainId}:${cleanIp}`);
    } else {
      // Global ban — kill sockets on all domains
      for (const key of this._socketRegistry.keys()) {
        if (key.endsWith(`:${cleanIp}`)) destroy(key);
      }
    }
  }

  // ── 4xx tracking (call from HTTP proxy on 4xx responses) ──────────────────

  async track4xx(ip, domainId) {
    if (!this.redis || !ip || !domainId) return;
    const clean = ip.replace(/^::ffff:/, '');
    const key   = `ddos:4xx:${domainId}:${clean}`;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, 300); // 5-minute window
      await pipeline.exec();
    } catch (_) {}
  }

  // ── Challenge mode (HTTP) ─────────────────────────────────────────────────

  generateChallengePage(ip, returnUrl) {
    const { type, question, token, display, options, gameSecret } = generateChallenge(ip);

    const GAME_TYPES = ['morpion','simon','whack','sort_nums','find_emoji','rps','speed_click','slider'];
    const isGame    = GAME_TYPES.includes(type);
    const isOptions = !isGame && Array.isArray(options) && options.length > 0;
    const isNumeric = ['math_add','math_sub','math_mul','seq_arith','seq_geo','count_symbols','roman'].includes(type);

    // Build option buttons HTML (odd_out / stroop)
    const optBtnsHtml = isOptions
      ? options.map(o => `<button type="button" class="opt-btn" data-val="${o}">${o}</button>`).join('')
      : '';

    // Build question label
    const labelMap = {
      math_add: 'Calculez', math_sub: 'Calculez', math_mul: 'Calculez',
      seq_arith: 'Suite', seq_geo: 'Suite',
      count_symbols: 'Comptez',
      word_reverse: 'Inversez', anagram: 'Déchiffrez',
      roman: 'Convertissez', alphabet: 'Identifiez',
      odd_out: "L'intrus", stroop: 'Observez bien',
      riddle: 'Devinette',
      morpion: 'Jeu', simon: 'Mémoire', whack: 'Réflexes',
      sort_nums: 'Ordonnez', find_emoji: 'Cherchez',
      rps: 'Duel', speed_click: 'Vitesse', slider: 'Précision',
    };
    const label = labelMap[type] || 'Répondez';
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vérification de sécurité — NebulaProxy</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px;color:#fafafa;
      background:radial-gradient(1200px 600px at 8% -10%,rgba(255,255,255,.08),transparent 56%),
                 radial-gradient(900px 480px at 92% -15%,rgba(255,255,255,.04),transparent 52%),
                 #09090b;
      -webkit-font-smoothing:antialiased;
      min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;
    }
    .wrap{width:100%;max-width:420px;animation:fade-in .24s ease-out both}

    /* Brand */
    .brand{display:flex;align-items:center;justify-content:center;gap:.625rem;margin-bottom:1.75rem}
    .brand-mark{
      width:32px;height:32px;border-radius:8px;
      display:flex;align-items:center;justify-content:center;flex-shrink:0;
      background:linear-gradient(140deg,rgba(228,228,231,.2),rgba(161,161,170,.26));
      border:1px solid rgba(228,228,231,.35);
    }
    .brand-mark svg{width:16px;height:16px;stroke:#fafafa}
    .brand-name{font-size:.8rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#71717a}

    /* Card */
    .card{background:#111113;border:1px solid #27272a;border-radius:.75rem;padding:2rem 1.75rem}

    /* Icon */
    .icon-wrap{
      width:44px;height:44px;border-radius:10px;margin:0 auto 1.25rem;
      display:flex;align-items:center;justify-content:center;
      background:linear-gradient(140deg,rgba(228,228,231,.16),rgba(161,161,170,.2));
      border:1px solid rgba(228,228,231,.28);
    }
    .icon-wrap svg{width:20px;height:20px;stroke:#fafafa}

    h1{font-size:1.1rem;font-weight:600;color:#fafafa;text-align:center;margin-bottom:.375rem;letter-spacing:-.01em}
    .sub{font-size:.8rem;color:#71717a;text-align:center;line-height:1.55;margin-bottom:1.5rem}

    /* Question box */
    .qbox{
      background:#09090b;border:1px solid #27272a;border-radius:8px;
      padding:1.125rem 1rem;margin-bottom:1.25rem;text-align:center;
    }
    .qlabel{font-size:.7rem;text-transform:uppercase;letter-spacing:.14em;color:#52525b;margin-bottom:.5rem}
    .qtext{font-size:1.4rem;font-weight:700;color:#fafafa;letter-spacing:-.01em;line-height:1.4}
    .qtext b{color:#fafafa;font-weight:700}

    /* Symbol display (count challenge) */
    .sym-display{
      margin-top:.75rem;font-size:1.2rem;letter-spacing:.25em;line-height:1.8;
      color:#a1a1aa;word-break:break-all;
    }
    .sym-inline{color:#fafafa}

    /* Word / roman card */
    .word-card{
      display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
      margin-top:.75rem;padding:.5rem 1.25rem;
      background:rgba(244,244,245,.07);border:1px solid #3f3f46;border-radius:8px;
      font-size:1.5rem;font-weight:700;letter-spacing:.12em;color:#fafafa;
    }
    .word-card.roman{font-size:2rem;letter-spacing:.08em}
    .letter-scatter span{
      display:inline-block;margin:0 .2rem;
      background:rgba(244,244,245,.09);border:1px solid #3f3f46;border-radius:4px;
      padding:.1rem .45rem;font-size:1.2rem;font-weight:700;
    }

    /* Color word (Stroop) */
    .color-word{
      display:block;margin-top:.75rem;
      font-size:2rem;font-weight:800;letter-spacing:.1em;
    }

    /* Input row */
    .input-row{display:flex;gap:.625rem;margin-bottom:.625rem}
    input[type=text],input[type=number]{
      flex:1;min-width:0;
      background:rgba(24,24,27,.92);border:1px solid #3f3f46;border-radius:8px;
      color:#fafafa;font-family:inherit;font-size:.875rem;font-weight:500;
      padding:.55rem .75rem;outline:none;text-align:center;
      -moz-appearance:textfield;
      transition:border-color .18s,box-shadow .18s,background .18s;
    }
    input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
    input:focus{border-color:rgba(244,244,245,.5);box-shadow:0 0 0 3px rgba(244,244,245,.1);background:rgba(31,31,35,.92)}
    input::placeholder{color:#52525b}

    /* Primary button */
    .btn-primary{
      display:inline-flex;align-items:center;justify-content:center;
      padding:.55rem 1rem;border-radius:8px;
      border:1px solid rgba(244,244,245,.35);
      background:linear-gradient(135deg,#fafafa,#e4e4e7);
      color:#09090b;font-family:inherit;font-size:.8rem;font-weight:600;
      cursor:pointer;white-space:nowrap;
      transition:filter .18s,transform .18s,box-shadow .18s;
      box-shadow:0 7px 16px rgba(0,0,0,.28);
    }
    .btn-primary:hover{filter:brightness(1.06);transform:translateY(-1px);box-shadow:0 9px 20px rgba(0,0,0,.34)}
    .btn-primary:active{transform:translateY(0);filter:none}
    .btn-primary:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}

    /* Option buttons (odd_out / stroop) */
    .opt-grid{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-bottom:.75rem}
    .opt-btn{
      padding:.5rem 1rem;border-radius:8px;
      border:1px solid #3f3f46;background:rgba(24,24,27,.92);
      color:#a1a1aa;font-family:inherit;font-size:.875rem;font-weight:500;
      cursor:pointer;transition:border-color .18s,background .18s,color .18s,transform .12s;
      text-transform:capitalize;
    }
    .opt-btn:hover{background:rgba(39,39,42,.92);border-color:rgba(244,244,245,.3);color:#fafafa}
    .opt-btn.selected{
      background:rgba(244,244,245,.13);border-color:rgba(244,244,245,.5);
      color:#fafafa;transform:scale(1.04);
    }
    .opt-btn:disabled{opacity:.45;cursor:not-allowed;pointer-events:none}

    /* Status */
    .msg{font-size:.75rem;min-height:1.1rem;text-align:center;color:transparent;margin-top:.1rem}
    .msg.ok{color:#22c55e}
    .msg.err{color:#ef4444}

    /* Divider */
    .divider{height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);margin:1.25rem 0}

    .note{font-size:.7rem;color:#3f3f46;text-align:center;line-height:1.5}
    .note a{color:#52525b;text-decoration:none}
    .note a:hover{color:#71717a}

    /* ── Morpion ── */
    .tt-board{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:.75rem}
    .tt-cell{
      aspect-ratio:1;background:#09090b;border:1px solid #27272a;border-radius:8px;
      font-size:1.5rem;font-weight:700;cursor:pointer;
      transition:background .12s,border-color .12s;display:flex;align-items:center;justify-content:center;
    }
    .tt-cell:not(:disabled):hover{background:#1c1c1f;border-color:#3f3f46}
    .tt-cell:disabled{cursor:default}

    /* ── Simon ── */
    .simon-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:.75rem}
    .simon-btn{
      aspect-ratio:2/1;border-radius:8px;border:2px solid rgba(0,0,0,.2);
      background:color-mix(in srgb,var(--c) 40%,#09090b);
      cursor:pointer;transition:background .1s,transform .1s;
    }
    .simon-btn:not(:disabled):hover{background:color-mix(in srgb,var(--c) 65%,#09090b)}
    .simon-btn.lit{background:var(--c)!important;transform:scale(.95)}
    .simon-btn:disabled{cursor:default}

    /* ── Whack-a-mole ── */
    .mole-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:.75rem}
    .mole-hole{
      aspect-ratio:1;background:#09090b;border:1px solid #27272a;border-radius:50%;
      display:flex;align-items:center;justify-content:center;cursor:pointer;
      font-size:1.5rem;opacity:.2;transition:opacity .1s,transform .1s;user-select:none;
    }
    .mole-hole.active{opacity:1;cursor:pointer}
    .mole-hole.bonk{transform:scale(.8);opacity:.4}

    /* ── Sort numbers ── */
    .sort-grid{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-top:.75rem}
    .sort-btn{
      padding:.55rem .9rem;border-radius:8px;border:1px solid #3f3f46;
      background:rgba(24,24,27,.92);color:#fafafa;font-size:.95rem;font-weight:600;
      cursor:pointer;transition:background .15s,border-color .15s,transform .1s;
    }
    .sort-btn:hover{background:rgba(39,39,42,.92);border-color:rgba(244,244,245,.3)}
    .sort-btn.used{opacity:.3;cursor:default}

    /* ── Emoji find ── */
    .emoji-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:.75rem;max-width:260px;margin-left:auto;margin-right:auto}
    .emoji-cell{
      aspect-ratio:1;background:#09090b;border:1px solid #27272a;border-radius:8px;
      font-size:1.3rem;cursor:pointer;transition:background .12s,transform .1s;
    }
    .emoji-cell:hover{background:#1c1c1f}
    .emoji-cell.found{background:rgba(34,197,94,.15);border-color:#22c55e;cursor:default}
    .emoji-cell:disabled{cursor:default}

    /* ── Rock Paper Scissors ── */
    .rps-grid{display:flex;gap:.75rem;justify-content:center;margin-top:.75rem}
    .rps-btn{
      flex:1;display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:.75rem .5rem;
      background:#09090b;border:1px solid #27272a;border-radius:10px;
      cursor:pointer;transition:background .12s,border-color .12s,transform .1s;
    }
    .rps-btn span{font-size:1.6rem}
    .rps-btn small{font-size:.65rem;color:#71717a;font-weight:500}
    .rps-btn:not(:disabled):hover{background:#1c1c1f;border-color:#3f3f46}
    .rps-btn.picked{border-color:rgba(244,244,245,.5);background:rgba(244,244,245,.1)}
    .rps-btn:disabled{cursor:default;opacity:.5}

    @keyframes fade-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}
    .shake{animation:shake .32s ease}
  </style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="brand-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    </div>
    <span class="brand-name">NebulaProxy</span>
  </div>

  <div class="card">
    <div class="icon-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    </div>
    <h1>Vérification de sécurité</h1>
    <p class="sub">Prouvez que vous n'êtes pas un robot pour continuer.</p>

    <div class="qbox" id="qbox">
      <div class="qlabel">${label}</div>
      <div class="qtext">${question}</div>
      ${display}
    </div>

    ${isOptions ? `
    <div class="opt-grid" id="opts">${optBtnsHtml}</div>
    ` : isGame ? `
    <div id="game-area"></div>
    ` : `
    <form id="form" autocomplete="off">
      <div class="input-row">
        <input type="${isNumeric ? 'number' : 'text'}" id="ans" placeholder="Votre réponse" autofocus required>
        <button type="submit" id="btn" class="btn-primary">Valider</button>
      </div>
    </form>
    `}
    <div class="msg" id="msg">&nbsp;</div>
    <div class="divider"></div>
    <p class="note">Protégé par NebulaProxy Shield &bull; <a href="/">Retour à l'accueil</a></p>
  </div>
</div>
<script>
(function(){
  var TOKEN=${JSON.stringify(token)};
  var RETURN=${JSON.stringify(returnUrl||'/')};
  var SECRET=${JSON.stringify(gameSecret||'')};
  var TYPE=${JSON.stringify(type)};
  var msg=document.getElementById('msg');
  var qbox=document.getElementById('qbox');

  function shake(el){el=el||qbox;el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');}

  function submit(answer,onFail){
    msg.className='msg';msg.textContent='\u00a0';
    fetch('/__ddos_challenge/verify',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:TOKEN,answer:String(answer),return:RETURN})})
    .then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d};});})
    .then(function(res){
      if(res.ok&&res.data.ok){
        msg.className='msg ok';msg.textContent='Accès autorisé, redirection\u2026';
        window.location.href=res.data.return||RETURN;
      } else {
        msg.className='msg err';msg.textContent='Incorrect. Réessayez.';
        shake();if(onFail)onFail();
      }
    })
    .catch(function(){msg.className='msg err';msg.textContent='Erreur réseau.';if(onFail)onFail();});
  }

  /* ── Input challenges ─────────────────────────────────────────────── */
  var form=document.getElementById('form');
  if(form){
    var btn=document.getElementById('btn'),ansEl=document.getElementById('ans');
    form.addEventListener('submit',function(e){
      e.preventDefault();var a=ansEl.value.trim();if(!a)return;
      btn.disabled=true;btn.textContent='Vérification\u2026';
      submit(a,function(){ansEl.value='';ansEl.focus();btn.disabled=false;btn.textContent='Valider';});
    });
  }

  /* ── Option challenges ────────────────────────────────────────────── */
  var opts=document.getElementById('opts');
  if(opts){
    opts.addEventListener('click',function(e){
      var b=e.target.closest('.opt-btn');if(!b||b.disabled)return;
      opts.querySelectorAll('.opt-btn').forEach(function(x){x.disabled=true;});
      b.classList.add('selected');
      submit(b.dataset.val,function(){
        opts.querySelectorAll('.opt-btn').forEach(function(x){x.disabled=false;x.classList.remove('selected');});
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════ */
  /* ── Game challenges ──────────────────────────────────────────────── */
  /* ══════════════════════════════════════════════════════════════════ */
  var ga=document.getElementById('game-area');
  if(!ga)return;

  function gset(html){ga.innerHTML=html;}
  function gstatus(txt,cls){msg.className='msg'+(cls?' '+cls:'');msg.textContent=txt;}

  /* ── MORPION ───────────────────────────────────────────────────────── */
  if(TYPE==='morpion'){
    var board=Array(9).fill(null),locked=false;
    function renderBoard(){
      var cells=board.map(function(c,i){
        var sym=c?('<span style="color:'+(c==='X'?'#fafafa':'#a1a1aa')+'">'+c+'</span>'):'';
        return '<button class="tt-cell" data-i="'+i+'" '+(c||locked?'disabled':'')+'>'+sym+'</button>';
      }).join('');
      gset('<div class="tt-board">'+cells+'</div>');
      ga.querySelectorAll('.tt-cell').forEach(function(b){
        b.addEventListener('click',function(){play(+this.dataset.i);});
      });
    }
    function checkWin(b,p){
      var W=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      return W.some(function(l){return l.every(function(i){return b[i]===p;});});
    }
    function aiMove(){
      var empty=board.reduce(function(a,c,i){if(!c)a.push(i);return a;},[]);
      if(!empty.length)return;
      // Try to win, then block player
      var checks=['O','X'];
      for(var ci=0;ci<checks.length;ci++){var p=checks[ci];
        for(var ei=0;ei<empty.length;ei++){var si=empty[ei];
          var t=board.slice();t[si]=p;
          if(checkWin(t,p)){board[si]='O';return;}
        }
      }
      // Take center or random
      if(!board[4])board[4]='O';
      else board[empty[Math.floor(Math.random()*empty.length)]]='O';
    }
    function play(i){
      if(locked||board[i])return;
      board[i]='X';
      if(checkWin(board,'X')){locked=true;renderBoard();gstatus('Vous avez gagné ! Validation\u2026','ok');submit(SECRET);return;}
      var empty=board.filter(function(c){return!c;});
      if(!empty.length){locked=true;renderBoard();gstatus('Match nul — ça compte ! Validation\u2026','ok');submit(SECRET);return;}
      aiMove();
      if(checkWin(board,'O')){locked=true;renderBoard();gstatus('Perdu ! Réessayez.','err');setTimeout(function(){board=Array(9).fill(null);locked=false;renderBoard();gstatus('');},1500);return;}
      var empty2=board.filter(function(c){return!c;});
      if(!empty2.length){locked=true;renderBoard();gstatus('Match nul — ça compte ! Validation\u2026','ok');submit(SECRET);return;}
      renderBoard();
    }
    renderBoard();
  }

  /* ── SIMON ─────────────────────────────────────────────────────────── */
  else if(TYPE==='simon'){
    var SCOLS=[{n:'rouge',h:'#ef4444'},{n:'bleu',h:'#3b82f6'},{n:'vert',h:'#22c55e'},{n:'jaune',h:'#eab308'}];
    var randInt0=function(n){return Math.floor(Math.random()*n);};
    var seq=[],step=0,showing=false,seqLen=3;
    for(var i=0;i<seqLen;i++)seq.push(SCOLS[randInt0(SCOLS.length)].n);
    gset('<div class="simon-grid">'+SCOLS.map(function(c){return'<button class="simon-btn" data-c="'+c.n+'" style="--c:'+c.h+'" disabled></button>';}).join('')+'</div><div id="simon-info" style="text-align:center;font-size:.8rem;color:#71717a;margin-top:.75rem">Regardez la séquence...</div>');
    var simonBtns=ga.querySelectorAll('.simon-btn'),simonInfo=document.getElementById('simon-info');
    function flash(idx,cb){
      var b=ga.querySelector('[data-c="'+seq[idx]+'"]');
      b.classList.add('lit');setTimeout(function(){b.classList.remove('lit');setTimeout(cb,200);},500);
    }
    function playSeq(i){
      showing=true;simonBtns.forEach(function(b){b.disabled=true;});
      if(i>=seq.length){showing=false;simonInfo.textContent='À vous !';simonBtns.forEach(function(b){b.disabled=false;});return;}
      flash(i,function(){playSeq(i+1);});
    }
    function enableBtns(){simonBtns.forEach(function(b){b.addEventListener('click',simonClick);});}
    function simonClick(){
      if(showing)return;
      var picked=this.dataset.c;
      if(picked===seq[step]){
        this.classList.add('lit');setTimeout(function(){ga.querySelectorAll('.simon-btn').forEach(function(b){b.classList.remove('lit');});},200);
        step++;
        if(step>=seq.length){simonBtns.forEach(function(b){b.disabled=true;});gstatus('Parfait ! Validation\u2026','ok');submit(SECRET);}
      } else {
        shake();gstatus('Raté ! La séquence recommence\u2026','err');
        simonBtns.forEach(function(b){b.disabled=true;});step=0;
        setTimeout(function(){gstatus('');playSeq(0);},1000);
      }
    }
    enableBtns();
    setTimeout(function(){playSeq(0);},600);
  }

  /* ── WHACK-A-MOLE ──────────────────────────────────────────────────── */
  else if(TYPE==='whack'){
    var score=0,moleTimer=null,activeMole=-1,locked2=false;
    gset('<div class="mole-grid">'+Array(9).fill(0).map(function(_,i){return'<div class="mole-hole" id="h'+i+'"><span class="mole-face">🐭</span></div>';}).join('')+'</div><div style="text-align:center;margin-top:.75rem"><span id="mole-score" style="font-size:.9rem;color:#a1a1aa">Taupes : 0 / 4</span></div>');
    function nextMole(){
      if(locked2)return;
      if(activeMole>=0){var ph=document.getElementById('h'+activeMole);if(ph)ph.classList.remove('active');}
      activeMole=Math.floor(Math.random()*9);
      var hole=document.getElementById('h'+activeMole);
      if(!hole)return;
      hole.classList.add('active');
      hole.onclick=function(){
        if(!this.classList.contains('active'))return;
        this.classList.remove('active');this.classList.add('bonk');
        setTimeout(function(){hole.classList.remove('bonk');},300);
        score++;document.getElementById('mole-score').textContent='Taupes : '+score+' / 4';
        if(score>=4){locked2=true;clearInterval(moleTimer);gstatus('Bien joué ! Validation...','ok');submit(SECRET);}
      };
    }
    moleTimer=setInterval(nextMole,900);nextMole();
    setTimeout(function(){
      if(!locked2){locked2=true;clearInterval(moleTimer);gstatus('Trop lent ! Réessayez.','err');
        setTimeout(function(){score=0;locked2=false;gstatus('');document.getElementById('mole-score').textContent='Taupes : 0 / 4';moleTimer=setInterval(nextMole,900);nextMole();},1500);}
    },15000);
  }

  /* ── SORT NUMBERS ──────────────────────────────────────────────────── */
  else if(TYPE==='sort_nums'){
    var pool=[],sorted=[],clicks=[],done3=false;
    while(pool.length<4){var n=Math.floor(Math.random()*20)+1;if(pool.indexOf(n)<0)pool.push(n);}
    sorted=pool.slice().sort(function(a,b){return a-b;});
    var shuffled=pool.slice().sort(function(){return Math.random()-.5;});
    function renderSort(){
      gset('<div class="sort-grid">'+shuffled.map(function(n){
        var used=clicks.indexOf(n)>=0;
        return'<button class="sort-btn'+(used?' used':'')+(done3?'':'')+'" data-n="'+n+'" '+(used?'disabled':'')+'>'+n+'</button>';
      }).join('')+'</div><div style="text-align:center;font-size:.75rem;color:#52525b;margin-top:.5rem">Ordre : '+clicks.join(' &lt; ')+'</div>');
      ga.querySelectorAll('.sort-btn:not([disabled])').forEach(function(b){
        b.addEventListener('click',function(){
          var n=+this.dataset.n;
          if(n===sorted[clicks.length]){
            clicks.push(n);renderSort();
            if(clicks.length===sorted.length){gstatus('Parfait ! Validation\u2026','ok');submit(SECRET);}
          } else {
            shake();gstatus('Mauvais ordre ! Recommencez.','err');
            clicks=[];setTimeout(function(){renderSort();gstatus('');},800);
          }
        });
      });
    }
    renderSort();
  }

  /* ── FIND EMOJI ────────────────────────────────────────────────────── */
  else if(TYPE==='find_emoji'){
    var EMLIST=['🌟','🎯','🍕','🚀','🦊','🎸','🐉','🌈','🍦','🎃','🦋','🎨'];
    var tidx=Math.floor(Math.random()*EMLIST.length);
    var target=EMLIST[tidx];
    var others=EMLIST.filter(function(_,i){return i!==tidx;});
    var grid=[];var targetCount=3;
    for(var t=0;t<targetCount;t++)grid.push({e:target,ok:true});
    while(grid.length<12)grid.push({e:others[Math.floor(Math.random()*others.length)],ok:false});
    grid.sort(function(){return Math.random()-.5;});
    var found=0;
    gset('<div style="text-align:center;font-size:.75rem;color:#71717a;margin-bottom:.5rem">Trouvez tous les <span style="font-size:1rem">'+target+'</span> ('+targetCount+' cachés)</div><div class="emoji-grid">'+grid.map(function(c,i){return'<button class="emoji-cell" data-i="'+i+'">'+c.e+'</button>';}).join('')+'</div>');
    ga.addEventListener('click',function(e){
      var b=e.target.closest('.emoji-cell');if(!b||b.disabled)return;
      var idx=+b.dataset.i;
      if(grid[idx].ok){
        b.disabled=true;b.classList.add('found');found++;
        if(found>=targetCount){gstatus('Tous trouvés ! Validation...','ok');submit(SECRET);}
      } else {
        shake(b);gstatus('Mauvais emoji, réessayez !','err');
        setTimeout(function(){gstatus('');},1000);
      }
    });
  }

  /* ── ROCK PAPER SCISSORS ────────────────────────────────────────────── */
  else if(TYPE==='rps'){
    var RPSMAP={rock:'✊',paper:'✋',scissors:'✌\uFE0F'};
    var RPSKEYS=Object.keys(RPSMAP);
    function rpsWins(a,b){return(a==='rock'&&b==='scissors')||(a==='scissors'&&b==='paper')||(a==='paper'&&b==='rock');}
    gset('<div class="rps-grid">'+RPSKEYS.map(function(k){return'<button class="rps-btn" data-k="'+k+'"><span>'+RPSMAP[k]+'</span><small>'+k.charAt(0).toUpperCase()+k.slice(1)+'</small></button>';}).join('')+'</div><div id="rps-result" style="text-align:center;min-height:2.5rem;padding-top:.5rem;font-size:.85rem;color:#a1a1aa"></div>');
    ga.addEventListener('click',function(e){
      var b=e.target.closest('.rps-btn');if(!b)return;
      ga.querySelectorAll('.rps-btn').forEach(function(x){x.disabled=true;x.classList.remove('picked');});
      b.classList.add('picked');
      var mine=b.dataset.k;
      var ai=RPSKEYS[Math.floor(Math.random()*3)];
      var res=document.getElementById('rps-result');
      var label=mine.charAt(0).toUpperCase()+mine.slice(1);
      var ailabel=ai.charAt(0).toUpperCase()+ai.slice(1);
      if(rpsWins(mine,ai)){
        res.innerHTML='Vous : '+RPSMAP[mine]+'  vs  IA : '+RPSMAP[ai]+'<br><b style="color:#22c55e">Gagné !</b>';
        gstatus('Vous avez gagné ! Validation\u2026','ok');submit(SECRET);
      } else if(mine===ai){
        res.innerHTML='Vous : '+RPSMAP[mine]+'  vs  IA : '+RPSMAP[ai]+'<br><span style="color:#eab308">Égalité, rejouez !</span>';
        setTimeout(function(){ga.querySelectorAll('.rps-btn').forEach(function(x){x.disabled=false;x.classList.remove('picked');});res.innerHTML='';},900);
      } else {
        res.innerHTML='Vous : '+RPSMAP[mine]+'  vs  IA : '+RPSMAP[ai]+'<br><span style="color:#ef4444">Perdu, réessayez !</span>';
        shake();setTimeout(function(){ga.querySelectorAll('.rps-btn').forEach(function(x){x.disabled=false;x.classList.remove('picked');});res.innerHTML='';},900);
      }
    });
  }

  /* ── SPEED CLICK ────────────────────────────────────────────────────── */
  else if(TYPE==='speed_click'){
    var TARGET=5,SECS=7,clicks2=0,started=false,timerSC=null;
    gset('<div style="text-align:center"><div id="sc-count" style="font-size:2rem;font-weight:700;color:#fafafa;margin-bottom:.5rem">0 / '+TARGET+'</div><div id="sc-bar-wrap" style="background:#27272a;border-radius:4px;height:6px;overflow:hidden;margin-bottom:1rem"><div id="sc-bar" style="height:100%;background:#22c55e;width:100%;transition:width .1s linear"></div></div><button id="sc-btn" class="btn-primary" style="padding:.75rem 2rem;font-size:1rem">CLIQUEZ !</button></div>');
    var scBtn=document.getElementById('sc-btn'),scCount=document.getElementById('sc-count'),scBar=document.getElementById('sc-bar');
    var deadline,rafSC;
    function updateBar(){
      if(!started)return;
      var left=Math.max(0,(deadline-Date.now())/(SECS*1000));
      scBar.style.width=(left*100)+'%';
      scBar.style.background=left>.4?'#22c55e':left>.15?'#eab308':'#ef4444';
      if(left>0)rafSC=requestAnimationFrame(updateBar);
    }
    scBtn.addEventListener('click',function(){
      if(!started){started=true;deadline=Date.now()+SECS*1000;rafSC=requestAnimationFrame(updateBar);
        timerSC=setTimeout(function(){
          if(clicks2<TARGET){scBtn.disabled=true;gstatus('Trop lent ! Réessayez.','err');
            setTimeout(function(){clicks2=0;started=false;scBtn.disabled=false;scCount.textContent='0 / '+TARGET;scBar.style.width='100%';gstatus('');},1500);}
        },SECS*1000);
      }
      clicks2++;scCount.textContent=clicks2+' / '+TARGET;
      if(clicks2>=TARGET){clearTimeout(timerSC);cancelAnimationFrame(rafSC);scBtn.disabled=true;gstatus('Incroyable ! Validation\u2026','ok');submit(SECRET);}
    });
  }

  /* ── SLIDER ─────────────────────────────────────────────────────────── */
  else if(TYPE==='slider'){
    var SLtarget=25+Math.floor(Math.random()*50),SLwidth=20;
    var SLmin=SLtarget,SLmax=SLtarget+SLwidth;
    gset('<div style="padding:.5rem 0"><div style="position:relative;height:20px;background:#27272a;border-radius:4px;margin-bottom:.75rem;overflow:hidden"><div style="position:absolute;left:'+SLtarget+'%;width:'+SLwidth+'%;height:100%;background:rgba(34,197,94,.3);border:1px solid #22c55e;border-radius:4px;pointer-events:none"></div></div><input type="range" id="sl" min="0" max="100" value="0" style="width:100%;accent-color:#fafafa;cursor:pointer"><div style="display:flex;justify-content:space-between;font-size:.7rem;color:#52525b;margin:.25rem 0"><span>0</span><span style="color:#22c55e">Zone cible</span><span>100</span></div><button id="sl-btn" class="btn-primary" style="width:100%;margin-top:.75rem">Valider la position</button></div>');
    document.getElementById('sl-btn').addEventListener('click',function(){
      var v=+document.getElementById('sl').value;
      if(v>=SLmin&&v<=SLmax){gstatus('Dans la zone ! Validation\u2026','ok');submit(SECRET);}
      else{shake();gstatus('Hors de la zone verte. Réessayez.','err');setTimeout(function(){gstatus('');},1000);}
    });
  }

})();
</script>
</body>
</html>`;
  }

  verifyChallengeToken(ip, token) {
    return verifyChallengeToken(ip, token);
  }

  verifyMathToken(ip, token, answer) {
    return verifyChallengeAnswer(ip, token, answer);
  }

  generateVerifiedCookie(ip) {
    return generateChallengeToken(ip);
  }

  // ── Ban / Unban ───────────────────────────────────────────────────────────

  async banIp(ip, domainId, reason, bannedBy, durationSec) {
    const clean     = ip.replace(/^::ffff:/, '');
    const expiresAt = durationSec ? new Date(Date.now() + durationSec * 1000) : null;
    console.log(`[DDoS] BANNING ${clean} domain=${domainId} reason="${reason}" by=${bannedBy} duration=${durationSec}s`);

    try {
      if (this.redis) {
        const key = domainId
          ? `ddos:ban:domain:${domainId}:${clean}`
          : `ddos:ban:global:${clean}`;
        if (durationSec > 0) await this.redis.setex(key, durationSec, reason);
        else                  await this.redis.set(key, reason);
      }
    } catch (_) {}

    // Immediately kill all open TCP sockets for this IP — don't wait for them to reconnect
    this._killSockets(clean, domainId);

    try {
      await database.execute(
        `INSERT INTO ddos_ip_bans (ip_address, domain_id, reason, banned_by, expires_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [clean, domainId || null, reason, bannedBy, expiresAt]
      );
    } catch (_) {}
  }

  _banIpAsync(ip, domainId, reason, bannedBy, durationSec) {
    this.banIp(ip, domainId, reason, bannedBy, durationSec).catch(() => {});
  }

  async unbanIp(id) {
    const r   = await database.execute(
      `UPDATE ddos_ip_bans SET expires_at = NOW() WHERE id = $1 RETURNING ip_address, domain_id`,
      [id]
    );
    const ban = r?.rows?.[0];
    if (!ban) return;
    try {
      if (this.redis) {
        const key = ban.domain_id
          ? `ddos:ban:domain:${ban.domain_id}:${ban.ip_address}`
          : `ddos:ban:global:${ban.ip_address}`;
        await this.redis.del(key);
      }
    } catch (_) {}
  }

  async getActiveBans({ ip, domainId, limit = 50, offset = 0 } = {}) {
    let q = `SELECT b.*, d.hostname FROM ddos_ip_bans b
             LEFT JOIN domains d ON b.domain_id = d.id
             WHERE (b.expires_at IS NULL OR b.expires_at > NOW())`;
    const params = [];
    if (ip)       { params.push(`%${ip}%`);   q += ` AND b.ip_address LIKE $${params.length}`; }
    if (domainId) { params.push(domainId);    q += ` AND b.domain_id = $${params.length}`;     }
    params.push(limit, offset);
    q += ` ORDER BY b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const r = await database.execute(q, params);
    return r?.rows || [];
  }

  // ── Events ────────────────────────────────────────────────────────────────

  _queueEvent(ip, domainId, attackType, details) {
    this._eventQueue.push({ ip, domainId, attackType, details });
  }

  async _flushEvents() {
    if (this._eventQueue.length === 0) return;
    const batch = this._eventQueue.splice(0, 100);
    for (const ev of batch) {
      try {
        await database.execute(
          `INSERT INTO ddos_attack_events (ip_address, domain_id, attack_type, details) VALUES ($1, $2, $3, $4)`,
          [ev.ip, ev.domainId || null, ev.attackType, JSON.stringify(ev.details || {})]
        );
      } catch (_) {}
    }
  }

  async getAttackEvents({ limit = 100, domainId, attackType } = {}) {
    let q = `SELECT e.*, d.hostname FROM ddos_attack_events e
             LEFT JOIN domains d ON e.domain_id = d.id WHERE 1=1`;
    const params = [];
    if (domainId)   { params.push(domainId);   q += ` AND e.domain_id = $${params.length}`;   }
    if (attackType) { params.push(attackType); q += ` AND e.attack_type = $${params.length}`; }
    params.push(limit);
    q += ` ORDER BY e.created_at DESC LIMIT $${params.length}`;
    const r = await database.execute(q, params);
    return r?.rows || [];
  }

  async getAttackStats() {
    const r = await database.execute(`
      SELECT attack_type,
             COUNT(*)                    AS count,
             COUNT(DISTINCT ip_address)  AS unique_ips
      FROM ddos_attack_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY attack_type ORDER BY count DESC
    `);
    return r?.rows || [];
  }

  // ── Global stats ──────────────────────────────────────────────────────────

  async getBanStats() {
    const r = await database.execute(`
      SELECT
        COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) AS active_bans,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS blocked_today,
        COUNT(*) AS total_bans
      FROM ddos_ip_bans
    `);
    return {
      ...(r?.rows?.[0] || {}),
      blocklist_ips:    this._blocklistIpSet.size,
      blocklist_cidrs:  this._blocklistCidrs.length,
      whitelist_count:  this._whitelistIpSet.size + this._whitelistCidrs.length,
      active_connections: this._connectionCount.size,
    };
  }

  async getBlocklistMeta() {
    const r = await database.execute(`SELECT * FROM ddos_blocklist_meta ORDER BY source`);
    return r?.rows || [];
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    if (this._syncTimer)       { clearInterval(this._syncTimer); }
    if (this._eventFlushTimer) { clearInterval(this._eventFlushTimer); }
    this._flushEvents().catch(() => {});
  }
}

export const ddosProtectionService = new DdosProtectionService();
