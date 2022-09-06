import unittest
import tempfile
import io
import os
import random
import string

import requests_mock

from secsend.client import DownloadURL, RootID
from secsend.stream import stream_transform, UploadCtx, DownloadCtx
from secsend.metadata import FileMetadata, encryptMetadata
from secsend.crypto import AESGCMChunks, SignKey

class TransformerEncr:
    TAG = b"TTAG"

    @classmethod
    def out_chunk_size(cls, in_chunk_size):
        return in_chunk_size + len(cls.TAG)

    def seek_chunk_idx(self, n): pass

    def process(self, data):
        return bytes(c^0x01 for c in data) + self.TAG

class TransformerDecr:
    @staticmethod
    def out_chunk_size(in_chunk_size):
        return in_chunk_size - len(TransformerEncr.TAG)

    def seek_chunk_idx(self, n): pass

    def process(self, data):
        assert(data[-len(TransformerEncr.TAG):] == TransformerEncr.TAG)
        return bytes(c^0x01 for c in data[:-len(TransformerEncr.TAG)])

class TestStream(unittest.TestCase):
    def _transform_data(self, data, chunk_size, transformer=TransformerEncr()):
        in_stream = io.BytesIO()
        in_stream.write(data)
        in_stream.seek(0, 0)
        out = io.BytesIO()
        for d in stream_transform(in_stream, transformer, chunk_size):
            out.write(d)
        out.flush()
        return out.getvalue()

    def test_stream_transform(self):
        ref_data = b"hello world!"
        out_buf = self._transform_data(ref_data, len(ref_data))
        self.assertEqual(out_buf, TransformerEncr().process(ref_data))

    def test_stream_encrypt_seek(self):
        ref_data = "".join(random.choice(string.ascii_lowercase) for _ in range(257)).encode("ascii")
        chunk_size = 16
        ref_out = self._transform_data(ref_data, chunk_size)

        in_stream = io.BytesIO()
        in_stream.write(ref_data)

        for cut in (1,2,5,chunk_size-1,chunk_size,chunk_size+1,chunk_size+2,TransformerEncr.out_chunk_size(chunk_size)):
            in_stream.seek(0, 0)

            out = io.BytesIO()
            d = next(stream_transform(in_stream, TransformerEncr(), chunk_size))
            out.write(d[:cut])

            in_stream.seek(0,0)
            for d in stream_transform(in_stream, TransformerEncr(), chunk_size, out.tell()):
                out.write(d)

            out.flush()
            self.assertEqual(out.getvalue(), ref_out)

    def test_stream_decrypt(self):
        ref_data = "".join(random.choice(string.ascii_lowercase) for _ in range(257)).encode("ascii")
        chunk_size = 16
        encr_data = self._transform_data(ref_data, chunk_size)
        decr_data = self._transform_data(encr_data, chunk_size+len(TransformerEncr.TAG), TransformerDecr())
        self.assertEqual(decr_data, ref_data)

    def test_stream_decrypt_seek(self):
        ref_data = "".join(random.choice(string.ascii_lowercase) for _ in range(257)).encode("ascii")
        chunk_size = 16
        encr_data = self._transform_data(ref_data, chunk_size)

        in_stream = io.BytesIO()
        in_stream.write(encr_data)

        in_chunk_size = chunk_size+len(TransformerEncr.TAG)
        for cut in (1,2,5,in_chunk_size-1,in_chunk_size,in_chunk_size+1,in_chunk_size+2,chunk_size,chunk_size-1,chunk_size+1):
            in_stream.seek(0, 0)

            out = io.BytesIO()
            d = next(stream_transform(in_stream, TransformerDecr(), in_chunk_size))
            out.write(d[:cut])

            in_stream.seek(0,0)
            for d in stream_transform(in_stream, TransformerDecr(), in_chunk_size, out.tell()):
                out.write(d)

            out.flush()
            self.assertEqual(out.getvalue(), ref_data)

    def mock_config(self, session_mock):
        session_mock.get("http://secsend.test/v1/config", json={'timeout_s_valid': [0]})

    def test_upload(self):
        ref_data = "".join(random.choice(string.ascii_lowercase) for _ in range(257)).encode("ascii")
        myid = RootID.generate()
        iv = random.randbytes(AESGCMChunks.IV_LEN)
        key = random.randbytes(16)
        metadata = FileMetadata(name="toto", mime_type="application/octet-stream", iv=iv, chunk_size=10, key_sign=SignKey(key,iv), timeout_s=0)
        with tempfile.NamedTemporaryFile(prefix="secsend-test") as f:
            f.write(ref_data)
            f.flush()

            ctx = UploadCtx.from_source_file(f.name)
            with requests_mock.Mocker(session=ctx.session) as session_mock:
                session_mock.post("http://secsend.test/v1/upload/new", json={'root_id': str(myid)})
                self.mock_config(session_mock)

                id_ = ctx.upload_new("http://secsend.test")
                self.assertEqual(str(id_), str(myid))

                session_mock.post(ctx.client._get_url("upload/push/%s" % id_), json={})
                ctx.upload_push()

                session_mock.post(ctx.client._get_url("upload/finish/%s" % id_), json={})
                ctx.upload_finish()

            ctx = UploadCtx.from_source_file(f.name)
            with requests_mock.Mocker(session=ctx.session) as session_mock:
                encrMetadata = encryptMetadata(metadata, AESGCMChunks(iv, key, encrypt=True))
                session_mock.get("http://secsend.test/v1/metadata/%s" % myid.file_id(), json={'metadata': encrMetadata.jsonable(), 'size': 1})
                ctx.upload_resume(DownloadURL.from_url("http://secsend.test/v1/download/%s#%s" % (myid, DownloadURL.key_to_txt(key))))

                session_mock.post(ctx.client._get_url("upload/push/%s" % myid), json={})
                ctx.upload_push()

                session_mock.post(ctx.client._get_url("upload/finish/%s" % myid), json={})
                ctx.upload_finish()

    def test_download(self):
        ref_data = "".join(random.choice(string.ascii_lowercase) for _ in range(257)).encode("ascii")
        key = random.randbytes(16)
        iv = random.randbytes(AESGCMChunks.IV_LEN)
        encrypt = AESGCMChunks(iv, key, encrypt=True)
        chunk_size = 17
        encr_data = self._transform_data(ref_data, chunk_size, encrypt)

        myid = "MYID"
        ctx = DownloadCtx("http://secsend.test", myid, key)
        metadata = FileMetadata(name="toto", mime_type="application/octet-stream", iv=iv, chunk_size=chunk_size, key_sign=SignKey(key, iv), timeout_s=0)
        with requests_mock.Mocker(session=ctx.client.session) as session_mock:
            encrMetadata = encryptMetadata(metadata, AESGCMChunks(iv, key, encrypt=False))
            session_mock.get(ctx.client._get_url("metadata/%s" % myid), json={'metadata': encrMetadata.jsonable(), 'size': len(encr_data)})
            self.assertEqual(ctx.get_metadata(), metadata)

            session_mock.get(ctx.client._get_url("download/%s" % myid), body=io.BytesIO(encr_data))
            out = io.BytesIO()
            for d in ctx.download():
                out.write(d)
            self.assertEqual(out.getvalue(), ref_data)
