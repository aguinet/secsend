import {StreamTruncateTransform} from './transformers';

export class StreamRange {
  readonly inStreamSeekBytes: number;
  readonly outStreamBeginSkip: number;
  readonly inChunkBegin: number;

  readonly inStreamLength: number | null;
  readonly outStreamLastSize: number | null;

  readonly outStreamBegin: number | null;
  readonly outStreamLength: number | null;

  constructor(inChunkBegin: number, inStreamSeekBytes: number, outStreamBeginSkip: number, inStreamLength: number | null, outStreamLastSize: number | null, outStreamBegin: number | null, outStreamLength: number | null) {
    this.inStreamSeekBytes = inStreamSeekBytes;
    this.inChunkBegin = inChunkBegin;
    this.inStreamLength = inStreamLength;
    this.outStreamBeginSkip = outStreamBeginSkip;
    this.outStreamLastSize = outStreamLastSize;
    this.outStreamBegin = outStreamBegin;
    this.outStreamLength = outStreamLength;
  }

  inStreamRangeEnd(): number | null {
    if (this.inStreamLength === null) {
      return null;
    }
    return this.inStreamLength+this.inStreamSeekBytes-1;
  }

  static compute(inChunkSize: number, outChunkSize: number, outSeek: number | null, outLength: number | null): StreamRange {
    let inStreamSeekBytes = 0;
    let outStreamBeginSkip = 0;
    let inChunkBegin = 0;
    if (outSeek !== null) {
      const chunkIdxStart = Math.floor(outSeek/outChunkSize);
      inStreamSeekBytes = chunkIdxStart * inChunkSize;
      outStreamBeginSkip = outSeek % outChunkSize;
      inChunkBegin = chunkIdxStart;
    }

    let inStreamLength = null;
    let outStreamLastSize = null;
    if (outLength !== null) {
      const nchunks = Math.ceil(outLength/outChunkSize);
      inStreamLength = nchunks*inChunkSize;
      outStreamLastSize = outLength%outChunkSize;
    }

    return new StreamRange(inChunkBegin, inStreamSeekBytes, outStreamBeginSkip, inStreamLength, outStreamLastSize, outSeek, outLength);
  }

  outTruncator() {
    return new StreamTruncateTransform(this.outStreamBeginSkip, this.outStreamLastSize);
  }
}
