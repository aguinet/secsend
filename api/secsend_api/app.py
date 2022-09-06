import json
import jsonschema
import secrets
import os
import sys
from pathlib import Path
from aiofiles import os as async_os

from sanic import Sanic, Blueprint, response, exceptions
from sanic.compat import stat_async
from sanic.handlers import ContentRangeHandler
from sanic.exceptions import HeaderNotFound

from .cors import add_cors_headers
from .options import setup_options
from .backend import RootID, FileID, BaseID
from .metadata import EncryptedFileMetadata, ALGOS
from .backend import BackendErrorIDUnknown, BackendErrorIDExists, BackendErrorIDInvalid, BackendErrorIDWrongType, BackendError, BackendErrorFileLocked, BackendErrorIDUnavailable
from .backend_files import BackendFiles

encr_metadata_json_schema = {
    'type': 'object',
    'properties': {
        'name': {'type': 'string', 'contentEncoding': 'base64'},
        'mime_type': {'type': 'string', 'contentEncoding': 'base64'},
        'chunk_size': {'type': 'string', 'contentEncoding': 'base64'},
        'iv': {'type': 'string', 'contentEncoding': 'base64'},
        'timeout_s': {'type': 'number', 'min': 0},
        'version': {
            'type': 'number',
            'min': 1
        },
        'algo': {
            'type': 'string',
            'enum': ALGOS
        }
    },
    'required': ['name','mime_type','iv','chunk_size','version','timeout_s'],
}

bp = Blueprint("api", version=1)

def get_backend(request):
    return request.app.ctx.backend

@bp.post("/upload/new")
async def upload_new(request):
    try:
        metadata = request.json
        jsonschema.validate(instance=metadata, schema=encr_metadata_json_schema)
        metadata['complete'] = False
        # Will be set once the upload is finished
        metadata['timeout_ts'] = 0
        if metadata['timeout_s'] not in request.app.config.TIMEOUT_S_VALID:
            raise exceptions.InvalidUsage("invalid timeout value")
        metadata = EncryptedFileMetadata.from_jsonable(metadata)
    except jsonschema.exceptions.ValidationError as e:
        raise exceptions.InvalidUsage("invalid metadata: %s" % str(e))
    if len(metadata.iv) != 12:
        raise exceptions.InvalidUsage("IV length must be 12 bytes")

    for i in range(8):
        try:
            rid = RootID.generate()
            fid = rid.file_id()
            f = get_backend(request).create(fid, metadata)
            break
        except BackendErrorIDExists:
            continue
    else:
        raise BackendErrorIDUnavailable()
    return response.json({"root_id": str(rid)})

@bp.post("/upload/push/<id_>", stream=True)
async def upload_push(request, id_):
    rid = RootID.from_str(id_)
    fid = rid.file_id()
    f = get_backend(request).open(fid)
    filesize_limit = request.app.config.FILESIZE_LIMIT
    async with f.lock_write():
        if filesize_limit is not None:
            cursize = f.size
        if f.metadata.complete:
            raise exceptions.InvalidUsage("ID '%s' is already complete" % id_)
        async with f.stream_append() as s:
            while True:
                body = await request.stream.read()
                if body is None:
                    break
                if filesize_limit is not None:
                    cursize += len(body)
                    if cursize >= filesize_limit:
                        f.delete()
                        raise exceptions.InvalidUsage("file limit exceeded")
                await s.write(body)
    return response.json({})

@bp.post("/upload/finish/<id_>")
async def upload_finish(request, id_):
    rid = RootID.from_str(id_)
    fid = rid.file_id()
    f = get_backend(request).open(fid)
    async with f.lock_write():
        f.set_as_complete()
    return response.json({})

@bp.get("/metadata/<id_>")
async def metadata(request, id_):
    fid = FileID.from_str(id_)
    f = get_backend(request).open(fid)
    f.check_validity()
    ret = f.metadata.jsonable()
    ret = {
        'metadata': f.metadata.jsonable(),
        'size': f.size
    }
    return response.json(ret)

@bp.get("/download/<id_>")
async def download(request, id_):
    fid = FileID.from_str(id_)
    f = get_backend(request).open(fid)
    if not f.metadata.complete:
        raise exceptions.InvalidUsage("ID '%s' isn't completely uploaded yet" % str(fid))
    f.check_validity()

    path = f.content_path

    length = f.size
    _range = None
    try:
        stats = await stat_async(path)
        _range = ContentRangeHandler(request, stats)
        length -= _range.start
    except HeaderNotFound:
        pass

    return await response.file_stream(
        path,
        headers={
            "Content-Type": "application/octet-stream",
            "Content-Length": length
        },
        _range=_range,
        chunk_size=1024*1024*10,
    )

@bp.post("/delete/<id_>")
async def upload_finish(request, id_):
    rid = RootID.from_str(id_)
    fid = rid.file_id()
    f = get_backend(request).open(fid)
    f.check_validity()
    f.delete()
    return response.json({})

@bp.get("/config")
async def config(request):
    filesize_limit = request.app.config.FILESIZE_LIMIT
    filesize_limit = 0 if filesize_limit is None else filesize_limit
    return response.json({'timeout_s_valid': request.app.config.TIMEOUT_S_VALID, 'filesize_limit': filesize_limit})

def declare_app(enable_cors=False, backend_files_root=None, html_root=None, timeout_s_valid=None, filesize_limit=None):
    app = Sanic("secsend", env_prefix="SECSEND_")
    app.config.FALLBACK_ERROR_FORMAT = "json"

    if backend_files_root is not None:
        app.config.BACKEND_FILES_ROOT = backend_files_root
    if html_root is not None:
        app.config.HTML_ROOT = html_root

    if filesize_limit is None:
        try:
            filesize_limit = int(app.config.FILESIZE_LIMIT)
        except AttributeError:
            filesize_limit = None
    app.config.FILESIZE_LIMIT = filesize_limit

    if enable_cors:
        # Add OPTIONS handlers to any route that is missing it
        app.register_listener(setup_options, "before_server_start")

        # Fill in CORS headers
        app.register_middleware(add_cors_headers, "response")

    if timeout_s_valid is None:
        try:
            timeout_s_valid = app.config.TIMEOUT_S_VALID
        except AttributeError:
            timeout_s_valid = "0"

        try:
            timeout_s_valid = [int(v) for v in str(timeout_s_valid).split(",")]
            if any(v < 0 for v in timeout_s_valid):
                raise ValueError("negative value")
        except ValueError as e:
            raise ValueError("invalid timeout_s_valid value: %s" % e)
    app.config.TIMEOUT_S_VALID = timeout_s_valid

    try:
        html_root = app.config.HTML_ROOT
    except AttributeError:
        try:
            import secsend_webapp
            html_root = secsend_webapp.root
        except ImportError:
            html_root = None

    if html_root is not None:
        app.ctx.html_root = html_root
        app.static("/", os.path.join(html_root, "index.html"))
        app.static("/", html_root)
        app.static("/dl", os.path.join(html_root, "dl.html"))
    else:
        print("Warning: no html_root has been specified, sanic won't serve the webapp", file=sys.stderr)

    # Set backend
    try:
        backend_files_root = app.config.BACKEND_FILES_ROOT
    except AttributeError:
        backend_files_root = os.path.realpath("secsend_root")
        print("Warning: no backend_files_root has been specified, using the path '%s'" % backend_files_root, file=sys.stderr)
    app.ctx.backend = BackendFiles(Path(backend_files_root))

    app.blueprint(bp)

    @app.exception(BackendError)
    async def catch_id_unk(request, exc):
        raise exceptions.ServerError(str(exc))

    @app.exception(BackendErrorIDUnavailable)
    async def catch_id_unk(request, exc):
        raise exceptions.ServerError(str(exc))

    @app.exception(BackendErrorIDUnknown)
    async def catch_id_unk(request, exc):
        raise exceptions.NotFound(str(exc))

    @app.exception(BackendErrorIDExists)
    async def catch_id_unk(request, exc):
        raise exceptions.InvalidUsage(str(exc))

    @app.exception(BackendErrorIDInvalid)
    async def catch_id_unk(request, exc):
        raise exceptions.InvalidUsage(str(exc))

    @app.exception(BackendErrorIDWrongType)
    async def catch_id_wrong_type(request, exc):
        raise exceptions.InvalidUsage(str(exc))

    @app.exception(BackendErrorFileLocked)
    async def catch_file_locked(request, exc):
        raise exceptions.InvalidUsage(str(exc))

    return app
