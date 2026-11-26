'use strict';
const tls = require('tls');
const net = require('net');
const { fingerprintOf } = require('./util');
const { AppError, fromNetworkError } = require('./errors');

/**
 * Connects to the phone and reads the certificate it shows, without trusting it yet.
 * The app shows the fingerprint, the person compares it with the one on the phone, and only then is it pinned.
 */
function probeCertificate(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const options = { host, port, rejectUnauthorized: false, minVersion: 'TLSv1.2' };
    if (!net.isIP(host)) options.servername = host;
    const socket = tls.connect(options);
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(fromNetworkError(err)); else resolve(value);
    };
    socket.setTimeout(timeoutMs || 6000, () => finish(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    socket.once('error', (err) => finish(err));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(false);
      if (!cert || !cert.raw) return finish(new AppError('The phone did not show a certificate.', 'NETWORK'));
      finish(null, {
        fingerprint: fingerprintOf(cert.raw),
        subject: (cert.subject && cert.subject.CN) || '',
        validTo: cert.valid_to || '',
      });
    });
  });
}

module.exports = { probeCertificate };
