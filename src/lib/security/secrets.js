import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function key() {
  const raw = String(process.env.STUDIO_SECRET_KEY || '').trim();
  if (!raw) return null;
  const decoded = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (decoded.length !== 32) throw new Error('STUDIO_SECRET_KEY must be a 32-byte base64 value or 64-character hex value');
  return decoded;
}

export function hasSecretKey() { return Boolean(key()); }

export function encryptSecret(value) {
  const encryptionKey = key();
  if (!encryptionKey) throw new Error('Set STUDIO_SECRET_KEY before connecting Gmail; mailbox refresh tokens are never stored plaintext.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptSecret(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (!raw.startsWith(PREFIX)) return raw; // compatibility for existing non-mail connection settings
  const encryptionKey = key();
  if (!encryptionKey) throw new Error('STUDIO_SECRET_KEY is required to decrypt local secrets.');
  const [, , ivText, tagText, ciphertextText] = raw.split(':');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Stored secret is malformed.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

export function isEncryptedSecret(value) { return String(value || '').startsWith(PREFIX); }
