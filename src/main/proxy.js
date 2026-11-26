'use strict';
const http = require('http');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const { copyWithResume } = require('./resume');

// Only these answer headers are passed on from the phone.
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control', 'content-disposition'];

// How much of a video the app fetches ahead of what the player has asked for. It smooths over Wi-Fi dips:
// while the player is happy the buffer fills, and when the Wi-Fi stutters the player drinks from the buffer.
const READ_AHEAD_BYTES = 96 * 1024 * 1024;

/**
 * A tiny web server that only listens on this PC (127.0.0.1). The video player, the image and PDF viewers and
 * an outside player such as VLC open http://127.0.0.1:PORT/m/TOKEN/file?... and the app fetches the file from
 * the phone over the pinned, signed-in connection. The token is new on every start, so other programs and web
 * pages cannot use it.
 *
 * Two things keep playback smooth:
 *  - a large read-ahead buffer, so a Wi-Fi hiccup does not reach the player;
 *  - if the phone drops the connection part-way through, the app asks for the rest from the same byte and
 *    carries on. The player never sees it.
 *
 * getConnection: () => Connection | null
 */
function startProxy(getConnection, options) {
  const opts = options || {};
  const readAhead = opts.readAheadBytes || READ_AHEAD_BYTES;
  const token = crypto.randomBytes(16).toString('hex');
  const prefix = '/m/' + token + '/';
  let port = 0;
  const arrivals = [];            // [time, bytes] for chunks that came from the phone in the last few seconds
  const counters = { resumes: 0 };

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, If-Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
  };

  function fail(res, status, text) {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, corsHeaders));
    res.end(text);
  }

  function noteBytes(connection, n) {
    const now = Date.now();
    arrivals.push([now, n]);
    while (arrivals.length && now - arrivals[0][0] > 4000) arrivals.shift();
    if (connection && connection.noteActivity) connection.noteActivity();
  }

  /** How fast the phone is sending right now, in bytes a second. Null when nothing is coming (the buffer is full or paused). */
  function speed() {
    const now = Date.now();
    const recent = arrivals.filter((a) => now - a[0] < 3000);
    if (recent.length < 2) return null;
    const span = (recent[recent.length - 1][0] - recent[0][0]) / 1000;
    if (span < 0.2) return null;
    const bytes = recent.slice(1).reduce((sum, a) => sum + a[1], 0);
    return bytes / span;
  }

  const server = http.createServer(async (req, res) => {
    try {
      // A web page that tricks the browser into using another name for this PC is turned away.
      if (req.headers.host !== '127.0.0.1:' + port) return fail(res, 403, 'Forbidden');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Not allowed');
      if (!req.url.startsWith(prefix)) return fail(res, 404, 'Not found');

      const url = new URL(req.url, 'http://127.0.0.1');
      const route = url.pathname.slice(prefix.length);
      if (route !== 'file' && route !== 'subtitle') return fail(res, 404, 'Not found');
      const lib = url.searchParams.get('lib');
      const filePath = url.searchParams.get('path');
      if (!lib || !filePath) return fail(res, 400, 'Missing folder or file');

      const connection = getConnection();
      if (!connection) return fail(res, 503, 'Not connected to a phone');

      const upstream = '/' + route + '?lib=' + encodeURIComponent(lib) + '&path=' + encodeURIComponent(filePath);
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];

      const controller = new AbortController();
      res.on('close', () => controller.abort()); // the player went away: stop pulling from the phone
      let answer;
      try {
        answer = await connection.stream(upstream, { headers, signal: controller.signal });
      } catch (err) {
        return fail(res, 502, err.message || 'The phone did not answer');
      }

      const out = Object.assign({}, corsHeaders);
      for (const name of PASS) if (answer.headers[name] !== undefined) out[name] = answer.headers[name];
      res.writeHead(answer.statusCode, out);
      if (req.method === 'HEAD') {
        answer.destroy();
        return res.end();
      }
      const buffer = new PassThrough({ highWaterMark: readAhead });
      buffer.on('error', () => res.destroy());
      res.on('close', () => buffer.destroy());
      buffer.pipe(res);
      const extra = headers['If-Range'] ? { 'If-Range': headers['If-Range'] } : {};
      copyWithResume({
        connection, upstream, extraHeaders: extra, first: answer, out: buffer, signal: controller.signal,
        onBytes: (n) => noteBytes(connection, n),
        onResume: () => { counters.resumes++; },
        maxResumes: opts.maxResumes, retryDelayMs: opts.retryDelayMs,
      }).catch(() => buffer.destroy());
    } catch (err) {
      fail(res, 500, 'Something went wrong');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve({
        port,
        token,
        base: 'http://127.0.0.1:' + port + '/m/' + token,
        /** What the viewer's info panel shows about the link to the phone. */
        stats: () => ({ bytesPerSecond: speed(), reconnects: counters.resumes }),
        close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections && server.closeAllConnections(); }),
      });
    });
  });
}

module.exports = { startProxy };
