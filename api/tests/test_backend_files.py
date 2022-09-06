import unittest
import tempfile
import os

from secsend_api.backend import RootID, FileID, BackendErrorIDExists, BackendErrorIDUnknown, BackendErrorFileLocked
from secsend_api.metadata import EncryptedFileMetadata
from secsend_api.backend_files import BackendFiles

METADATA = EncryptedFileMetadata(name=b"ENCRYPTED_NAME", mime_type=b"ENCRYPTED_MIME_TYPE", iv=b"\x00"*16, chunk_size=b"ENCRYPTED_CHUNK_SIZE", key_sign=b"")

class TestBackendFiles(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory(prefix="secsend_api")
        self.backend = BackendFiles(self.root.name)

    def tearDown(self):
        self.root.cleanup()

    async def test_create_read(self):
        fid = RootID.generate().file_id()
        data = b"coucou"
        async with self.backend.create(fid, METADATA).stream_append() as s:
            await s.write(data)

        f = self.backend.open(fid)
        self.assertEqual(f.metadata, METADATA)
        async with f.stream_read() as s:
            self.assertEqual(await s.read(), data)

    async def test_lock(self):
        fid = RootID.generate().file_id()
        f = self.backend.create(fid, METADATA)
        with self.assertRaises(BackendErrorFileLocked):
            async with f.lock_write():
                async with f.lock_write(): pass

    def test_create_exists(self):
        fid = RootID.generate().file_id()
        self.backend.create(fid, METADATA)
        with self.assertRaises(BackendErrorIDExists):
            self.backend.create(fid, METADATA)

    def test_read_unk(self):
        fid = RootID.generate().file_id()
        with self.assertRaises(BackendErrorIDUnknown):
            # Force calling the metadata, otherwise it is lazy loaded and no
            # exception happens
            self.backend.open(fid).metadata
