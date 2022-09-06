import io
import json
import dataclasses
import tempfile
import os
import aiofiles
from pathlib import Path
from collections import namedtuple

from .backend import FileID, BackendErrorIDExists, BackendErrorIDUnknown, BackendErrorInvalidMetadata, BackendErrorFileLocked
from .metadata import EncryptedFileMetadata
from .timeout import timeout_ts, ts_has_expired

def id_to_dir(id_: FileID):
    hid = id_.bytes
    parts = (bytes(p).hex() for p in zip(*[iter(hid[:-2])]*2))
    return Path(*parts)

class LockCtx:
    def __init__(self, path: Path, id_: FileID):
        self._path = path
        self._f = None
        self._id = id_

    async def __aenter__(self):
        try:
            self._f = await aiofiles.open(str(self._path), "x")
            return self
        except FileExistsError:
            raise BackendErrorFileLocked()
        except FileNotFoundError:
            # This can happen because one parent directory doesn't exist, as the file doesn't exist
            raise BackendErrorIDUnknown(self._id)

    async def __aexit__(self, exc_type, exc, tb):
        if not self._f is None:
            await self._f.close()
            self._path.unlink()


class BackendFile:
    def __init__(self, load_metadata, content_path: Path, metadata_path: Path, id_: FileID):
        self._metadata_path = metadata_path
        self._metadata = None
        self._load_metadata = load_metadata
        self._content_path = content_path
        self._id = id_

    @property
    def metadata(self):
        if self._metadata is None:
            self._metadata = self._load_metadata()
        return self._metadata

    @property
    def content_path(self):
        return self._content_path

    @property
    def size(self):
        try:
            return os.path.getsize(self._content_path)
        except FileNotFoundError:
            return 0

    def check_validity(self):
        metadata = self.metadata
        if metadata.timeout_s == 0:
            return
        if not metadata.complete:
            return
        if ts_has_expired(metadata.timeout_ts):
            self.delete()
            raise BackendErrorIDUnknown(self._id)

    def lock_write(self):
        return LockCtx(self._metadata_path.with_suffix(".lock"), self._id)

    def set_as_complete(self):
        if self.metadata.complete:
            return
        self.metadata.complete = True
        self.metadata.timeout_ts = timeout_ts(self.metadata.timeout_s)

        tmp, tpath = tempfile.mkstemp(prefix=str(self._metadata_path))
        with os.fdopen(tmp,"w") as ftmp:
            json.dump(self.metadata.jsonable(), ftmp)
        os.rename(tpath, str(self._metadata_path))

    @property
    def nchunks(self):
        return self.size//self.metadata.chunk_size

    def stream_read(self):
        return aiofiles.open(self._content_path, "rb")

    def stream_append(self):
        return aiofiles.open(self._content_path, "ab")

    def delete(self):
        try:
            self._metadata_path.unlink()
            self._content_path.unlink()
        except FileNotFoundError:
            raise BackendErrorIDUnknown(self._id)


FilePaths = namedtuple('FilePaths', ['metadata', 'content'])

class BackendFiles:
    def __init__(self, root: Path):
        self.root = root

    def create(self, id_: FileID, metadata: EncryptedFileMetadata) -> BackendFile:
        paths = self._id_to_paths(id_, create_dir=True)
        fd_metadata = None
        try:
            fd_metadata = open(paths.metadata, "x")
        except FileExistsError:
            raise BackendErrorIDExists(id_)

        ret = BackendFile(lambda: metadata, paths.content, paths.metadata, id_)
        json.dump(metadata.jsonable(), fd_metadata)
        fd_metadata.close()

        return ret

    def open(self, id_: FileID) -> BackendFile:
        paths = self._id_to_paths(id_, create_dir=False)
        return BackendFile(lambda: self.load_metadata(id_, paths.metadata), paths.content, paths.metadata, id_)

    def load_metadata(self, id_: FileID, path: str) -> EncryptedFileMetadata:
        try:
            with open(path, "r") as f:
                return EncryptedFileMetadata.from_jsonable(json.load(f))
        except FileNotFoundError:
            raise BackendErrorIDUnknown(id_)
        except json.JSONDecodeError:
            raise BackendErrorInvalidMetadata(id_)

    def _id_to_paths(self, id_: FileID, create_dir: bool) -> FilePaths:
        fdir = self.root / id_to_dir(id_)
        if create_dir:
            fdir.mkdir(parents=True,exist_ok=True)
        return FilePaths(
                metadata=fdir / ("%s.metadata" % id_.bytes.hex()),
                content=fdir /  ("%s.content" % id_.bytes.hex()))
