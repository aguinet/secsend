import pytest
import tempfile

from secsend_api.backend import RootID, FileID, BackendErrorIDExists, BackendErrorIDUnknown, BackendErrorFileLocked
from secsend_api.metadata import EncryptedFileMetadata
from secsend_api.backend_files import BackendFiles

pytest_plugins = ('pytest_asyncio',)

METADATA = EncryptedFileMetadata(name=b"ENCRYPTED_NAME", mime_type=b"ENCRYPTED_MIME_TYPE", iv=b"\x00"*16, chunk_size=b"ENCRYPTED_CHUNK_SIZE", key_sign=b"")

@pytest.fixture
def backend():
    with tempfile.TemporaryDirectory(prefix="secsend_api") as root:
        yield BackendFiles(root)

@pytest.mark.asyncio
async def test_create_read(backend):
    fid = RootID.generate().file_id()
    data = b"coucou"
    async with backend.create(fid, METADATA).stream_append() as s:
        await s.write(data)

    f = backend.open(fid)
    assert(f.metadata == METADATA)
    async with f.stream_read() as s:
        assert(await s.read() == data)

@pytest.mark.asyncio
async def test_lock(backend):
    fid = RootID.generate().file_id()
    f = backend.create(fid, METADATA)
    with pytest.raises(BackendErrorFileLocked):
        async with f.lock_write():
            async with f.lock_write(): pass

def test_create_exists(backend):
    fid = RootID.generate().file_id()
    backend.create(fid, METADATA)
    with pytest.raises(BackendErrorIDExists):
        backend.create(fid, METADATA)

def test_read_unk(backend):
    fid = RootID.generate().file_id()
    with pytest.raises(BackendErrorIDUnknown):
        # Force calling the metadata, otherwise it is lazy loaded and no
        # exception happens
        backend.open(fid).metadata
