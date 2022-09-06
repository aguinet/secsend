import {BaseID, FileID, RootID} from './fileid';
import {fromBase36} from './utils';
const b64 = require('base64-arraybuffer');

export class JSONDownloadURL {
  id: string;
  key: string;
}

export class DownloadURL {
  readonly id: BaseID;
  readonly key: ArrayBuffer;
  fileURL: DownloadURL | null;
  fileURLPromise: Promise<void> | null;

  constructor(id: BaseID, key: ArrayBuffer, crypto: Crypto) {
    this.id = id;
    this.key = key;

    // We have a problem here with Choo, that can't handle asynchronous states,
    // and we need it to compute the file ID from the root ID, because the
    // WebCrypto API is fully asynchronous.
    // We need this hacky mechanism were we set the fileURL property in a
    // promise, and give access to the promise for asynchronous function (so
    // that they can await it).
    if (id instanceof FileID) {
      this.fileURL = this;
      this.fileURLPromise = null;
    }
    else {
      this.fileURL = null;
      this.fileURLPromise = (id as RootID).fileID(crypto).then((fid: FileID) => {
        this.fileURL = new DownloadURL(fid, key, crypto); });
    }
  }

  static keyFromTxt(s: string): ArrayBuffer {
    const n = fromBase36(s);
    // Convert n to little-endian
    const ret = new ArrayBuffer(16);
    const view = new DataView(ret);
    view.setBigUint64(0, BigInt.asUintN(64, n), true);
    view.setBigUint64(8, BigInt.asUintN(64, n >> 64n), true);
    return ret;
  }

  static keyToTxt(key: ArrayBuffer): string {
    // Convert key to a little-endian integer
    const view = new DataView(key);
    const n0 = view.getBigUint64(0, true);
    const n1 = view.getBigUint64(8, true);
    const n = n0 | (n1 << 64n);
    // Return the base36 representation of n
    return n.toString(36);
  }

  jsonable(): JSONDownloadURL {
    return {id: this.id.str(), key: b64.encode(this.key)};
  }

  static fromJsonable(data: JSONDownloadURL, crypto: Crypto): DownloadURL {
    return new DownloadURL(BaseID.fromStr(data.id, null), b64.decode(data.key), crypto);
  }
}

export function parseDownloadURL(url: string, crypto: Crypto) {
  const obj = new URL(url);
  const keyTxt = obj.hash.substr(1);
  const id = obj.pathname.substr("/v1/download/".length);
  const bid = BaseID.fromStr(id, null);
  const preview = obj.searchParams.get("v") === "1";
  return {url: new DownloadURL(bid, DownloadURL.keyFromTxt(keyTxt), crypto), preview};
}

export function genWebDownloadURL(base: string, url: DownloadURL, preview: boolean, withKey = true): string {
  let ret = base + "/dl?id=" + url.id.str();
  if (preview) {
    ret += "&v=1";
  }
  if (withKey) {
    ret += "#" + DownloadURL.keyToTxt(url.key);
  }
  return ret;
}
