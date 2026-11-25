import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './security.js';

// These costs are constants, never environment-controlled or read from a hash.
export const SCRYPT_PARAMETERS = Object.freeze({
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 192 * 1024 * 1024,
});
export const MAX_CONCURRENT_HASHES = 2;
const MAX_QUEUED_HASHES = 32;
const KEY_BYTES = 64;
const deriveKey = promisify(scrypt);
const waiting = [];
let active = 0;

export function validatePassword(password) {
  if (typeof password !== 'string' || !password.isWellFormed() ||
      Buffer.byteLength(password, 'utf8') > 512) {
    fail('invalid_password', 'Use a password of 15–128 Unicode characters (at most 512 UTF-8 bytes).');
  }
  const length = [...password].length;
  if (length < 15 || length > 128) {
    fail('invalid_password', 'Use a password of 15–128 Unicode characters (at most 512 UTF-8 bytes).');
  }
  // Preserve spaces, Unicode and punctuation exactly; never trim or normalize.
  return password;
}

async function boundedScrypt(password, salt) {
  if (active >= MAX_CONCURRENT_HASHES) {
    if (waiting.length >= MAX_QUEUED_HASHES) {
      fail('auth_busy', 'Authentication is busy. Please try again shortly.', 503);
    }
    await new Promise(resolve => waiting.push(resolve));
  } else {
    active += 1;
  }
  try {
    return await deriveKey(password, salt, KEY_BYTES, SCRYPT_PARAMETERS);
  } finally {
    // Transfer the occupied slot directly to a queued operation.
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const key = await boundedScrypt(password, salt);
  return `scrypt$131072$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, storedHash) {
  validatePassword(password);
  // Unknown accounts and unsupported/corrupt hashes incur the same fixed cost.
  const match = typeof storedHash === 'string'
    ? /^scrypt\$131072\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/.exec(storedHash)
    : null;
  let validEncoding = false;
  let salt = Buffer.alloc(16, 0x7b);
  let expected = Buffer.alloc(KEY_BYTES);
  if (match) {
    const decodedSalt = Buffer.from(match[1], 'base64url');
    const decodedKey = Buffer.from(match[2], 'base64url');
    validEncoding = decodedSalt.length === 16 && decodedKey.length === KEY_BYTES &&
      decodedSalt.toString('base64url') === match[1] && decodedKey.toString('base64url') === match[2];
    if (validEncoding) {
      salt = decodedSalt;
      expected = decodedKey;
    }
  }
  const actual = await boundedScrypt(password, salt);
  const equal = timingSafeEqual(actual, expected);
  return validEncoding && equal;
}
