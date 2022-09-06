import io
import requests
import os
import magic
import pathlib
import secrets
import sys
from typing import Optional

from .metadata import FileMetadata, ALGOS, encryptMetadata, decryptMetadata
from .crypto import AESGCMChunks, SignKey, VerifyKey
from .client import ClientAPI, DownloadURL

class InvalidKey(Exception):
    def __init__(self):
        super().__init__("invalid decryption key")

class StreamTransform:
    def __init__(self, data_process, in_chunk_size: int, out_seek: int = 0):
        self.data_process = data_process
        self.in_chunk_size = in_chunk_size
        self.out_seek = out_seek

        out_chunk_size = data_process.out_chunk_size(in_chunk_size)
        chunk_idx = out_seek//out_chunk_size
        data_process.seek_chunk_idx(chunk_idx)
        chunk_seek = chunk_idx*in_chunk_size
        bytes_skip = (out_seek%out_chunk_size)

        self.chunk_seek = chunk_seek
        self.bytes_skip = bytes_skip
        self.out_chunk_size = out_chunk_size

    def __call__(self, source_stream: io.IOBase, cb_done=lambda l: l):
        # Special processing for the first chunk if we do not start from the
        # beggining (resuming download/upload).
        if self.out_seek > 0:
            cb_done(self.chunk_seek)
            data = source_stream.read(self.in_chunk_size)
            cb_done(len(data))
            data = self.data_process.process(data)
            data = data[self.bytes_skip:]
            yield data

        while True:
            data = source_stream.read(self.in_chunk_size)
            if data is None or len(data) == 0:
                return
            cb_done(len(data))
            data = self.data_process.process(data)
            yield data

def stream_transform(source_stream: io.IOBase, data_process, in_chunk_size: int, out_seek: int = 0):
    ctx = StreamTransform(data_process, in_chunk_size, out_seek)
    if out_seek > 0:
        source_stream.seek(ctx.chunk_seek, 0)
    yield from ctx(source_stream)


MIME = magic.Magic(mime=True)

class UploadCtx:
    def __init__(self, input_stream, path, name, mime, auth, in_size):
        self.input_stream = input_stream
        self.path = path
        self.mime = mime
        self.name = name
        self.in_size = in_size
        self.session = requests.Session()
        if auth is not None:
            self.session.auth = auth
        self._config = None
        self.id = None

    def config(self):
        if self._config is None:
            self._config = self.client.config()
        return self._config

    @classmethod
    def from_stdin(cls, name, mime=None, auth=None):
        if mime is None:
            mime = "application/octet-stream"
        return cls(input_stream=sys.stdin.buffer, path=None, name=name, mime=mime, auth=auth, in_size=None)

    @classmethod
    def from_source_file(cls, path, mime=None, auth=None):
        if mime is None:
            mime = MIME.from_file(path)
        name = pathlib.Path(path).name
        try:
            in_size = os.path.getsize(path)
        except OSError:
            in_size = None
        return cls(input_stream=open(path, "rb"), path=path, name=name, mime=mime, auth=auth,in_size=in_size)

    @property
    def url(self):
        return DownloadURL(self.server, self.id, self.key)


    def upload_new(self, server: str, timeout_s: Optional[int] = None):
        assert(self.id is None)
        self.client = ClientAPI(self.session, server)

        if timeout_s is None:
            timeout_s = self.config().timeout_s_valid[-1]
        else:
            if timeout_s not in self.config().timeout_s_valid:
                raise ValueError("unsupported timeout value. Supported values are: " + ",".join((str(v) for v in self.config().timeout_s_valid)))

        self.key = secrets.token_bytes(16)
        iv = secrets.token_bytes(AESGCMChunks.IV_LEN)
        self.metadata = FileMetadata(
            name=self.name,
            mime_type=self.mime,
            iv=iv,
            chunk_size=1024*1024,
            key_sign=SignKey(self.key, iv),
            timeout_s=timeout_s)

        self.encrypt = AESGCMChunks(self.metadata.iv, self.key, encrypt=True)

        self.server = server
        self.id = self.client.upload_new(encryptMetadata(self.metadata, self.encrypt))
        self.stream = StreamTransform(self.encrypt, self.metadata.chunk_size, out_seek=0)
        return self.id

    def upload_resume(self, dest: DownloadURL):
        assert(self.id is None)
        self.server = dest.server
        self.client = ClientAPI(self.session, dest.server)
        self.id = dest.id
        self.key = dest.key

        metadata, out_size = self.client.metadata(self.id.file_id())
        if metadata.algo != ALGOS[0]:
            raise ValueError("algorithm '%s' not supported" % metadata.algo)

        self.encrypt = AESGCMChunks(metadata.iv, dest.key, encrypt=True)
        self.metadata = decryptMetadata(metadata, self.encrypt)
        self.stream = StreamTransform(self.encrypt, self.metadata.chunk_size, out_seek=out_size)
        self.input_stream.seek(self.stream.chunk_seek)

    def upload_push(self, cb_done=lambda l: l):
        assert(self.id is not None)
        self.client.upload_push(self.id, self.stream(self.input_stream, cb_done))

    def upload_finish(self):
        assert(self.id is not None)
        self.client.upload_finish(self.id)

    def encrypted_size(self):
        if self.in_size is None:
            return None
        return self.encrypt.out_size(self.in_size, self.metadata.chunk_size)

class DownloadCtx:
    def __init__(self, server: str, id_: str, key: bytes):
        self.id = id_
        self.client = ClientAPI(requests.Session(), server)
        self.key = key
        self.metadata = None
        self.decrypt = None

    @classmethod
    def from_url(cls, url: DownloadURL):
        return cls(url.server, url.id, url.key)

    def get_metadata(self) -> FileMetadata:
        if self.metadata is not None:
            return self.metadata
        # Get metadata
        metadata, size = self.client.metadata(self.id)
        if not VerifyKey(metadata.key_sign, self.key, metadata.iv):
            raise InvalidKey()
        self.decrypt = AESGCMChunks(metadata.iv, self.key, encrypt=False)
        self.metadata = decryptMetadata(metadata, self.decrypt)
        self.size = size
        return self.metadata

    def decrypted_size(self):
        metadata = self.get_metadata()
        return self.decrypt.out_size(self.size, metadata.chunk_size)

    def download(self, out_seek = 0):
        assert(self.metadata is not None)
        assert(self.decrypt is not None)
        if not VerifyKey(self.metadata.key_sign, self.key, self.metadata.iv):
            raise InvalidKey()
        stream = StreamTransform(self.decrypt, self.metadata.chunk_size+AESGCMChunks.TAG_SIZE, out_seek)
        r = self.client.download(self.id, stream.chunk_seek)
        with r:
            yield from stream(r.raw)
