import {arrayBufferEqual, deriveKey} from './utils';

export type CipherFunc = (data: BufferSource, chunkIdx: number) => Promise<ArrayBuffer>

function deriveFileKey(crypto: Crypto, key: ArrayBuffer): Promise<ArrayBuffer> {
  return deriveKey(crypto, key, "secsend_file");
}

function deriveMetadataKey(crypto: Crypto, key: ArrayBuffer): Promise<ArrayBuffer> {
  return deriveKey(crypto, key, "secsend_meta");
}

export class AESGCMChunks {
  readonly iv: ArrayBuffer;
  readonly key: ArrayBuffer;
  readonly fileKey: CryptoKey;
  readonly metadataKey: CryptoKey;
  readonly crypto: Crypto;

  static readonly KEY_LEN = 16;
  static readonly TAG_LEN = 16;
  static readonly IV_LEN = 12;

  static readonly PROTO_NAME = "aes-gcm";

  protoName(): string { return AESGCMChunks.PROTO_NAME; }

  constructor(crypto: Crypto, iv: ArrayBuffer, key: ArrayBuffer, fileKey: CryptoKey, metadataKey: CryptoKey) {
    this.iv = iv;
    this.key = key;
    this.fileKey = fileKey;
    this.metadataKey = metadataKey;
    this.crypto = crypto;
  }

  static async import(crypto: Crypto, iv: ArrayBuffer, key: ArrayBuffer): Promise<AESGCMChunks> {
    const importKey = (key: ArrayBuffer): Promise<CryptoKey> => {
      return crypto.subtle.importKey('raw', key,
        'AES-GCM', false, ["encrypt","decrypt"]);
    };
    const fileKeyProm = deriveFileKey(crypto, key).then(importKey);
    const metadataKeyProm = deriveMetadataKey(crypto, key).then(importKey);

    return new AESGCMChunks(crypto, iv, key, await fileKeyProm, await metadataKeyProm);
  }

  static async generate(crypto: Crypto): Promise<AESGCMChunks> {
    const iv = new Uint8Array(12);
    const key = new Uint8Array(16);
    const ivRand = crypto.getRandomValues(iv);
    const keyRand = crypto.getRandomValues(key);
    await ivRand;
    await keyRand;
    return AESGCMChunks.import(crypto, iv.buffer, key.buffer);
  }

  static outChunkSize(inChunkSize: number): number {
    return inChunkSize + AESGCMChunks.TAG_LEN;
  }

  static encryptedSize(clearSize: number, chunkSize: number): number {
    const nchunks = Math.floor(clearSize/chunkSize);
    let ret = nchunks*(chunkSize+AESGCMChunks.TAG_LEN);
    const rem = clearSize%chunkSize;
    if (rem > 0) {
      ret += rem+AESGCMChunks.TAG_LEN;
    }
    return ret;
  }

  static decryptedSize(encrSize: number, chunkSize: number): number {
    const encrChunkSize = this.outChunkSize(chunkSize);
    const nchunks = Math.floor(encrSize/encrChunkSize);
    let ret = nchunks*chunkSize;
    const rem = encrSize%encrChunkSize;
    if (rem > 0) {
      ret += rem-AESGCMChunks.TAG_LEN;
    }
    return ret;
  }

  fragment(): ArrayBuffer {
    return this.key;
  }

  async encrypt(data: BufferSource, chunkIdx: number): Promise<ArrayBuffer> {
    const algo = this.algoChunk(chunkIdx);
    return this.crypto.subtle.encrypt(algo, this.fileKey, data);
  }

  async decrypt(data: BufferSource, chunkIdx: number): Promise<ArrayBuffer> {
    const algo = this.algoChunk(chunkIdx);
    return this.crypto.subtle.decrypt(algo, this.fileKey, data);
  }

  async encrSignMetadata(idx: number, toencr: BufferSource) {
    const algo = this.algoChunk(idx);
    return this.crypto.subtle.encrypt(algo, this.metadataKey, toencr);
  }

  async decrVerifyMetadata(idx: number, encr: BufferSource) {
    const algo = this.algoChunk(idx);
    return this.crypto.subtle.decrypt(algo, this.metadataKey, encr);
  }

  private algoChunk(idx: number) {
    return {
      name: "AES-GCM",
      iv: this.chunkIV(idx),
      tagLength: AESGCMChunks.TAG_LEN*8
    };
  }
  private chunkIV(idx: number) {
    const ret = this.iv.slice(0);
    const view = new DataView(ret);
    let n = view.getBigUint64(0, true /* little endian */);
    n += BigInt(idx);
    view.setBigUint64(0, n, true /* little endian */);
    return ret;
  }
}

export type Ciphers = AESGCMChunks;
export const ALGO_NAMES = new Map([
  [AESGCMChunks.PROTO_NAME, AESGCMChunks]
]);


export function encryptFunc(obj: Ciphers): CipherFunc {
  return (data: BufferSource, chunkIdx: number) => obj.encrypt(data, chunkIdx);
}

export function decryptFunc(obj: Ciphers): CipherFunc {
  return (data: BufferSource, chunkIdx: number) => obj.decrypt(data, chunkIdx);
}

export function signKey(crypto: Crypto, key: ArrayBuffer, nonce: ArrayBuffer): Promise<ArrayBuffer> {
  return deriveKey(crypto, new Uint8Array([...new Uint8Array(nonce), ...new Uint8Array(key)]), "secsend_sign");
}

export async function verifyKey(crypto: Crypto, sign: ArrayBuffer, key: ArrayBuffer, nonce: ArrayBuffer): Promise<boolean> {
  const refSign = await signKey(crypto, key, nonce);
  return arrayBufferEqual(refSign, sign);
}
