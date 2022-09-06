/* eslint-disable @typescript-eslint/no-var-requires */
import {AESGCMChunks, encryptFunc} from '../src/core/e2ee';
import {ChunksTransformer, StreamChunkerTransformer, StreamTruncateTransform, StreamSkipBytesTransform, transformStream} from '../src/core/transformers';
import {readStream} from './utils';
require("web-streams-polyfill");

const crypto = require('crypto').webcrypto;

function getReadableStream() {
  return new ReadableStream<ArrayBuffer>({
    start(controller) {
      const encoder = new TextEncoder();
      for (let i = 0; i < 10; i+=1) {
        const string = "test " + i;
        controller.enqueue(encoder.encode(string));
      }
      controller.close();
    },
    pull() { },
    cancel() { }
  });
}

test('encryptStream', async () => {
  const aesgcm = await AESGCMChunks.generate(crypto);
  const encrStream = new ChunksTransformer(encryptFunc(aesgcm), 0);

  const inStream = getReadableStream();
  // @ts-ignore
  const reader = transformStream(inStream, encrStream).getReader();

  const encoder = new TextEncoder();
  for (let i = 0; i < 10; i++) {
    const ref = await aesgcm.encrypt(encoder.encode("test " + i), i);
    expect((await reader.read()).value).toEqual(new Uint8Array(ref));
  }
  expect((await reader.read()).done).toBe(true);
});

test('streamChunker', async () => {
  const inStream = getReadableStream();
  const chunker = new StreamChunkerTransformer(2);

  const encoder = new TextEncoder();
  const reader = transformStream(inStream, chunker).getReader();
  for (let i = 0; i < 10; i++) {
    expect((await reader.read()).value).toEqual(encoder.encode("te"));
    expect((await reader.read()).value).toEqual(encoder.encode("st"));
    expect((await reader.read()).value).toEqual(encoder.encode(" " + i));
  }
  expect((await reader.read()).done).toBe(true);
});

test('streamChunkerFlush', async () => {
  const encoder = new TextEncoder();
  const inStream = new ReadableStream<ArrayBuffer>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("0123456789"));
      controller.close();
    },
    pull() { },
    cancel() { }
  });

  const chunker = new StreamChunkerTransformer(6);
  const reader = transformStream(inStream, chunker).getReader();
  expect((await reader.read()).value).toEqual(encoder.encode("012345"));
  expect((await reader.read()).value).toEqual(encoder.encode("6789"));
  expect((await reader.read()).done).toBe(true);
});

test('truncate', async () => {
  const inStream = getReadableStream();
  const truncate = new StreamTruncateTransform(1,1);
  const reader = transformStream(inStream, truncate).getReader();

  const encoder = new TextEncoder();
  expect((await reader.read()).value).toEqual(encoder.encode("est 0"));
  for (let i = 1; i < 9; i++) {
    expect((await reader.read()).value).toEqual(encoder.encode("test " + i));
  }
  expect((await reader.read()).value).toEqual(encoder.encode("t"));
  expect((await reader.read()).done).toBe(true);
});

test('skipBytes', async () => {
  const complete = await readStream(getReadableStream());
  for (let i = 0; i < complete.length+1; i += 1) {
    const inStream = getReadableStream();
    const stream = transformStream(inStream, new StreamSkipBytesTransform(i));

    const out = await readStream(stream);
    expect(out).toStrictEqual(complete.slice(i));
  }
});
