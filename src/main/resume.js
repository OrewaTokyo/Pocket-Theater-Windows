'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until a stream can take more data, or is gone. */
function drained(stream) {
  return new Promise((resolve) => {
    const done = () => { stream.off('drain', done); stream.off('close', done); resolve(); };
    stream.once('drain', done);
    stream.once('close', done);
  });
}

/** The part of a file an answer covers: { start, end } (end is inclusive), or null when it is not known. */
function coverage(answer) {
  const range = /^bytes (\d+)-(\d+)\/(\d+|\*)/.exec(answer.headers['content-range'] || '');
  if (answer.statusCode === 206 && range) return { start: Number(range[1]), end: Number(range[2]) };
  const length = Number(answer.headers['content-length']);
  if (answer.statusCode === 200 && Number.isFinite(length) && length > 0) return { start: 0, end: length - 1 };
  return null;
}

/**
 * Copies an answer from the phone into `out`. If the phone drops the connection before the end (Wi-Fi hiccup,
 * the phone giving up on a slow reader), it asks for the rest from the same byte and carries on, so the reader
 * never sees a gap and never gets a byte twice. If the phone is really gone it destroys `out` with an error,
 * so the reader knows the file is incomplete rather than being handed a shortened one.
 *
 * o: { connection, upstream, extraHeaders, first, out, signal, onBytes(n), onResume(), maxResumes, retryDelayMs }
 */
async function copyWithResume(o) {
  const maxResumes = o.maxResumes || 8;
  const retryDelay = o.retryDelayMs || 250;
  const out = o.out;
  let answer = o.first;
  const covered = coverage(answer);
  let offset = covered ? covered.start : 0;
  const end = covered ? covered.end : null;
  let failures = 0;
  while (true) {
    try {
      for await (const chunk of answer) {
        if (out.destroyed) { answer.destroy(); return; }
        offset += chunk.length;
        failures = 0;
        if (o.onBytes) o.onBytes(chunk.length);
        if (!out.write(chunk)) await drained(out);
      }
    } catch (err) {
      // the connection to the phone dropped; handled below
    }
    if (o.signal.aborted || out.destroyed) return;
    if (end === null || offset > end) { out.end(); return; }

    // It stopped before the end. Ask for the rest.
    let resumed = false;
    while (!resumed) {
      if (++failures > maxResumes) { out.destroy(new Error('The phone stopped answering.')); return; }
      await sleep(Math.min(retryDelay * failures, 2500));
      if (o.signal.aborted || out.destroyed) return;
      try {
        const headers = Object.assign({}, o.extraHeaders, { Range: 'bytes=' + offset + '-' + end });
        const next = await o.connection.stream(o.upstream, { headers, signal: o.signal });
        const got = coverage(next);
        if (next.statusCode === 206 && got && got.start === offset) {
          answer = next;
          resumed = true;
          if (o.onResume) o.onResume();
        } else {
          next.resume();
          if (next.statusCode < 500) { out.destroy(new Error('The file changed on the phone.')); return; }
        }
      } catch (err) {
        if (o.signal.aborted) return;
      }
    }
  }
}

module.exports = { copyWithResume, coverage };
