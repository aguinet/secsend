import {Ciphers, ALGO_NAMES, signKey} from './e2ee';
const b64 = require('base64-arraybuffer');

interface EncryptedMetadataJSON {
  version: number;
  name: string;
  mime_type: string;
  iv: string;
  chunk_size: number;
  algo: string;
  complete: boolean;
  key_sign: string;
  timeout_s: number;
}

export class MetadataError extends Error { }
export class MetadataErrorUnsupportedAlgo extends MetadataError {
  constructor(algo: string) {
    super("unsupported algorithm '" + algo + "'");
  }
}
export class MetadataErrorUnsupportedVersion extends MetadataError {
  constructor(version: number) {
    super("unsupported version '" + version + "'");
  }
}

export class EncryptedMetadata {
  version: number;
  name: ArrayBuffer;
  mimeType: ArrayBuffer;
  iv: ArrayBuffer;
  chunkSize: ArrayBuffer;
  algo: string;
  complete: boolean;
  keySign: ArrayBuffer;
  timeoutSec: number;

  constructor(version: number, name: ArrayBuffer, mimeType: ArrayBuffer, iv: ArrayBuffer, chunkSize: ArrayBuffer, algo: string, complete: boolean, keySign: ArrayBuffer, timeoutSec: number) {
    this.version = version;
    this.name = name;
    this.mimeType = mimeType;
    this.iv = iv;
    this.chunkSize = chunkSize;
    this.algo = algo;
    this.complete = complete;
    this.keySign = keySign;
    this.timeoutSec = timeoutSec;
  }

  jsonable(): EncryptedMetadataJSON {
    return {
      "version": this.version,
      "name": b64.encode(this.name),
      "mime_type": b64.encode(this.mimeType),
      "iv": b64.encode(this.iv),
      "chunk_size": b64.encode(this.chunkSize),
      "algo": this.algo,
      "complete": this.complete,
      "key_sign": b64.encode(this.keySign),
      "timeout_s": this.timeoutSec
    };
  }

  static fromJsonable(data: EncryptedMetadataJSON): EncryptedMetadata {
    if (!ALGO_NAMES.has(data.algo)) {
      throw new MetadataErrorUnsupportedAlgo(data.algo);
    }
    if (data.version !== 1) {
      throw new MetadataErrorUnsupportedVersion(data.version);
    }
    const iv = b64.decode(data.iv);
    const keySign = b64.decode(data.key_sign);
    const name = b64.decode(data.name);
    const mimeType = b64.decode(data.mime_type);
    const chunkSize = b64.decode(data.chunk_size);
    return new EncryptedMetadata(data.version, name, mimeType, iv, chunkSize, data.algo, data.complete, keySign, data.timeout_s);
  }
}

export class Metadata {
  version: number;
  name: string;
  mimeType: string;
  iv: ArrayBuffer;
  chunkSize: number;
  algo: string;
  complete: boolean;
  keySign: ArrayBuffer;
  timeoutSec: number;

  constructor(version: number, name: string, mimeType: string, iv: ArrayBuffer, chunkSize: number, algo: string, complete: boolean, keySign: ArrayBuffer, timeoutSec: number) {
    this.version = version;
    this.name = name;
    this.mimeType = mimeType;
    this.iv = iv;
    this.chunkSize = chunkSize;
    this.algo = algo;
    this.complete = complete;
    this.keySign = keySign;
    this.timeoutSec = timeoutSec;
  }

  static async create(name: string, mime: string, cipher: Ciphers, timeoutSec: number): Promise<Metadata> {
    // Commit key
    const keySign = await signKey(cipher.crypto, await cipher.fragment(), cipher.iv);
    return new Metadata(
      1, // version
      name,
      mime,
      cipher.iv,
      // TODO: compute this
      1024*1024,
      cipher.protoName(),
      true,
      keySign,
      timeoutSec
    );
  }

  static async fromFile(file: File, cipher: Ciphers, timeoutSec: number): Promise<Metadata> {
    let mime = file.type;
    if (mime === "") {
      mime = "application/octet-stream";
    }
    return Metadata.create(file.name, mime, cipher, timeoutSec);
  }
}

export async function encryptMetadata(metadata: Metadata, cipher: Ciphers): Promise<EncryptedMetadata> {
  const encrStr = (idx: number, s: string) => {
    const v = new TextEncoder().encode(s);
    return cipher.encrSignMetadata(idx, v);
  };
  const encrInt = (idx: number, v: number) => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, v, true /* little endian */);
    return cipher.encrSignMetadata(idx, buf);
  };

  return new EncryptedMetadata(
    metadata.version,
    await encrStr(0, metadata.name),
    await encrStr(1, metadata.mimeType),
    metadata.iv,
    await encrInt(2, metadata.chunkSize),
    metadata.algo,
    metadata.complete,
    metadata.keySign,
    metadata.timeoutSec,
  );
}

export async function decryptMetadata(metadata: EncryptedMetadata, cipher: Ciphers): Promise<Metadata> {
  const decrStr = async (idx: number, v: ArrayBuffer) => {
    v = await cipher.decrVerifyMetadata(idx, v);
    return new TextDecoder().decode(v);
  };
  const decrInt = async (idx: number, v: ArrayBuffer) => {
    v = await cipher.decrVerifyMetadata(idx, v);
    const view = new DataView(v);
    return view.getUint32(0, true /* little endian */);
  };

  return new Metadata(
    metadata.version,
    await decrStr(0, metadata.name),
    await decrStr(1, metadata.mimeType),
    metadata.iv,
    await decrInt(2, metadata.chunkSize),
    metadata.algo,
    metadata.complete,
    metadata.keySign,
    metadata.timeoutSec
  );
}

