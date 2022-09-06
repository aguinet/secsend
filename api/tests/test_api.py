import unittest
import tempfile
import base64
import time

from secsend_api import declare_app
from secsend_api.backend import FileID, RootID, BaseID, BackendErrorIDUnavailable
from secsend_api.backend_files import BackendFiles
from secsend_api.metadata import EncryptedFileMetadata
from sanic_testing.reusable import ReusableClient
from sanic_testing.testing import SanicTestClient
from sanic_testing import TestManager

METADATA = EncryptedFileMetadata(name=b"ENCRYPTED_NAME", mime_type=b"ENCRYPTED_MIME_TYPE", iv=b"\x00"*12, chunk_size=b"ENCRYPTED_CHUNK_SIZE", key_sign=b"")

class TestBackendFiles(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory(prefix="secsend_api")
        self.app = declare_app(enable_cors=False, backend_files_root=self.root.name, html_root=None, timeout_s_valid=[0,1])

    def tearDown(self):
        self.root.cleanup()

    def test_api_config(self):
        _, response = self.app.test_client.get("/v1/config")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.json['filesize_limit'], 0)

    def test_api_invalid_metadata(self):
        _, response = self.app.test_client.post("/v1/upload/new", json={})
        self.assertEqual(response.status, 400)

    def test_api_unk_id(self):
        rid = RootID.generate()
        id_ = str(rid.file_id())
        for url in ("/metadata", "/download"):
            _, response = self.app.test_client.get("%s/%s" % (url,id_))
            self.assertEqual(response.status, 404)

        _, response = self.app.test_client.post("/v1/upload/push/%s" % str(rid), json=METADATA.jsonable())
        self.assertEqual(response.status, 404)

    def test_api_invalid_id(self):
        for id_ in ("0", base64.urlsafe_b64encode(b"AA")):
            for url in ("metadata", "download"):
                _, response = self.app.test_client.get("/v1/%s/%s" % (url,id_))
                self.assertEqual(response.status, 400)

            _, response = self.app.test_client.post("/v1/upload/push/%s" % id_, json=METADATA.jsonable())
            self.assertEqual(response.status, 400)

    def test_api_upload_download_delete(self):
        client = self.app.test_client
        _, response = client.post("/v1/upload/new", json=METADATA.jsonable())
        self.assertEqual(response.status, 200)
        rid = response.json['root_id']
        rid = RootID.from_str(rid)
        rid_s = str(rid)

        data = b"hello world!"

        _, response = client.post("/v1/upload/push/%s" % rid_s, data=data[:4])
        self.assertEqual(response.status, 200)
        _, response = client.post("/v1/upload/push/%s" % rid_s, data=data[4:])
        self.assertEqual(response.status, 200)
        _, response = client.post("/v1/upload/finish/%s" % rid_s)
        self.assertEqual(response.status, 200)

        id_ = str(rid.file_id())
        _, response = client.get("/v1/metadata/%s" % id_)
        self.assertEqual(response.status, 200)
        d = response.json
        self.assertEqual(d['size'], len(data))
        ret_metadata = d['metadata']
        self.assertTrue(ret_metadata['complete'])
        del ret_metadata['complete']
        ref = METADATA.jsonable()
        del ref['complete']
        self.assertEqual(ret_metadata, ref)

        _, response = client.get("/v1/download/%s" % id_)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.read(), data)

        _, response = client.post("/v1/delete/%s" % id_)
        self.assertEqual(response.status, 400)

        _, response = client.post("/v1/delete/%s" % rid_s)
        self.assertEqual(response.status, 200)

        _, response = client.get("/v1/download/%s" % id_)
        self.assertEqual(response.status, 404)

    def test_api_upload_timeout(self):
        client = self.app.test_client
        metadata = METADATA.jsonable()
        metadata['timeout_s'] = 1
        _, response = client.post("/v1/upload/new", json=metadata)
        self.assertEqual(response.status, 200)
        rid = response.json['root_id']
        rid = RootID.from_str(rid)
        rid_s = str(rid)

        data = b"hello world!"

        _, response = client.post("/v1/upload/push/%s" % rid_s, data=data)
        self.assertEqual(response.status, 200)
        time.sleep(2)
        _, response = client.post("/v1/upload/finish/%s" % rid_s)
        self.assertEqual(response.status, 200)

        id_ = str(rid.file_id())
        _, response = client.get("/v1/download/%s" % id_)
        self.assertEqual(response.status, 200)

        time.sleep(2)
        _, response = client.get("/v1/download/%s" % id_)
        self.assertEqual(response.status, 404)

    def test_api_invalid_timeout(self):
        client = self.app.test_client
        metadata = METADATA.jsonable()
        metadata['timeout_s'] = 4
        _, response = client.post("/v1/upload/new", json=metadata)
        self.assertEqual(response.status, 400)

class TestBackendFilesFilesizeLimit(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory(prefix="secsend_api")
        self.filesize_limit = 1024
        self.app = declare_app(enable_cors=False, backend_files_root=self.root.name, html_root=None, timeout_s_valid=[0,1], filesize_limit=self.filesize_limit)

    def test_api_config(self):
        _, response = self.app.test_client.get("/v1/config")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.json['filesize_limit'], self.filesize_limit)

    def test_api_upload_okay(self):
        client = self.app.test_client
        _, response = client.post("/v1/upload/new", json=METADATA.jsonable())
        self.assertEqual(response.status, 200)
        rid = response.json['root_id']
        rid = RootID.from_str(rid)
        rid_s = str(rid)

        data = b"hello world!"

        _, response = client.post("/v1/upload/push/%s" % rid_s, data=data)
        self.assertEqual(response.status, 200)
        _, response = client.post("/v1/upload/finish/%s" % rid_s)
        self.assertEqual(response.status, 200)

    def test_api_upload_toobig(self):
        client = self.app.test_client
        _, response = client.post("/v1/upload/new", json=METADATA.jsonable())
        self.assertEqual(response.status, 200)
        rid = response.json['root_id']
        rid = RootID.from_str(rid)
        rid_s = str(rid)

        data = b"A"*self.filesize_limit

        _, response = client.post("/v1/upload/push/%s" % rid_s, data=data[:4])
        self.assertEqual(response.status, 200)
        _, response = client.post("/v1/upload/push/%s" % rid_s, data=data[4:])
        self.assertEqual(response.status, 400)
        _, response = client.post("/v1/upload/finish/%s" % rid_s)
        self.assertEqual(response.status, 404)

class TestBackendFilesTinyIDs(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory(prefix="secsend_api")
        self.app = declare_app(enable_cors=False, backend_files_root=self.root.name, html_root=None, timeout_s_valid=[0,1])
        self.org_ID_LEN = BaseID.ID_LEN
        BaseID.ID_LEN = 1

    def tearDown(self):
        self.root.cleanup()
        BaseID.ID_LEN = self.org_ID_LEN

    def test_api_lots_id(self):
        client = self.app.test_client
        # Birthday paradox: after 128 insertions, we'll have a 50% chance to
        # hit an already existing file. At some point, we should catch a 500
        # error.
        for i in range(256):
            _, response = client.post("/v1/upload/new", json=METADATA.jsonable())
            if response.status == 200:
                continue
            if response.status == 500:
                self.assertEqual(response.json['message'], str(BackendErrorIDUnavailable()))
                return
        # We should had come to a point where we were not able to catch an ID
        self.assertTrue(False)
