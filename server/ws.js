'use strict';
// Minimaler WebSocket-Server (RFC 6455), damit das Projekt ohne npm-Pakete läuft.

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.open = true;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentBytes = 0;
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _onData(data) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    while (this.open) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.close();
        len = Number(big);
        off = 10;
      }
      if (len > MAX_PAYLOAD) return this.close();
      if (!masked) return this.close(); // Clients müssen laut RFC 6455 maskieren
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;

      let payload = Buffer.from(this.buf.subarray(off + maskLen, off + maskLen + len));
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(off + maskLen + len);

      if (op === 0x8) return this.close();
      if (op === 0x9) { this._frame(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x0 || op === 0x1 || op === 0x2) {
        // Auch eine in viele Teile zerlegte Nachricht darf insgesamt nicht größer werden
        this.fragmentBytes += payload.length;
        if (this.fragmentBytes > MAX_PAYLOAD) return this.close();
        this.fragments.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.fragments).toString('utf8');
          this.fragments = [];
          this.fragmentBytes = 0;
          this.emit('message', msg);
        }
      }
    }
  }

  _frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(str) {
    // Langsame Clients nicht endlos puffern
    if (!this.open || this.socket.writableLength > 1024 * 1024) return;
    this._frame(0x1, Buffer.from(str, 'utf8'));
  }

  close() {
    if (!this.open) return;
    try { this._frame(0x8, Buffer.alloc(0)); } catch (_) { /* ignore */ }
    this.socket.end();
    this._closed();
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.socket.destroy();
    this.emit('close');
  }
}

function acceptWebSocket(req, socket, onConnection) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);
  onConnection(new WsConnection(socket));
}

module.exports = { acceptWebSocket };
