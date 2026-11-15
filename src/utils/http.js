function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let exceeded = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        exceeded = true;
        data = '';
        return;
      }
      if (!exceeded) data += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (exceeded) {
        const error = new Error('Request body too large');
        error.statusCode = 413;
        reject(error);
      } else resolve(data);
    });
    req.on('error', reject);
  });
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY'
  });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

module.exports = { esc, readBody, sendHtml, redirect };
