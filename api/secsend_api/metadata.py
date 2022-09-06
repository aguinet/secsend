import base64
import datetime
from dataclasses import dataclass, asdict

ALGOS = ['aes-gcm']

@dataclass
class EncryptedFileMetadata:
    name: bytes
    mime_type: bytes
    iv: bytes
    chunk_size: bytes
    key_sign: bytes
    complete: bool = False
    algo: str = ALGOS[0]
    version: int = 1
    timeout_s: int = 0
    timeout_ts: int = 0

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
        return cls(**d)
