import {RootID, FileID, IDKind} from './fileid';
import {Cancellable} from './utils';
import {EncryptedMetadata} from './metadata';

export class UploadCanceled extends Error { }

export interface ClientMetadata {
  metadata: EncryptedMetadata
  size: number
}

export interface ServerConfig {
  timeout_s_valid: Array<number>;
  filesize_limit: number;
}

export interface APIError {
  message: string;
  status: number;
  description: string;
}

export class ClientError extends Error {
  res: Response | null;
  err: APIError;

  constructor(res: Response, err: APIError) {
    super(err.message);
    this.res = res;
    this.err = err;
  }

  static async check(res: Response) {
    if (!res.ok) {
      throw new ClientError(res, await res.json());
    }
  }
}

export class Client {
  base: string;

  constructor(base: string) {
    this.base = base.replace(/[/ ]+$/g, '');
  }

  async metadata(id: FileID): Promise<ClientMetadata> {
    const req = await fetch(this.url("metadata/" + id.str()), {
      method: 'GET'
    });
    await ClientError.check(req);
    const data = await req.json();
    return {metadata: EncryptedMetadata.fromJsonable(data.metadata), size: data.size};
  }

  async config(): Promise<ServerConfig> {
    const req = await fetch(this.url("config"), {
      method: 'GET'
    });
    await ClientError.check(req);
    return await req.json();
  }

  async upload_new(metadata: EncryptedMetadata): Promise<RootID> {
    const req = await fetch(this.url("upload/new"), {
      method: 'POST',
      body: JSON.stringify(metadata.jsonable())
    });
    await ClientError.check(req);
    return RootID.fromStr((await req.json())['root_id'], IDKind.Root) as RootID;
  }

  async upload_push_blob(id: RootID, data: ArrayBuffer, onprogress: (done: number) => void, cancellable: Cancellable): Promise<void> {
    // We use XMLHttpRequest, because it seems to be the only way to get a
    // callback on progress. All of this will be cleaner once fetch supports
    // ReadableStream (already an experimental feature of Chromium).
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let curTimeout: any = null;
      let abortReason: Error | null = null;
      xhr.upload.onprogress = (event: ProgressEvent) => {
        // If no progress has been made in 10s, abort the request.
        clearTimeout(curTimeout);
        curTimeout = setTimeout(() => {
          abortReason = new ClientError(null, {message: "request timeout", status: 400, description: "request timeout"});
          xhr.abort();
        }, 2000);
        onprogress(event.loaded);
      };
      xhr.onabort = () => {
        clearTimeout(curTimeout);
        reject(abortReason); };
      xhr.onerror = () => {
        clearTimeout(curTimeout);
        reject(new ClientError(null, {message: "request error", status: 400, description: "request error"})); };
      xhr.onload = () => {
        clearTimeout(curTimeout);
        if (xhr.status !== 200) {
          reject(new ClientError(null, xhr.response));
        }
        resolve();
      };
      xhr.open('POST', this.url("upload/push/" + id.str()), true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.send(data);
      cancellable.addOnCancel(() => {
        clearTimeout(curTimeout);
        abortReason = new UploadCanceled();
        xhr.abort();
      });
    });
  }

  async upload_finish(id: RootID): Promise<void> {
    const req = await fetch(this.url("upload/finish/" + id.str()), {
      method: 'POST',
    });
    await ClientError.check(req);
  }

  async delete(id: RootID): Promise<void> {
    const req = await fetch(this.url("delete/" + id.str()), {
      method: 'POST',
    });
    await ClientError.check(req);
  }

  private url(uri: string) {
    return this.base + "/v1/" + uri;
  }
}
