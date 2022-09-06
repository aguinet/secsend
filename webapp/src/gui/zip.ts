import {crc32} from './crc32';

class BytesOut {
  readonly buf: Uint8Array;
  readonly view: DataView;
  idx: number;
  le: boolean;

  constructor(buf: Uint8Array, LE: boolean) {
    this.buf = buf;
    this.view = new DataView(this.buf.buffer);
    this.idx = 0;
    this.le = LE;
  }

  pushU64(n: number) {
    this.view.setBigUint64(this.idx, BigInt(n), this.le);
    this.idx += 8;
  }

  pushU32(n: number) {
    this.view.setUint32(this.idx, n, this.le);
    this.idx += 4;
  }

  pushU16(n: number) {
    this.view.setUint16(this.idx, n, this.le);
    this.idx += 2;
  }

  pushBuffer(buf: Uint8Array) {
    this.buf.set(buf, this.idx);
    this.idx += buf.length;
  }
}

abstract class Serializable {
  abstract serializeLength(): number;
  abstract serialize(out: BytesOut): void;

  serializeToBuf(): Uint8Array {
    const buf = new Uint8Array(this.serializeLength());
    const out = new BytesOut(buf, true /* little endian */);
    this.serialize(out);
    return buf;
  }
}

//         Value      Size       Description
//         -----      ----       -----------
// (ZIP64) 0x0001     2 bytes    Tag for this "extra" block type
//         Size       2 bytes    Size of this "extra" block
//         Original
//         Size       8 bytes    Original uncompressed file size
//         Compressed
//         Size       8 bytes    Size of compressed data
//         Relative Header
//         Offset     8 bytes    Offset of local header record
//         Disk Start
//         Number     4 bytes    Number of the disk on which
//                               this file starts
class Zip64ExtendedInfo extends Serializable
{
  originalSize: number;
  compressedSize: number;
  relativeHeaderOffset: number;
  diskStartNumber: number;

  serialize(out: BytesOut) {
    out.pushU16(0x0001); // tag
    out.pushU16(8*3+4);  // extra block size
    out.pushU64(this.originalSize);
    out.pushU64(this.compressedSize);
    out.pushU64(this.relativeHeaderOffset);
    out.pushU32(this.diskStartNumber);
  }

  serializeLength() {
    return 2*2+8*3+4;
  }
}

// local file header signature     4 bytes  (0x04034b50)
// version needed to extract       2 bytes
// general purpose bit flag        2 bytes
// compression method              2 bytes
// last mod file time              2 bytes
// last mod file date              2 bytes
// crc-32                          4 bytes
// compressed size                 4 bytes
// uncompressed size               4 bytes
// file name length                2 bytes
// extra field length              2 bytes
// 
// file name (variable size)
// extra field (variable size)
class ZipLocalFileHeader extends Serializable {
  neededVersion: number;
  flags: number;
  compressionMethod: number;
  lastModTime: number;
  lastModDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;

  filename: Uint8Array;
  extraFields: Array<Serializable> = [];

  serialize(out: BytesOut) {
    out.pushU32(0x04034b50); // signature
    out.pushU16(this.neededVersion);
    out.pushU16(this.flags);
    out.pushU16(this.compressionMethod);
    out.pushU16(this.lastModTime);
    out.pushU16(this.lastModDate);

    out.pushU32(this.crc32);
    out.pushU32(this.compressedSize);
    out.pushU32(this.uncompressedSize);

    out.pushU16(this.filename.length); // file name length
    out.pushU16(this.extraLength()); // extra field length
    out.pushBuffer(this.filename);
    for (const e of this.extraFields) {
      e.serialize(out);
    }
  }

  serializeLength() {
    return 4+2*5+4*3+2*2+this.filename.length+this.extraLength();
  }

  private extraLength() {
    let ret = 0;
    for (const e of this.extraFields) {
      ret += e.serializeLength();
    }
    return ret;
  }
}

class Zip64DataDescriptor extends Serializable {
  crc32: number;                  // 4 bytes
  compressedSize: number;         // 8 bytes
  uncompressedSize: number;       // 8 bytes

  serialize(out: BytesOut) {
    out.pushU32(0x08074b50);
    out.pushU32(this.crc32);
    out.pushU64(this.compressedSize);
    out.pushU64(this.uncompressedSize);
  }

  serializeLength() {
    return 4+4+8*2;
  }
}

// central file header signature   4 bytes  (0x02014b50)
// version made by                 2 bytes
// version needed to extract       2 bytes
// general purpose bit flag        2 bytes
// compression method              2 bytes
// last mod file time              2 bytes
// last mod file date              2 bytes
// crc-32                          4 bytes
// compressed size                 4 bytes
// uncompressed size               4 bytes
// file name length                2 bytes
// extra field length              2 bytes
// file comment length             2 bytes
// disk number start               2 bytes
// internal file attributes        2 bytes
// external file attributes        4 bytes
// relative offset of local header 4 bytes
//
// file name (variable size)
// extra field (variable size)
// file comment (variable size)

class ZipCentralFileHeader extends Serializable {
  versionMadeBy: number;
  versionNeededToExtract: number;
  flags:number;
  compression: number;
  lastModTime: number;
  lastModDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  diskNumberStart: number;
  internalFileAttributes: number;
  externalFileAttributes: number;
  offsetLocalHeader: number;

  filename: Uint8Array;
  comment: Uint8Array = new Uint8Array();
  extraFields: Array<Serializable> = [];

  serialize(out: BytesOut) {
    out.pushU32(0x02014b50);
    out.pushU16(this.versionMadeBy);
    out.pushU16(this.versionNeededToExtract);
    out.pushU16(this.flags);
    out.pushU16(this.compression);
    out.pushU16(this.lastModTime);
    out.pushU16(this.lastModDate);
    out.pushU32(this.crc32);
    out.pushU32(this.compressedSize);
    out.pushU32(this.uncompressedSize);
    out.pushU16(this.filename.length);
    out.pushU16(this.extraLength());
    out.pushU16(this.comment.length);
    out.pushU16(this.diskNumberStart);
    out.pushU16(this.internalFileAttributes);
    out.pushU32(this.externalFileAttributes);
    out.pushU32(this.offsetLocalHeader);
    out.pushBuffer(this.filename);
    for (const e of this.extraFields) {
      e.serialize(out);
    }
    out.pushBuffer(this.comment);
  }

  serializeLength() {
    return 4+2*6+3*4+5*2+2*4+this.filename.length+this.extraLength()+this.comment.length;
  }

  private extraLength() {
    let ret = 0;
    for (const e of this.extraFields) {
      ret += e.serializeLength();
    }
    return ret;
  }
}

// end of central dir signature    4 bytes  (0x06054b50)
// number of this disk             2 bytes
// number of the disk with the
// start of the central directory  2 bytes
// total number of entries in the
// central directory on this disk  2 bytes
// total number of entries in
// the central directory           2 bytes
// size of the central directory   4 bytes
// offset of start of central
// directory with respect to
// the starting disk number        4 bytes
// .ZIP file comment length        2 bytes
// .ZIP file comment       (variable size)

class ZipEndOfCentralDir extends Serializable {
  diskNumber: number;
  diskNumberStartCD: number;
  entriesCountCDDisk: number;
  entriesCountCD: number;
  sizeCD: number;
  offsetStartCDDisk: number;

  comment: Uint8Array = new Uint8Array();

  serialize(out: BytesOut) {
    out.pushU32(0x06054b50);
    out.pushU16(this.diskNumber);
    out.pushU16(this.diskNumberStartCD);
    out.pushU16(this.entriesCountCDDisk);
    out.pushU16(this.entriesCountCD);
    out.pushU32(this.sizeCD);
    out.pushU32(this.offsetStartCDDisk);
    out.pushU16(this.comment.length);
    out.pushBuffer(this.comment);
  }

  serializeLength() {
    return 4+4*2+2*4+2+this.comment.length;
  }
}

// zip64 end of central dir
// signature                       4 bytes  (0x06064b50)
// size of zip64 end of central
// directory record                8 bytes
// version made by                 2 bytes
// version needed to extract       2 bytes
// number of this disk             4 bytes
// number of the disk with the
// start of the central directory  4 bytes
// total number of entries in the
// central directory on this disk  8 bytes
// total number of entries in the
// central directory               8 bytes
// size of the central directory   8 bytes
// offset of start of central
// directory with respect to
// the starting disk number        8 bytes
// zip64 extensible data sector    (variable size)

class Zip64EndOfCentralDirRecord extends Serializable {
  versionMadeBy: number;
  versionNeededToExtract: number;
  diskNumber: number;
  diskNumberStartCD: number;
  centralDirDisk: number;
  numberEntriesCentralDirDisk: number;
  numberEntriesCentralDir: number;
  sizeCentralDirectory: number;
  offsetStartCentralDirectoryDisk: number;

  extensions: Array<Serializable> = [];

  serialize(out: BytesOut) {
    out.pushU32(0x06064b50);
    out.pushU64(this.serializeLength() - 12);
    out.pushU16(this.versionMadeBy);
    out.pushU16(this.versionNeededToExtract);
    out.pushU32(this.diskNumber);
    out.pushU32(this.diskNumberStartCD);
    out.pushU64(this.numberEntriesCentralDirDisk);
    out.pushU64(this.numberEntriesCentralDir);
    out.pushU64(this.sizeCentralDirectory);
    out.pushU64(this.offsetStartCentralDirectoryDisk);
    for (const ext of this.extensions) {
      ext.serialize(out);
    }
  }

  serializeLength() {
    return 4+8+2*2+4*2+8*4+this.extLength();
  }

  private extLength() {
    let ret = 0;
    for (const e of this.extensions) {
      ret += e.serializeLength();
    }
    return ret;
  }
}

// zip64 end of central dir locator
// signature                       4 bytes  (0x07064b50)
// number of the disk with the
// start of the zip64 end of
// central directory               4 bytes
// relative offset of the zip64
// end of central directory record 8 bytes
// total number of disks           4 bytes

class Zip64EndOfCentralDirLocator extends Serializable {
  diskNumber: number;
  offsetEndOfCentralDirRecord: number;
  numberDisks: number;

  serialize(out: BytesOut) {
    out.pushU32(0x07064b50);
    out.pushU32(this.diskNumber);
    out.pushU64(this.offsetEndOfCentralDirRecord);
    out.pushU32(this.numberDisks);
  }

  serializeLength() {
    return 4+4+8+4;
  }
}

const ZipMadeByVersion = 45 | (3 << 255); // 4.5 (minimum for Zip64) + UNIX
const ZipNeededVersion = 45 | (3 << 255); // 4.5 (minimum for Zip64) + UNIX
const ZipFlagsDataDescriptor = 1<<3;
const ZipUTF8Encoding = 1<<11;
const ZipAllFlags = ZipFlagsDataDescriptor|ZipUTF8Encoding;
const ZipCompressionMethodStored = 0;

export interface NamedBlob {
  name: string;
  blob: Blob;
  lastMod: Date;
}

interface DosDate {
  time: number;
  date: number;
}

function toDosDate(odate: Date): DosDate {
  const day = odate.getUTCDate();
  const month = odate.getUTCMonth() + 1;
  const year = odate.getUTCFullYear() - 1980;
  const dosdate = day | (month << 5) | (year << 9);

  const sec = Math.floor(odate.getUTCSeconds()/2);
  const min = odate.getUTCMinutes();
  const hours = odate.getUTCHours();
  const dostime = sec | (min << 5) | (hours << 11);

  return {time: dostime, date: dosdate};
}

export class ZipArchive {
  files: Array<NamedBlob>;

  constructor() {
    this.files = [];
  }

  add(file: NamedBlob) {
    this.files.push(file);
  }

  stream() {
    return new ReadableStream(new Zip64Stream(this));
  }

  get size() {
    const zddLength = new Zip64DataDescriptor().serializeLength();

    let ret = 0;
    for (const f of this.files) {
      const dosDate = toDosDate(f.lastMod);
      ret += ZipArchive.localFileHeader(f.name, dosDate).serializeLength();
      ret += ZipArchive.centralFileHeader(f.name, dosDate, 0,0,0).serializeLength();
      ret += zddLength;
      ret += f.blob.size;
    }

    // End of archive overhead
    ret += ZipArchive.endOfCentralDirRecord64(0, 0, 0).serializeLength();
    ret += new Zip64EndOfCentralDirLocator().serializeLength();
    ret += new ZipEndOfCentralDir().serializeLength();

    return ret;
  }

  static localFileHeader(filename: string, lastMod: DosDate): ZipLocalFileHeader {
    const lfh = new ZipLocalFileHeader();
    lfh.neededVersion = ZipNeededVersion;
    lfh.flags = ZipAllFlags;
    lfh.compressionMethod = ZipCompressionMethodStored;
    lfh.lastModTime = lastMod.time;
    lfh.lastModDate = lastMod.date;
    lfh.crc32 = 0;
    lfh.compressedSize = 0;
    lfh.uncompressedSize = 0;
    lfh.filename = new TextEncoder().encode(filename);

    const ei = new Zip64ExtendedInfo();
    lfh.extraFields.push(ei);
    ei.originalSize = 0;
    ei.compressedSize = 0;
    ei.relativeHeaderOffset = 0;
    ei.diskStartNumber = 0;

    return lfh;
  }

  static dataDescriptor64(crc: number, size: number): Zip64DataDescriptor {
    const zdd = new Zip64DataDescriptor();
    zdd.crc32 = crc;
    zdd.compressedSize = size;
    zdd.uncompressedSize = size;
    return zdd;
  }

  static centralFileHeader(filename: string, lastMod: DosDate, crc: number, size: number, fileHeaderStartIdx: number): ZipCentralFileHeader {
    const cfh = new ZipCentralFileHeader();
    cfh.versionMadeBy = ZipMadeByVersion;
    cfh.versionNeededToExtract = ZipNeededVersion;
    cfh.flags = ZipAllFlags;
    cfh.compression = ZipCompressionMethodStored;
    cfh.lastModTime = lastMod.time;
    cfh.lastModDate = lastMod.date;
    cfh.crc32 = crc;
    cfh.compressedSize = 0xFFFFFFFF;
    cfh.uncompressedSize = 0xFFFFFFFF;
    cfh.diskNumberStart = 0;
    cfh.offsetLocalHeader = 0xFFFFFFFF;
    cfh.filename = new TextEncoder().encode(filename);

    const ei = new Zip64ExtendedInfo();
    cfh.extraFields.push(ei);
    ei.originalSize = size;
    ei.compressedSize = size;
    ei.relativeHeaderOffset = fileHeaderStartIdx;
    ei.diskStartNumber = 0;

    return cfh;
  }

  static endOfCentralDirRecord64(numberEntries: number, sizeCD: number, idxCDStart: number): Zip64EndOfCentralDirRecord {
    const eocd = new Zip64EndOfCentralDirRecord();
    eocd.versionMadeBy = ZipMadeByVersion;
    eocd.versionNeededToExtract = ZipNeededVersion;
    eocd.diskNumber = 0;
    eocd.diskNumberStartCD = 0;
    eocd.centralDirDisk = 0;
    eocd.numberEntriesCentralDirDisk = numberEntries;
    eocd.numberEntriesCentralDir = numberEntries;
    eocd.sizeCentralDirectory = sizeCD;
    eocd.offsetStartCentralDirectoryDisk = idxCDStart;

    return eocd;
  }
}

export class Zip64Stream {
  readonly files: Array<NamedBlob>;
  curBufIdx: number;
  curFileIdx: number;
  curFile: NamedBlob | null;
  curReader: ReadableStreamDefaultReader | null;
  curCRC: number;
  curSize: number;
  curFileHeaderStart: number;

  cfhs: Array<ZipCentralFileHeader>;

  constructor(archive: ZipArchive) {
    // Sort files in the archive by filename. This makes sure that, for the
    // same set of files, we always generate the same order in the zip archive
    // (thus supporting resuming uploads).
    this.files = archive.files.slice(0).sort(
      (a: NamedBlob, b: NamedBlob) => { return a.name.localeCompare(b.name); });
    this.curBufIdx = 0;
    this.curFileIdx = 0;
    this.curReader = null;
    this.curFile = null;
    this.curCRC = 0;
    this.curSize = 0;
    this.curFileHeaderStart = 0;
    this.cfhs = [];
  }

  private nextFile() {
    const file = this.files[this.curFileIdx++] || null;
    if (file === null) {
      this.curFile = null;
      this.curReader = null;
      return;
    }
    this.curFile = file;
    // @ts-ignore
    this.curReader = file.blob.stream().getReader();
    this.curCRC = 0;
    this.curSize = 0;
  }

  start(controller: ReadableStreamDefaultController) {
    this.nextFile();
    if (this.curFile === null) {
      this.emitZipEnd(controller);
      return controller.close();
    }
    this.emitFileHeader(controller);
  }

  async pull(controller: ReadableStreamDefaultController) {
    const data = await this.curReader.read();
    if (data.done === false) {
      this.curCRC = await crc32(data.value, this.curCRC);
      this.curSize += data.value.length;
      this.enqueue(data.value, controller);
      return;
    }

    // Move to next file
    this.emitFileEnd(controller);
    this.nextFile();
    if (this.curReader === null) {
      this.emitZipEnd(controller);
      return controller.close();
    }
    this.emitFileHeader(controller);
    return;
  }

  private emitFileHeader(controller: ReadableStreamDefaultController) {
    this.curFileHeaderStart = this.curBufIdx;
    const lfh = ZipArchive.localFileHeader(this.curFile.name, toDosDate(this.curFile.lastMod));
    this.enqueue(lfh.serializeToBuf(), controller);
  }

  private emitFileEnd(controller: ReadableStreamDefaultController) {
    const zdd = ZipArchive.dataDescriptor64(this.curCRC, this.curSize);
    this.enqueue(zdd.serializeToBuf(), controller);
    const cfh = ZipArchive.centralFileHeader(this.curFile.name, toDosDate(this.curFile.lastMod), this.curCRC, this.curSize, this.curFileHeaderStart);
    this.cfhs.push(cfh);
  }

  private emitZipEnd(controller: ReadableStreamDefaultController) {
    // emit all central directory structures
    const idxCDStart = this.curBufIdx;
    for (const cfh of this.cfhs) {
      this.enqueue(cfh.serializeToBuf(), controller);
    }
    const sizeCD = this.curBufIdx - idxCDStart;

    const idxECDR = this.curBufIdx;
    const eocd64 = ZipArchive.endOfCentralDirRecord64(this.files.length, sizeCD, idxCDStart);
    this.enqueue(eocd64.serializeToBuf(), controller);

    const eocdl64 = new Zip64EndOfCentralDirLocator();
    eocdl64.diskNumber = 0;
    eocdl64.offsetEndOfCentralDirRecord = idxECDR;
    eocdl64.numberDisks = 1;
    this.enqueue(eocdl64.serializeToBuf(), controller);

    const eocd = new ZipEndOfCentralDir();
    eocd.diskNumber = 0;
    eocd.diskNumberStartCD = 0;
    eocd.entriesCountCDDisk = 0xFFFF;
    eocd.entriesCountCD = 0xFFFF;
    eocd.sizeCD = 0xFFFFFFFF;
    eocd.offsetStartCDDisk = 0xFFFFFFFF;

    this.enqueue(eocd.serializeToBuf(), controller);
  }

  private enqueue(buf: Uint8Array, controller: ReadableStreamDefaultController) {
    this.curBufIdx += buf.length;
    controller.enqueue(buf);
  }
}
