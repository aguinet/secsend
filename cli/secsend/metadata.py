import base64
import struct
from dataclasses import dataclass, asdict
from enum import Enum

ALGOS = ['aes-gcm']

@dataclass
class EncryptedFileMetadata:
    name: bytes
    mime_type: bytes
    iv: bytes
    chunk_size: bytes
    key_sign: bytes
    timeout_s: int = 0
    complete: bool = False
    algo: str = ALGOS[0]
    version: int = 1

    def jsonable(self):
        ret = asdict(self)
        for f in ("name","mime_type","iv","chunk_size","key_sign"):
            v = base64.b64encode(ret[f]).decode("ascii")
            ret[f] = v
        return ret

    @classmethod
    def from_jsonable(cls, d):
        for f in ("name","mime_type","iv","chunk_size","key_sign"):
            d[f] = base64.b64decode(d[f])
        d = {k: d[k] for k in ("name","mime_type","iv","chunk_size","key_sign","algo","version")}
        return cls(**d)

@dataclass
class FileMetadata:
    name: str
    mime_type: str
    iv: bytes
    chunk_size: int
    key_sign: bytes
    timeout_s: int
    complete: bool = False
    algo: str = ALGOS[0]
    version: int = 1

def encryptMetadata(metadata: FileMetadata, crypto) -> EncryptedFileMetadata:
    ret = asdict(metadata)
    ret['name'] = ret['name'].encode("utf8")
    ret['mime_type'] = ret['mime_type'].encode("ascii")
    ret['chunk_size'] = struct.pack("<I", ret['chunk_size'])
    for idx,f in enumerate(('name','mime_type','chunk_size')):
        ret[f] = crypto.encr_sign_metadata(idx, ret[f], b"")
    return EncryptedFileMetadata(**ret)

def decryptMetadata(encr: EncryptedFileMetadata, crypto) -> FileMetadata:
    ret = asdict(encr)
    for idx,f in enumerate(('name','mime_type','chunk_size')):
        ret[f] = crypto.decr_verify_metadata(idx, ret[f], b"")
    ret['chunk_size'] = struct.unpack("<I", ret['chunk_size'])[0]
    ret['name'] = ret['name'].decode("utf8")
    ret['mime_type'] = ret['mime_type'].decode("ascii")
    return FileMetadata(**ret)
