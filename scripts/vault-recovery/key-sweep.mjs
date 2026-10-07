import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const REPOS = {
  zip: '/home/z/my-project/zip',
  saos: '/home/z/my-project/saos-dex',
  Console: '/home/z/Console',
  Domain: '/home/z/Domain',
  steem: '/home/z/steem',
};
const WIF = /\b(5[HJK]|4[HJK]|STM[45]|BLT[45]|BLP[45]|T[1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{47,52}\b/g;
const ACCOUNT_CTX = /\b(headcorner|saos[a-z._-]*|zip[a-z._-]*|fleet[a-z._-]*|roshpina[a-z._-]*)\b/gi;
const results = {};

for (const [name, path] of Object.entries(REPOS)) {
  try {
    const revs = execSync('git rev-list --all --objects', { cwd: path, maxBuffer: 512 * 1024 * 1024, timeout: 120000 }).toString().split('\n');
    const seen = new Map();
    for (const line of revs) {
      const t = line.trim();
      if (!t) continue;
      const sp = t.indexOf(' ');
      const sha = sp === -1 ? t : t.slice(0, sp);
      const p = sp === -1 ? '(no-path)' : t.slice(sp + 1);
      if (/^[0-9a-f]{40}$/.test(sha)) seen.set(sha, p);
    }
    const shas = [...seen.keys()];
    const bs = execSync("git cat-file --batch-check='%(objectname) %(objecttype) %(objectsize)'", { cwd: path, maxBuffer: 512 * 1024 * 1024, input: shas.join('\n'), timeout: 180000 }).toString();
    const blobs = bs.split('\n').filter(l => l.includes(' blob ') && parseInt(l.split(' ').pop()) < 300000).map(l => l.split(' ')[0]);
    let found = [];
    let scanned = 0;
    for (const bsha of blobs) {
      try {
        const content = execSync('git cat-file -p ' + bsha, { cwd: path, maxBuffer: 8 * 1024 * 1024, timeout: 20000 }).toString();
        scanned++;
        const ctx = [...new Set(content.match(ACCOUNT_CTX) || [])].slice(0, 3).join(',');
        const wifs = [...new Set(content.match(WIF) || [])];
        for (const w of wifs) {
          found.push({ masked: w.slice(0, 8) + '…' + w.slice(-4), len: w.length, prefix: w.slice(0, 4), path: seen.get(bsha), blob: bsha.slice(0, 8), ctx });
        }
      } catch (e) { /* skip huge/odd blob */ }
    }
    results[name] = { blobs: blobs.length, scanned, found: found.slice(0, 150) };
    console.log('[' + name + '] blobs<300KB: ' + blobs.length + ' scanned:' + scanned + ' wif-hits:' + found.length);
  } catch (e) {
    console.log('[' + name + '] ERROR ' + String(e.message).slice(0, 120));
  }
}
writeFileSync('/home/z/fleet-tmp/key-sweep-results.json', JSON.stringify(results, null, 1));
console.log('saved');
