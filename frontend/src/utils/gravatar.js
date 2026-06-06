// Minimal MD5 — replaces the blueimp-md5 package (same algorithm, no external dep)
// Gravatar requires MD5; SHA-256 is not yet universally supported by all Gravatar mirrors.
function md5(str) {
  function safeAdd(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff); }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a,b,c,d,x,s,t){ return md5cmn((b&c)|((~b)&d),a,b,x,s,t); }
  function md5gg(a,b,c,d,x,s,t){ return md5cmn((b&d)|(c&(~d)),a,b,x,s,t); }
  function md5hh(a,b,c,d,x,s,t){ return md5cmn(b^c^d,a,b,x,s,t); }
  function md5ii(a,b,c,d,x,s,t){ return md5cmn(c^(b|(~d)),a,b,x,s,t); }

  const utf8 = unescape(encodeURIComponent(str));
  const len8 = utf8.length;
  const n32 = len8 >> 2;
  const M = new Array(n32 + (len8 % 4 ? 1 : 0) + 2).fill(0);
  for (let i = 0; i < len8; i++) M[i >> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8);
  M[len8 >> 2] |= 0x80 << ((len8 % 4) * 8);
  M[M.length - 1] = len8 * 8;

  let [a, b, c, d] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const T = Array.from({length:64},(_,i) => (Math.abs(Math.sin(i+1)) * 0x100000000)|0);
  for (let i = 0; i < M.length; i += 16) {
    const [aa,bb,cc,dd] = [a,b,c,d];
    a=md5ff(a,b,c,d,M[i+ 0], 7,T[ 0]);d=md5ff(d,a,b,c,M[i+ 1],12,T[ 1]);c=md5ff(c,d,a,b,M[i+ 2],17,T[ 2]);b=md5ff(b,c,d,a,M[i+ 3],22,T[ 3]);
    a=md5ff(a,b,c,d,M[i+ 4], 7,T[ 4]);d=md5ff(d,a,b,c,M[i+ 5],12,T[ 5]);c=md5ff(c,d,a,b,M[i+ 6],17,T[ 6]);b=md5ff(b,c,d,a,M[i+ 7],22,T[ 7]);
    a=md5ff(a,b,c,d,M[i+ 8], 7,T[ 8]);d=md5ff(d,a,b,c,M[i+ 9],12,T[ 9]);c=md5ff(c,d,a,b,M[i+10],17,T[10]);b=md5ff(b,c,d,a,M[i+11],22,T[11]);
    a=md5ff(a,b,c,d,M[i+12], 7,T[12]);d=md5ff(d,a,b,c,M[i+13],12,T[13]);c=md5ff(c,d,a,b,M[i+14],17,T[14]);b=md5ff(b,c,d,a,M[i+15],22,T[15]);
    a=md5gg(a,b,c,d,M[i+ 1], 5,T[16]);d=md5gg(d,a,b,c,M[i+ 6], 9,T[17]);c=md5gg(c,d,a,b,M[i+11],14,T[18]);b=md5gg(b,c,d,a,M[i+ 0],20,T[19]);
    a=md5gg(a,b,c,d,M[i+ 5], 5,T[20]);d=md5gg(d,a,b,c,M[i+10], 9,T[21]);c=md5gg(c,d,a,b,M[i+15],14,T[22]);b=md5gg(b,c,d,a,M[i+ 4],20,T[23]);
    a=md5gg(a,b,c,d,M[i+ 9], 5,T[24]);d=md5gg(d,a,b,c,M[i+14], 9,T[25]);c=md5gg(c,d,a,b,M[i+ 3],14,T[26]);b=md5gg(b,c,d,a,M[i+ 8],20,T[27]);
    a=md5gg(a,b,c,d,M[i+13], 5,T[28]);d=md5gg(d,a,b,c,M[i+ 2], 9,T[29]);c=md5gg(c,d,a,b,M[i+ 7],14,T[30]);b=md5gg(b,c,d,a,M[i+12],20,T[31]);
    a=md5hh(a,b,c,d,M[i+ 5], 4,T[32]);d=md5hh(d,a,b,c,M[i+ 8],11,T[33]);c=md5hh(c,d,a,b,M[i+11],16,T[34]);b=md5hh(b,c,d,a,M[i+14],23,T[35]);
    a=md5hh(a,b,c,d,M[i+ 1], 4,T[36]);d=md5hh(d,a,b,c,M[i+ 4],11,T[37]);c=md5hh(c,d,a,b,M[i+ 7],16,T[38]);b=md5hh(b,c,d,a,M[i+10],23,T[39]);
    a=md5hh(a,b,c,d,M[i+13], 4,T[40]);d=md5hh(d,a,b,c,M[i+ 0],11,T[41]);c=md5hh(c,d,a,b,M[i+ 3],16,T[42]);b=md5hh(b,c,d,a,M[i+ 6],23,T[43]);
    a=md5hh(a,b,c,d,M[i+ 9], 4,T[44]);d=md5hh(d,a,b,c,M[i+12],11,T[45]);c=md5hh(c,d,a,b,M[i+15],16,T[46]);b=md5hh(b,c,d,a,M[i+ 2],23,T[47]);
    a=md5ii(a,b,c,d,M[i+ 0], 6,T[48]);d=md5ii(d,a,b,c,M[i+ 7],10,T[49]);c=md5ii(c,d,a,b,M[i+14],15,T[50]);b=md5ii(b,c,d,a,M[i+ 5],21,T[51]);
    a=md5ii(a,b,c,d,M[i+12], 6,T[52]);d=md5ii(d,a,b,c,M[i+ 3],10,T[53]);c=md5ii(c,d,a,b,M[i+10],15,T[54]);b=md5ii(b,c,d,a,M[i+ 1],21,T[55]);
    a=md5ii(a,b,c,d,M[i+ 8], 6,T[56]);d=md5ii(d,a,b,c,M[i+15],10,T[57]);c=md5ii(c,d,a,b,M[i+ 6],15,T[58]);b=md5ii(b,c,d,a,M[i+13],21,T[59]);
    a=md5ii(a,b,c,d,M[i+ 4], 6,T[60]);d=md5ii(d,a,b,c,M[i+11],10,T[61]);c=md5ii(c,d,a,b,M[i+ 2],15,T[62]);b=md5ii(b,c,d,a,M[i+ 9],21,T[63]);
    a=safeAdd(a,aa);b=safeAdd(b,bb);c=safeAdd(c,cc);d=safeAdd(d,dd);
  }
  return [a,b,c,d].map(n => ('00000000' + (n & 0xffffffff).toString(16)).slice(-8).match(/../g).reverse().join('')).join('');
}

/**
 * @param {string} email
 * @param {number} [size]
 * @param {string} [defaultImage]
 * @returns {string|null}
 */
export function getGravatarUrl(email, size = 80, defaultImage = 'identicon') {
  if (!email) return null;
  const hash = md5(email.trim().toLowerCase());
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${defaultImage}`;
}

/**
 * @param {string|null} avatarUrl
 * @param {string} email
 * @param {number} [size]
 * @param {string|number|null} [avatarUpdatedAt]
 * @returns {string|null}
 */
export function getAvatarUrl(avatarUrl, email, size = 80, avatarUpdatedAt = null) {
  if (avatarUrl) {
    if (!avatarUpdatedAt) return avatarUrl;
    const ts = typeof avatarUpdatedAt === 'string' ? new Date(avatarUpdatedAt).getTime() : avatarUpdatedAt;
    const sep = avatarUrl.includes('?') ? '&' : '?';
    return `${avatarUrl}${sep}t=${ts}`;
  }
  if (email) return getGravatarUrl(email, size);
  return null;
}
