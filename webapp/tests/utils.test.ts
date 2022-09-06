/* eslint-disable @typescript-eslint/no-var-requires */
import {b64_urlsafe_encode, b64_urlsafe_decode, toHex, fromBase36} from '../src/core/utils';
import {BaseID, RootID, IDKind} from '../src/core/fileid';

const crypto = require('crypto').webcrypto;

test('b64_urlsafe', async () => {
  for (let n = 100; n < 107; n++) {
    const data = new Uint8Array(n);
    await crypto.getRandomValues(data);
    const b64 = b64_urlsafe_encode(data);
    const dec = b64_urlsafe_decode(b64);
    expect(new Uint8Array(dec)).toStrictEqual(data);
  }
});

test('url', async() => {
  const idb = new Uint8Array(32);
  await crypto.getRandomValues(idb);
  const rid = new RootID(idb.buffer);
  const rid_str = rid.str();

  const rid_parsed = RootID.fromStr(rid_str, null);
  expect(rid_parsed.id).toStrictEqual(rid.id);

  const fid = await rid.fileID(crypto);
  const fid_str = fid.str();
  const fid_parsed = BaseID.fromStr(fid_str, IDKind.File_);
  expect(fid_parsed.id).toStrictEqual(fid.id);
});

test('base36', async () => {
  for (let n = 0; n < 1000; n++) {
    const v = new Uint8Array(16);
    await crypto.getRandomValues(v);
    const n = BigInt('0x' + toHex(v));
    expect(fromBase36(n.toString(36))).toStrictEqual(n);
  }
});
