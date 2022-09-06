/* eslint-disable @typescript-eslint/no-var-requires */
import {AESGCMChunks, signKey, verifyKey} from '../src/core/e2ee';
import {Metadata, encryptMetadata, decryptMetadata} from '../src/core/metadata';

// For whatever reason, if we do an ES6-style import for this, the interface we
// get is empty...
const crypto = require('crypto').webcrypto;

test('encrypt/decrypt', async () => {
  const aesgcm = await AESGCMChunks.generate(crypto);

  const data = Buffer.from("hello world!", "ascii");
  for (let i = 0; i < 10; ++i) {
    const encr = await aesgcm.encrypt(data, i);
    const decr = await aesgcm.decrypt(encr, i);
    expect(Buffer.from(decr)).toStrictEqual(data);
  }
  const encr = await aesgcm.encrypt(data, 0);
  // Bad chunk idx => bad IV => bad tag
  await expect(aesgcm.decrypt(encr, 1)).rejects.toThrow();
});

test('encrDecrSizes', async () => {
  for (const chunkSize of [1,100,1024,1024*1024]) {
    for (const size of [0,1,2,4,chunkSize-1,chunkSize,chunkSize+1,chunkSize*2+1,chunkSize*2-1,78332319]) {
      const encrSize = AESGCMChunks.encryptedSize(size, chunkSize);
      const decrSize = AESGCMChunks.decryptedSize(encrSize, chunkSize);
      expect(decrSize).toStrictEqual(size);
    }
  }
});

test('keyCommit', async () => {
  const iv = new Uint8Array(12);
  await crypto.getRandomValues(iv);
  const key = new Uint8Array(16);
  await crypto.getRandomValues(key);

  const sign = await signKey(crypto, key, iv);
  expect(await verifyKey(crypto, sign, key, iv)).toBe(true);

  const key2 = new Uint8Array(16);
  await crypto.getRandomValues(key);
  expect(await verifyKey(crypto, sign, key2, iv)).toBe(false);
});

test('metadata', async () => {
  const aesgcm = await AESGCMChunks.generate(crypto);
  const sign = await signKey(crypto, aesgcm.key, aesgcm.iv);
  const metadata = new Metadata(1, "hello", "mime", aesgcm.iv, 10, "aes-gcm", false, sign, 0);
  const encrMetadata = await encryptMetadata(metadata, aesgcm);
  const decrMetadata = await decryptMetadata(encrMetadata, aesgcm);
  expect(decrMetadata).toStrictEqual(metadata);
});

// TODO: more tests with active data corruption
