import pytest
import tempfile
import base64
import time
import os
from unittest.mock import patch

from secsend_api import declare_app
from secsend_api.backend import RootID, BaseID, BackendErrorIDUnavailable
from secsend_api.metadata import EncryptedFileMetadata

METADATA = EncryptedFileMetadata(name=b"ENCRYPTED_NAME", mime_type=b"ENCRYPTED_MIME_TYPE", iv=b"\x00"*12, chunk_size=b"ENCRYPTED_CHUNK_SIZE", key_sign=b"")

@pytest.fixture
def app_backend_files():
    with tempfile.TemporaryDirectory(prefix="secsend_api") as root:
        app = declare_app(enable_cors=False, backend_files_root=root, html_root=None, timeout_s_valid=[0,1])
        yield app

def test_api_config(app_backend_files):
    _, response = app_backend_files.test_client.get("/v1/config")
    assert(response.status == 200)
    assert(response.json['filesize_limit'] == 0)

def test_api_invalid_metadata(app_backend_files):
    _, response = app_backend_files.test_client.post("/v1/upload/new", json={})
    assert(response.status == 400)

def test_api_unk_id(app_backend_files):
    rid = RootID.generate()
    id_ = str(rid.file_id())
    for url in ("/metadata", "/download"):
        _, response = app_backend_files.test_client.get("%s/%s" % (url,id_))
        assert(response.status == 404)

    _, response = app_backend_files.test_client.post("/v1/upload/push/%s" % str(rid), json=METADATA.jsonable())
    assert(response.status == 404)

def test_api_invalid_id(app_backend_files):
    for id_ in ("0", base64.urlsafe_b64encode(b"AA")):
        for url in ("metadata", "download"):
            _, response = app_backend_files.test_client.get("/v1/%s/%s" % (url,id_))
            assert(response.status == 400)

        _, response = app_backend_files.test_client.post("/v1/upload/push/%s" % id_, json=METADATA.jsonable())
        assert(response.status == 400)

def test_api_upload_download_delete(app_backend_files):
    client = app_backend_files.test_client
    _, response = client.post("/v1/upload/new", json=METADATA.jsonable())
    assert(response.status == 200)
    rid = response.json['root_id']
    rid = RootID.from_str(rid)
    rid_s = str(rid)

    data = b"hello world!"

    _, response = client.post("/v1/upload/push/%s" % rid_s, data=data[:4])
    assert(response.status == 200)
    _, response = client.post("/v1/upload/push/%s" % rid_s, data=data[4:])
    assert(response.status == 200)
    _, response = client.post("/v1/upload/finish/%s" % rid_s)
    assert(response.status == 200)

    id_ = str(rid.file_id())
    _, response = client.get("/v1/metadata/%s" % id_)
    assert(response.status == 200)
    d = response.json
    assert(d['size'] == len(data))
    ret_metadata = d['metadata']
    assert(ret_metadata['complete'])
    del ret_metadata['complete']
    ref = METADATA.jsonable()
    del ref['complete']
    assert(ret_metadata == ref)

    _, response = client.get("/v1/download/%s" % id_)
    assert(response.status == 200)
    assert(response.read() == data)

    _, response = client.post("/v1/delete/%s" % id_)
    assert(response.status == 400)

    _, response = client.post("/v1/delete/%s" % rid_s)
    assert(response.status == 200)

    _, response = client.get("/v1/download/%s" % id_)
    assert(response.status == 404)

def test_api_upload_timeout(app_backend_files):
    client = app_backend_files.test_client
    metadata = METADATA.jsonable()
    metadata['timeout_s'] = 1
    _, response = client.post("/v1/upload/new", json=metadata)
    assert(response.status == 200)
    rid = response.json['root_id']
    rid = RootID.from_str(rid)
    rid_s = str(rid)

    data = b"hello world!"

    _, response = client.post("/v1/upload/push/%s" % rid_s, data=data)
    assert(response.status == 200)
    time.sleep(2)
    _, response = client.post("/v1/upload/finish/%s" % rid_s)
    assert(response.status == 200)

    id_ = str(rid.file_id())
    _, response = client.get("/v1/download/%s" % id_)
    assert(response.status == 200)

    time.sleep(2)
    _, response = client.get("/v1/download/%s" % id_)
    assert(response.status == 404)

def test_api_invalid_timeout(app_backend_files):
    client = app_backend_files.test_client
    metadata = METADATA.jsonable()
    metadata['timeout_s'] = 4
    _, response = client.post("/v1/upload/new", json=metadata)
    assert(response.status == 400)

FILESIZE_LIMIT = 1024
@pytest.fixture
def app_backend_files_sizelimit():
    with tempfile.TemporaryDirectory(prefix="secsend_api") as root:
        app = declare_app(enable_cors=False, backend_files_root=root, html_root=None, timeout_s_valid=[0,1], filesize_limit=FILESIZE_LIMIT)
        yield app

def test_api_config(app_backend_files_sizelimit):
    _, response = app_backend_files_sizelimit.test_client.get("/v1/config")
    assert(response.status == 200)
    assert(response.json['filesize_limit'] == FILESIZE_LIMIT)

def test_api_upload_okay(app_backend_files_sizelimit):
    client = app_backend_files_sizelimit.test_client
    _, response = client.post("/v1/upload/new", json=METADATA.jsonable())
    assert(response.status == 200)
    rid = response.json['root_id']
    rid = RootID.from_str(rid)
    rid_s = str(rid)

    data = b"hello world!"

    _, response = client.post("/v1/upload/push/%s" % rid_s, data=data)
    assert(response.status == 200)
    _, response = client.post("/v1/upload/finish/%s" % rid_s)
    assert(response.status == 200)

def test_api_upload_toobig(app_backend_files_sizelimit):
    client = app_backend_files_sizelimit.test_client
    _, response = client.post("/v1/upload/new", json=METADATA.jsonable())
    assert(response.status == 200)
    rid = response.json['root_id']
    rid = RootID.from_str(rid)
    rid_s = str(rid)

    data = b"A"*FILESIZE_LIMIT

    _, response = client.post("/v1/upload/push/%s" % rid_s, data=data[:4])
    assert(response.status == 200)
    _, response = client.post("/v1/upload/push/%s" % rid_s, data=data[4:])
    assert(response.status == 400)
    _, response = client.post("/v1/upload/finish/%s" % rid_s)
    assert(response.status == 404)

def test_api_lots_id(app_backend_files):
    client = app_backend_files.test_client
    with patch.object(BaseID, "ID_LEN", new=1):
        # Birthday paradox: after 128 insertions, we'll have a 50% chance to
        # hit an already existing file. At some point, we should catch a 500
        # error.
        for i in range(256):
            _, response = client.post("/v1/upload/new", json=METADATA.jsonable())
            if response.status == 200:
                continue
            if response.status == 500:
                assert(response.json['message'] == str(BackendErrorIDUnavailable()))
                return
        # We should had come to a point where we were not able to catch an ID
        assert(False)

@pytest.fixture
def app_backend_files_html():
    with tempfile.TemporaryDirectory(prefix="secsend_api") as root:
        with tempfile.TemporaryDirectory(prefix="secsend_html_root") as html_root:
            with open(os.path.join(html_root, "index.html"),"w") as f:
                f.write("hello")
            with open(os.path.join(html_root, "style.css"),"w") as f:
                f.write("hello css")
            app = declare_app(enable_cors=False, backend_files_root=root, html_root=html_root, timeout_s_valid=[0,1])
            yield app

def test_html_index(app_backend_files_html):
    _, response = app_backend_files_html.test_client.get("/index.html")
    assert(response.text == "hello")
    _, response = app_backend_files_html.test_client.get("/style.css")
    assert(response.text == "hello css")
