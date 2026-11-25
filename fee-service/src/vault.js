import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { FeeError } from './policy.js';
export class Vault {
  constructor(hexKey) {
    if (!/^[a-fA-F0-9]{64}$/.test(hexKey || '')) throw new FeeError('missing_encryption_key', 'PAYLOAD_ENCRYPTION_KEY must be a 32-byte hex key.', 503);
    this.key = Buffer.from(hexKey, 'hex');
  }
  seal(data, context) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const content = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), content].map(value => value.toString('base64url')).join('.');
  }
  open(encrypted, context) {
    const [iv, tag, content] = encrypted.split('.').map(value => Buffer.from(value, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8'));
  }
}
