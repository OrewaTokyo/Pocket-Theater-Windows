'use strict';
const fs = require('fs');
const { Transform, PassThrough, pipeline } = require('stream');
const { copyWithResume } = require('./resume');
const { AppError, fromNetworkError } = require('./errors');
const { readAll } = require('./connection');
const { fileQuery } = require('./util');

/**
 * Saves one shared file to `destPath`. It is written under a temporary name and renamed at the end, so a
 * cancelled or broken download never leaves a half file that looks finished.
 * onProgress(received, total) is called at most about 6 times a second. total is 0 when the phone did not say.
 */
async function downloadFile(connection, lib, parts, destPath, options) {
  const opts = options || {};
  const res = await connection.stream('/file?' + fileQuery(lib, parts), { signal: opts.signal });
  if (res.statusCode !== 200) {
    const body = await readAll(res, 64 * 1024).catch(() => Buffer.alloc(0));
    let message = 'The phone could not send that file (' + res.statusCode + ').';
    try { message = JSON.parse(body.toString('utf8')).error || message; } catch (err) { /* generic sentence */ }
    throw new AppError(message, 'HTTP', res.statusCode);
  }
  const total = Number(res.headers['content-length']) || 0;
  const upstream = '/file?' + fileQuery(lib, parts);
  const partPath = destPath + '.part';
  const source = new PassThrough();
  let received = 0;
  let lastReport = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      const now = Date.now();
      if (opts.onProgress && now - lastReport > 160) { lastReport = now; opts.onProgress(received, total); }
      cb(null, chunk);
    },
  });
  try {
    await new Promise((resolve, reject) => {
      pipeline(source, counter, fs.createWriteStream(partPath), (err) => (err ? reject(err) : resolve()));
      // If the phone drops the connection part-way, the download carries on from the same byte.
      const signal = opts.signal || new AbortController().signal;
      copyWithResume({
        connection, upstream, extraHeaders: {}, first: res, out: source, signal,
        onBytes: () => { if (connection.noteActivity) connection.noteActivity(); },
        maxResumes: opts.maxResumes, retryDelayMs: opts.retryDelayMs,
      }).then(
        () => { if (signal.aborted) source.destroy(new Error('aborted')); }, // cancelled: end the download instead of waiting forever
        (err) => source.destroy(err)
      );
    });
    if (total && received !== total) throw new AppError('The download stopped early. Try again.', 'NETWORK');
    fs.renameSync(partPath, destPath);
    if (opts.onProgress) opts.onProgress(received, total || received);
    return received;
  } catch (err) {
    try { fs.unlinkSync(partPath); } catch (e) { /* nothing to remove */ }
    if (opts.signal && opts.signal.aborted) throw new AppError('Cancelled.', 'ABORT');
    throw err instanceof AppError ? err : fromNetworkError(err);
  }
}

module.exports = { downloadFile };
