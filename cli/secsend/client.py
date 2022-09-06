import binascii
import base64
import struct
import hashlib
import secrets
from dataclasses import dataclass
from typing import List
from urllib.parse import urlparse, parse_qsl

from .metadata import EncryptedFileMetadata
from .utils import to_base_36

class IDWrongType(Exception):
    def __init__(self, kind):
        super().__init__("Wrong ID type")

class BaseID:
    KIND = None
    ID_LEN = 10

    def __init__(self, id_: bytes):
        self.id_ = id_

    @classmethod
    def from_str(cls, s):
        try:
            id_ = base64.urlsafe_b64decode(s + "="*((4-len(s)%4)))
        except binascii.Error:
            raise IDInvalid(s)

        idkind = id_[0]
        if cls.KIND == None:
            cls = RootID if idkind == RootID.KIND else FileID
        elif idkind != cls.KIND:
            raise IDWrongType(idkind)

        id_ = id_[1:]
        if len(id_) != cls.ID_LEN:
            raise IDInvalid(s)
        return cls(id_)

    @property
    def bytes(self):
        return self.id_

    def __str__(self):
        v = struct.pack("<B", self.KIND) + self.id_
        return base64.urlsafe_b64encode(v).rstrip(b"=").decode("ascii")

class FileID(BaseID):
    KIND = 0
    pass

class RootID(BaseID):
    KIND = 1
    @classmethod
    def generate(cls):
        return cls(secrets.token_bytes(cls.ID_LEN))

    def file_id(self):
        return FileID(hashlib.sha256(b"secsend_fiid" + self.id_).digest()[:self.ID_LEN])

@dataclass
class ServerConfig:
    timeout_s_valid: List[int]

    @classmethod
    def from_jsonable(cls, data):
        timeout_s_valid = sorted(data['timeout_s_valid'])
        if len(timeout_s_valid) > 1 and timeout_s_valid[0] == 0:
            timeout_s_valid.append(0)
            timeout_s_valid.pop(0)
        return ServerConfig(timeout_s_valid=timeout_s_valid)

class ClientAPI:
    def __init__(self, session, server: str):
        self.server = server.rstrip(" /")
        self.server = server
        self.session = session

    def _get_url(self, uri: str) -> str:
        return "%s/v1/%s" % (self.server,uri)

    def config(self) -> ServerConfig:
        r = self.session.get(self._get_url("config"))
        r.raise_for_status()
        return ServerConfig.from_jsonable(r.json())

    def metadata(self, id_: FileID) -> EncryptedFileMetadata:
        r = self.session.get(self._get_url("metadata/%s" % str(id_)))
        r.raise_for_status()
        d = r.json()
        metadata = EncryptedFileMetadata.from_jsonable(d['metadata'])
        size = d['size']
        return metadata, size

    def delete(self, id_: RootID):
        r = self.session.post(self._get_url("delete/%s" % str(id_)))
        r.raise_for_status()

    def download(self, id_: FileID, seek = 0):
        headers = {}
        if seek > 0:
            headers["Range"] = "bytes=%d-" % seek
        r = self.session.get(self._get_url("download/%s" % str(id_)), headers=headers, stream=True)
        r.raise_for_status()
        return r

    def upload_new(self, metadata: EncryptedFileMetadata):
        r = self.session.post(self._get_url("upload/new"), json=metadata.jsonable())
        r.raise_for_status()
        rid = r.json()['root_id']
        return RootID.from_str(rid)

    def upload_push(self, id_: RootID, data):
        r = self.session.post(self._get_url("upload/push/%s" % str(id_)), data=data)
        r.raise_for_status()

    def upload_finish(self, id_: RootID):
        r = self.session.post(self._get_url("upload/finish/%s" % str(id_)))
        r.raise_for_status()

    def delete(self, id_: RootID):
        r = self.session.post(self._get_url("delete/%s" % str(id_)))
        r.raise_for_status()

class DownloadURL:
    def __init__(self, server: str, id_: BaseID, key: bytes):
        self.server = server
        self.id = id_
        self.key = key

    def has_key(self):
        return self.key is not None

    @staticmethod
    def key_from_txt(s: str) -> bytes:
        v = int(s, 36)
        return v.to_bytes(16, "little")

    @staticmethod
    def key_to_txt(key: bytes) -> str:
        # Encode key as a little edian number
        v = int.from_bytes(key, "little")
        return to_base_36(v)

    @classmethod
    def from_url(cls, url: str):
        url = urlparse(url)
        key = cls.key_from_txt(url.fragment)
        if len(key) == 0:
            key = None
        path = url.path
        # Support both URL format
        if path.startswith("/v1/download/"):
            id_ = path[len("/v1/download/"):]
        elif path == "/dl":
            qsl = dict(parse_qsl(url.query))
            id_ = qsl.get("id", None)
            if id_ is None:
                raise ValueError("invalid URL format")
        else:
            raise ValueError("invalid URL format")
        return cls("%s://%s" % (url.scheme, url.netloc), BaseID.from_str(id_), key)

    def file_url(self):
        if isinstance(self.id, RootID):
            return DownloadURL(self.server, self.id.file_id(), self.key)
        return self

    def __str__(self):
        return "%s/dl?id=%s#%s" % (self.server, self.id, self.key_to_txt(self.key))
