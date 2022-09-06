const b64 = require('base64-arraybuffer');
export type FileID = string;

// WEN ETA native stuff in javascript for hexadecimal processing...
//
// https://stackoverflow.com/questions/40031688/javascript-arraybuffer-to-hex
export function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): ArrayBuffer {
  const ret = new Uint8Array(hex.length/2);
  for (let c = 0; c < ret.length; c += 1) {
    ret[c] = parseInt(hex.substr(c*2, 2), 16);
  }
  return ret.buffer;
}

export function fromBase36(s: string): bigint {
  // Adapted from https://stackoverflow.com/questions/55646698/base-36-to-bigint
  return [...s].reduce((r, v) => r * 36n + BigInt(parseInt(v, 36)), 0n);
}

export function deriveKey(crypto: Crypto, key: ArrayBuffer, prefix: string): Promise<ArrayBuffer> {
  const encPrefix = new TextEncoder().encode(prefix);
  const data = new Uint8Array([...encPrefix, ...new Uint8Array(key)]);
  return crypto.subtle.digest("SHA-256", data);
}

export class Cancellable {
  shouldCancel: boolean;
  onCancel: () => void;

  constructor() {
    this.reset();
    this.onCancel = () => {};
  }

  addOnCancel(func: () => void) {
    const oldCancel = this.onCancel;
    this.onCancel = () => {
      oldCancel();
      func();
    };
  }

  reset() {
    this.shouldCancel = false;
  }

  cancel() {
    this.shouldCancel = true;
    if (this.onCancel !== null) {
      this.onCancel();
    }
  }
}

export function jsonReplaceArrayBuffer(key: any, value: any) {
  if (value instanceof ArrayBuffer) {
    return b64.encode(value);
  }
  return value;
}

export function arrayBufferEqual(A: ArrayBuffer, B: ArrayBuffer) {
  const VA = new DataView(A);
  const VB = new DataView(B);
  if (VA.byteLength !== VB.byteLength) {
    return false;
  }
  for (let i = 0; i < VA.byteLength; i++) {
    if (VA.getUint8(i) !== VB.getUint8(i)) {
      return false;
    }
  }
  return true;
}

export function b64_urlsafe_encode(buf: ArrayBuffer): string {
  return b64.encode(buf)
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function b64_urlsafe_decode(base64: string): ArrayBuffer {
  base64 = base64
    .replace(/-/g, '+') // Convert '-' to '+'
    .replace(/_/g, '/'); // Convert '_' to '/'

  // Add removed at end '='
  base64 += Array(2-base64.length % 3).join('=');

  return b64.decode(base64);
}
