const speakeasy = require('speakeasy');
const crypto = require('crypto');

const generate2FASecret = () => speakeasy.generateSecret({ length: 20 });
const verify2FAToken = (secret, token) => speakeasy.totp.verify({ secret: secret.base32, encoding: 'base32', token, window: 1 });
const decryptRefreshToken = (encryptedToken) => {
  if (!encryptedToken.endsWith('.encrypted')) return null;
  const decipher = crypto.createDecipheriv('aes-256-cbc', process.env.ENCRYPTION_KEY, Buffer.alloc(16, 0));
  return decipher.update(encryptedToken.split('.encrypted')[0], 'hex', 'utf8') + decipher.final('utf8');
};

module.exports = { generate2FASecret, verify2FAToken, decryptRefreshToken };