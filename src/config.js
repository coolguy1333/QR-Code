import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const env = process.env;
const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: Number(env.PORT) || 8080,
  host: env.HOST || '0.0.0.0',
  dataDir: resolve(env.DATA_DIR || './data'),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
  trustProxy: bool(env.TRUST_PROXY, false),
  siteName: (env.SITE_NAME || 'QR Studio').slice(0, 60),
  adminEmails: (env.ADMIN_EMAILS || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean),
  maxUploadBytes: 15 * 1024 * 1024,
  maxJsonBytes: 3 * 1024 * 1024,
};

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(resolve(config.dataDir, 'files'), { recursive: true });
