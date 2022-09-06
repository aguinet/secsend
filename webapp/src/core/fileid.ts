import {deriveKey, b64_urlsafe_encode, b64_urlsafe_decode} from './utils';

export enum IDKind {
  File_ = 0,
  Root = 1,
}

const ID_LEN = 10;

export class InvalidID extends Error
{
  constructor(id: string) {
    super("invalid ID '" + id + "'");
  }
}

export abstract class BaseID {
  id: ArrayBuffer;

  abstract kind(): IDKind;

  constructor(id: ArrayBuffer) {
    this.id = id;
  }

  static fromStr(idstr: string, kind: IDKind | null): BaseID {
    const id = new Uint8Array(b64_urlsafe_decode(idstr));
    const kb = id[0];
    const idb = id.slice(1);
    if (kind !== null && kind !== kb) {
      throw new InvalidID(idstr);
    }
    switch (kb) {
    case IDKind.Root:
      return new RootID(idb.buffer);
    case IDKind.File_:
      return new FileID(idb.buffer);
    default:
      throw new InvalidID(idstr);
    }
  }

  str(): string {
    const data = new Uint8Array([this.kind(), ...new Uint8Array(this.id)]);
    return b64_urlsafe_encode(data);
  }
}

export class FileID extends BaseID {
  kind() { return IDKind.File_; }
}

export class RootID extends BaseID {
  kind() { return IDKind.Root; }

  async fileID(crypto: Crypto): Promise<FileID> {
    const id = await deriveKey(crypto, this.id, "secsend_fiid");
    return new FileID(id.slice(0, ID_LEN));
  }
}
