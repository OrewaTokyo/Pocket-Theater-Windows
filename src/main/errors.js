'use strict';

/** An error with a sentence a person can act on in .message. `code` says what kind it is. */
class AppError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AppError';
    this.code = code || 'ERROR';
    this.status = status || 0;
  }
}

const CERT_MESSAGE =
  "The phone's security certificate is not the one you trusted. If you renewed it on the phone, remove this phone here and add it again.";

/** Turns a Node network error into an AppError. Codes: NETWORK, CERT, ABORT. */
function fromNetworkError(err) {
  if (err instanceof AppError) return err;
  const code = (err && err.code) || '';
  if (code === 'CERT_CHANGED') return new AppError(CERT_MESSAGE, 'CERT');
  if (code === 'ECONNREFUSED') {
    return new AppError('The phone refused the connection. Open Pocket Theater on the phone and make sure the theater is open.', 'NETWORK');
  }
  if (['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ENETDOWN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return new AppError("Can't reach the phone. Check that it is on the same Wi-Fi as this PC and that the theater is open.", 'NETWORK');
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED') {
    return new AppError('The connection to the phone dropped.', 'NETWORK');
  }
  if (code === 'ABORT_ERR' || (err && err.name === 'AbortError')) return new AppError('Cancelled.', 'ABORT');
  if (code.startsWith('ERR_SSL') || code.startsWith('ERR_TLS') || /wrong version number|handshake/i.test((err && err.message) || '')) {
    return new AppError('The phone did not answer with a secure connection on that port. Try the address without a port.', 'NETWORK');
  }
  return new AppError((err && err.message) || "Can't reach the phone.", 'NETWORK');
}

module.exports = { AppError, fromNetworkError, CERT_MESSAGE };
