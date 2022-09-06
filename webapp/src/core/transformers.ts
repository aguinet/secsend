import {CipherFunc} from './e2ee';

// Adapted from
// https://github.com/mozilla/send/blob/ade10e496c064d3b29191dd33b1066bf99607d74/app/ece.js#L224
// This code is performance critical, and any changes must be done with that in
// mind. Especially, the `chunk` argument of the `transform` function can be
// several thousands of megabytes wide.
export class StreamChunkerTransformer {
  readonly chunkSize: number;
  partialChunk: Uint8Array;
  offset: number;

  constructor(chunkSize: number) {
    this.chunkSize = chunkSize;
    this.partialChunk = new Uint8Array(chunkSize);
    this.offset = 0;
  }

  transform(chunk: ArrayBuffer, controller: TransformStreamDefaultController) {
    let i = 0;

    if (this.offset > 0) {
      const len = Math.min(chunk.byteLength, this.chunkSize - this.offset);
      this.partialChunk.set(new Uint8Array(chunk.slice(0, len)), this.offset);
      this.offset += len;
      i += len;

      if (this.offset === this.chunkSize) {
        this.send(this.partialChunk, controller);
      }
    }

    while (i < chunk.byteLength) {
      const remainingBytes = chunk.byteLength - i;
      if (remainingBytes >= this.chunkSize) {
        const record = chunk.slice(i, i + this.chunkSize);
        i += this.chunkSize;
        this.send(new Uint8Array(record), controller);
      } else {
        const end = chunk.slice(i, i + remainingBytes);
        i += end.byteLength;
        this.partialChunk.set(new Uint8Array(end));
        this.offset = end.byteLength;
      }
    }
  }

  flush(controller: TransformStreamDefaultController) {
    if (this.offset > 0) {
      controller.enqueue(this.partialChunk.slice(0, this.offset));
    }
  }

  private send(buf: Uint8Array, controller: TransformStreamDefaultController) {
    controller.enqueue(buf);
    // TODO: reuse same buffer?
    this.partialChunk = new Uint8Array(this.chunkSize);
    this.offset = 0;
  }
}

export class ChunksTransformer {
  cipherFunc: CipherFunc;
  chunkIdx: number;

  constructor(cipherFunc: CipherFunc, chunkIdxStart: number) {
    this.chunkIdx = chunkIdxStart;
    this.cipherFunc = cipherFunc;
  }

  start() { }
  flush() { }

  async transform(chunk: ArrayBuffer, controller: TransformStreamDefaultController) {
    try {
      const decrChunk = await this.cipherFunc(chunk, this.chunkIdx);
      controller.enqueue(new Uint8Array(decrChunk));
    }
    catch (e) {
      controller.error(e);
    }
    this.chunkIdx += 1;
  }
}

export class StreamTruncateTransform {
  firstSkip: number;
  lastSize: number | null;
  prevChunk: ArrayBuffer | null;

  constructor(firstSkip: number, lastSize: number | null) {
    this.firstSkip = firstSkip;
    this.lastSize = lastSize;
    this.prevChunk = null;
  }

  transform(chunk: ArrayBuffer, controller: TransformStreamDefaultController) {
    if (this.prevChunk === null) {
      this.prevChunk = chunk.slice(this.firstSkip);
      return;
    }
    controller.enqueue(this.prevChunk);
    this.prevChunk = chunk;
  }

  flush(controller: TransformStreamDefaultController) {
    if (this.prevChunk === null) {
      return;
    }
    let chunk: ArrayBuffer;
    if (this.lastSize !== null) {
      chunk = this.prevChunk.slice(0, this.lastSize);
    }
    else {
      chunk = this.prevChunk;
    }
    controller.enqueue(chunk);
  }
}

export class StreamSkipBytesTransform {
  bytesToSkip: number | null;
  skippedBytes: number;

  constructor(bytesToSkip: number) {
    this.bytesToSkip = bytesToSkip;
    this.skippedBytes = 0;
  }

  transform(chunk: ArrayBuffer, controller: TransformStreamDefaultController) {
    if (this.bytesToSkip === null) {
      controller.enqueue(chunk);
      return;
    }
    this.skippedBytes += chunk.byteLength;
    if (this.skippedBytes > this.bytesToSkip) {
      controller.enqueue(chunk.slice(this.bytesToSkip - this.skippedBytes));
      this.bytesToSkip = null;
    }
  }
}

// Unfortunately, firefox doesn't support TransformStream yet. We use this
// wrapper function, adapted from
// https://github.com/mozilla/send/blob/ade10e496c064d3b29191dd33b1066bf99607d74/app/streams.js
export function transformStream<R>(readable: ReadableStream<R>, transformer: any, oncancel: any = null): ReadableStream<R> {
  try {
    return readable.pipeThrough(new TransformStream(transformer));
  } catch (e) {
    const reader = readable.getReader();
    return new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        if (transformer.start) {
          return transformer.start(controller);
        }
      },
      async pull(controller: ReadableStreamDefaultController) {
        let enqueued = false;
        const wrappedController = {
          enqueue(d: any) {
            enqueued = true;
            controller.enqueue(d);
          }
        };
        while (!enqueued) {
          const data = await reader.read();
          if (data.done) {
            if (transformer.flush) {
              await transformer.flush(controller);
            }
            return controller.close();
          }
          await transformer.transform(data.value, wrappedController);
        }
      },
      cancel(reason: any) {
        readable.cancel(reason);
        if (oncancel !== null) {
          oncancel(reason);
        }
      }
    });
  }
}
