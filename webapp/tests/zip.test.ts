import {ZipArchive} from '../src/gui/zip';
import {crc32} from '../src/gui/crc32';
import {readStream} from './utils';
import {Blob} from 'buffer';
const unzipper = require("unzipper");

require("web-streams-polyfill");

test('crc32', async () => {
  const crc32txt = async (text: string, crcStart = 0) => {
    return crc32(new TextEncoder().encode(text), crcStart);
  };

  expect(await crc32txt("")).toStrictEqual(0);
  expect(await crc32txt("coucou")).toStrictEqual(0xf0baebc7);

  let crc = await crc32txt("hello");
  crc = await crc32txt(" world", crc);
  expect(await crc32txt("hello world")).toStrictEqual(crc);
});

function txtFile(name: string, txt: string) {
  return {name, blob: new Blob([new TextEncoder().encode(txt)]), lastMod: new Date(Date.now())};
}

test('simplezip', async() => {
  const fn = "fileutf8_é.txt";
  const content = "coucou\n";
  const f0 = txtFile(fn, content);
  const archive = new ZipArchive();
  // @ts-ignore
  archive.add(f0);

  const data = await readStream(archive.stream());
  expect(data.length).toStrictEqual(archive.size);

  const zip = await unzipper.Open.buffer(Buffer.from(data));
  expect(zip.files.length).toStrictEqual(1);
  const extf = zip.files[0];
  expect(extf.path).toStrictEqual(fn);
  expect(new TextDecoder().decode(await extf.buffer())).toStrictEqual(content);
});

test('multiplezip', async() => {
  const f0 = txtFile("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.txt", "data");
  const f1 = txtFile("f0.txt", "coucou\n");
  const f2 = txtFile("f1.txt", "hello world!\n");
  const f3 = txtFile("Привіт Світ.txt", "test utf8\n");
  const archive = new ZipArchive();
  // @ts-ignore
  archive.add(f0);
  // @ts-ignore
  archive.add(f1);
  // @ts-ignore
  archive.add(f2);
  // @ts-ignore
  archive.add(f3);

  const data = await readStream(archive.stream());
  expect(data.length).toStrictEqual(archive.size);

  const zip = await unzipper.Open.buffer(Buffer.from(data));
  expect(zip.files.length).toStrictEqual(archive.files.length);

  let fidx = 0;
  for (const {name, blob} of archive.files) {
    const extf = zip.files[fidx++];
    expect(extf.path).toStrictEqual(name);
    expect(await extf.buffer()).toStrictEqual(Buffer.from(await blob.arrayBuffer()));
  }
});
