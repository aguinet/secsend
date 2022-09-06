import secrets
import base64
import binascii
import hashlib
import struct

class BaseID:
    KIND = None
    ID_LEN = 10

    def __init__(self, id_: bytes):
        self.id_ = id_

    @classmethod
    def from_str(cls, s):
        try:
            id_ = base64.urlsafe_b64decode(s + "="*((4-len(s)%4)%4))
        except binascii.Error:
            raise BackendErrorIDInvalid(s)

        idkind = id_[0]
        if cls.KIND is None:
            cls = RootID if idkind == RootID.KIND else FileID
        elif idkind != cls.KIND:
            raise BackendErrorIDWrongType(idkind)

        id_ = id_[1:]
        if len(id_) != cls.ID_LEN:
            raise BackendErrorIDInvalid(s)
        return cls(id_)

    @property
    def bytes(self):
        return self.id_

    def __str__(self):
        v = struct.pack("<B", self.KIND) + self.id_
        return base64.urlsafe_b64encode(v).rstrip(b"=").decode("ascii")

class FileID(BaseID):
    KIND = 0

class RootID(BaseID):
    KIND = 1

    @classmethod
    def generate(cls):
        return cls(secrets.token_bytes(cls.ID_LEN))

    def file_id(self):
        return FileID(hashlib.sha256(b"secsend_fiid" + self.id_).digest()[:self.ID_LEN])


class BackendError(Exception):
    pass

class BackendErrorInvalidMetadata(BackendError):
    def __init__(self, id_: FileID):
        super().__init__("invalid metadata for ID '%s'" % str(id_))

class BackendErrorIDUnknown(BackendError):
    def __init__(self, id_: BaseID):
        super().__init__("unknown ID '%s'" % str(id_))

class BackendErrorIDInvalid(BackendError):
    def __init__(self, id_: BaseID):
        super().__init__("invalid ID '%s'" % str(id_))

class BackendErrorIDWrongType(BackendError):
    def __init__(self, id_: BaseID):
        super().__init__("wrong type for ID '%s'" % str(id_))

class BackendErrorIDExists(BackendError):
    def __init__(self, id_: FileID):
        super().__init__("ID '%s' already exists" % str(id_))

class BackendErrorFileLocked(BackendError):
    def __init__(self):
        super().__init__("file locked")

class BackendErrorIDUnavailable(BackendError):
    def __init__(self):
        super().__init__("unable to get an available ID")
