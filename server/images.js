/** Image validation by magic bytes — the browser-declared MIME type is never trusted on its own. */

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const head6 = buf.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Returns { mime } for a valid image buffer, or { error }. */
function validateImage(file, maxBytes) {
  if (!file || !file.buffer || file.buffer.length === 0) return { error: 'Fichier vide.' };
  if (file.buffer.length > maxBytes) return { error: `Image trop lourde (max ${Math.round(maxBytes / 1048576)} Mo).` };
  const mime = sniffMime(file.buffer);
  if (!mime || !ALLOWED_MIME.has(mime)) return { error: 'Format non pris en charge (JPG, PNG, GIF ou WEBP uniquement).' };
  return { mime };
}

module.exports = { ALLOWED_MIME, sniffMime, validateImage };
