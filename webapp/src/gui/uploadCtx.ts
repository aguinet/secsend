import {Client, UploadCanceled} from '../core/client';
import {Metadata, encryptMetadata, decryptMetadata} from '../core/metadata';
import {AESGCMChunks, encryptFunc, verifyKey} from '../core/e2ee';
import {StreamChunkerTransformer, ChunksTransformer, StreamSkipBytesTransform, transformStream} from '../core/transformers';
import {StreamRange} from '../core/range';
import {Cancellable} from '../core/utils';
import {DownloadURL} from '../core/url';
import {RootID} from '../core/fileid';
import {FileOrArchive} from './types';

export class InvalidKey extends Error { }

function getMetadata(input: FileOrArchive, cipher: AESGCMChunks, timeout: number) {
  if (input instanceof File) {
    return Metadata.fromFile(input as File, cipher, timeout);
  }
  return Metadata.create(input.name, "application/zip", cipher, timeout);
}

export class UploadCtx {
  client: Client;
  stream: ReadableStream;
  sentBytes: number;
  readonly metadata: Metadata;
  readonly encrSize: number;
  readonly url: DownloadURL;

  constructor(stream: ReadableStream, metadata: Metadata, encrSize: number, url: DownloadURL, client: Client, sentBytes: number) {
    this.stream = stream;
    this.metadata = metadata;
    this.encrSize = encrSize;
    this.url = url;
    this.client = client;
    this.sentBytes = sentBytes;
  }

  id() {
    return this.url.id as RootID;
  }

  static async uploadNew(crypto: Crypto, client: Client, file: FileOrArchive, timeout: number): Promise<UploadCtx> {
    const cipher = await AESGCMChunks.generate(crypto);
    const metadata = await getMetadata(file, cipher, timeout);
    const encrMetadata = await encryptMetadata(metadata, cipher);
    const id = await client.upload_new(encrMetadata);

    // file => chunk (encryption) => encrypt
    const transEncr = new ChunksTransformer(encryptFunc(cipher), 0);

    // @ts-ignore
    let stream = transformStream(file.stream(), new StreamChunkerTransformer(metadata.chunkSize));
    stream = transformStream(stream, transEncr);

    const totalBytes = AESGCMChunks.encryptedSize(file.size, metadata.chunkSize);

    const url = new DownloadURL(id, await cipher.fragment(), crypto);
    await url.fileURLPromise;
    return new UploadCtx(stream, metadata, totalBytes, url, client, 0);
  }

  static async uploadResume(crypto: Crypto, client: Client, file: FileOrArchive, url: DownloadURL): Promise<UploadCtx> {
    await url.fileURLPromise;
    const {metadata: encrMetadata, size: curOutSize} = await client.metadata(url.fileURL.id);
    if ((await verifyKey(crypto, encrMetadata.keySign, url.key, encrMetadata.iv)) === false) {
      throw new InvalidKey();
    }
    const cipher = await AESGCMChunks.import(crypto, encrMetadata.iv, url.key);
    const metadata = await decryptMetadata(encrMetadata, cipher);
    const totalBytes = AESGCMChunks.encryptedSize(file.size, metadata.chunkSize);

    const outChunkSize = AESGCMChunks.outChunkSize(metadata.chunkSize);
    const range = StreamRange.compute(metadata.chunkSize, outChunkSize, curOutSize, null);

    const transEncr = new ChunksTransformer(encryptFunc(cipher), range.inChunkBegin);
    let stream;
    if (file instanceof File) {
      stream = file.slice(range.inStreamSeekBytes).stream();
    }
    else {
      stream = transformStream(file.stream(), new StreamSkipBytesTransform(range.inStreamSeekBytes));
    }
    // @ts-ignore
    stream = transformStream(stream, new StreamChunkerTransformer(metadata.chunkSize));
    stream = transformStream(stream, transEncr);
    stream = transformStream(stream, range.outTruncator());

    return new UploadCtx(stream, metadata, totalBytes, url, client, curOutSize);
  }

  async run(cbProgress: (sent: number, total: number) => void, cancellable: Cancellable): Promise<void> {
    const reader = this.stream.getReader();

    // For each chunk of streamUpload, make a push API call
    while (true) {
      const {value, done} = await reader.read();
      if (done) {
        break;
      }
      if (cancellable.shouldCancel) {
        throw new UploadCanceled();
      }
      await this.client.upload_push_blob(this.id(), value, (chunkSent: number) => {
        cbProgress(this.sentBytes + chunkSent, this.encrSize);
      }, cancellable);
      this.sentBytes += value.length;
      cbProgress(this.sentBytes, this.encrSize);
    }
    await this.client.upload_finish(this.id());
  }

}
