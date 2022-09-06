import {Cancellable, jsonReplaceArrayBuffer} from '../core/utils';
import {DownloadURL, JSONDownloadURL} from '../core/url';
import {UploadCanceled} from '../core/client';
import {BaseID} from '../core/fileid';
import {UploadCtx} from './uploadCtx';

export function duplicateFileList(fl: FileList | null): FileList {
  const obj = new DataTransfer();
  if (fl !== null) {
    for (let i = 0; i < fl.length; i++) {
      obj.items.add(fl.item(i));
    }
  }
  return obj.files;
}

interface JSONUploadInfo {
  url: JSONDownloadURL,
  name: string,
  mimeType: string
}

export class UploadInfo {
  readonly url: DownloadURL;
  readonly name: string;
  readonly mimeType: string;

  constructor(url: DownloadURL, name: string, mimeType: string) {
    this.url = url;
    this.name = name;
    this.mimeType = mimeType;
  }

  jsonable(): JSONUploadInfo {
    return {url: this.url.jsonable(), name: this.name, mimeType: this.mimeType};
  }

  static fromJsonable(data: JSONUploadInfo): UploadInfo {
    return new UploadInfo(DownloadURL.fromJsonable(data.url, window.crypto), data.name, data.mimeType);
  }
}

export class UploadInProgress {
  cancellable: Cancellable;
  uploadProm: Promise<void> | null;
  progress: number;
  uploadSpeed: number; // in bytes/sec
  eta: number; // is seconds
  prevDone: number | null;
  chunkStart: number | null;

  constructor() {
    this.progress = 0;
    this.uploadSpeed = 0;
    this.eta = 0;
    this.prevDone = null;
    this.cancellable = new Cancellable();
    this.uploadProm = null;
    this.chunkStart = null;
  }

  start() {
    this.chunkStart = UploadInProgress.timeNow();
    this.prevDone = null;
  }

  setProgress(done: number, total: number) {
    this.progress = Math.round((done/total)*10000)/100;
    if (this.chunkStart === null || this.prevDone === null) {
      this.chunkStart = UploadInProgress.timeNow();
      this.prevDone = done;
      return;
    }

    const now = UploadInProgress.timeNow();
    const timeDiff = now-this.chunkStart;
    // Only update the upload speed if we have more than 500ms "worth" of data
    if (timeDiff >= 500) {
      this.uploadSpeed = (done-this.prevDone)/(timeDiff/1000);
      this.eta = (total-done)/this.uploadSpeed;
      this.chunkStart = UploadInProgress.timeNow();
      this.prevDone = done;
    }
  }

  async cancel() {
    this.cancellable.cancel();
    try {
      await this.uploadProm;
    }
    catch (e) {
      if ((e instanceof UploadCanceled) === false) {
        throw e;
      }
    }
  }

  private static timeNow() {
    try {
      return performance.now();
    }
    catch (e) {
      return new Date().getTime();
    }
  }
}

enum JSONUploadStateKind {
  RESUMABLE,
  RESUMING,
  COMPLETE
}

interface JSONUploadStateResuming {
  info: JSONUploadInfo;
  curProgress: number;
  kind: JSONUploadStateKind;
}
interface JSONUploadStateResumable {
  info: JSONUploadInfo;
  curProgress: number;
  kind: JSONUploadStateKind;
}
interface JSONUploadStateComplete {
  info: JSONUploadInfo;
  kind: JSONUploadStateKind;
}
type JSONUploadState = JSONUploadStateResumable | JSONUploadStateComplete;

export abstract class UploadState {
  readonly info: UploadInfo;
  readonly fileList: FileList | null;

  constructor(info: UploadInfo, fileList: FileList) {
    this.info = info;
    this.fileList = duplicateFileList(fileList);
  }

  url() {
    return this.info.url;
  }

  id() {
    return this.url().id;
  }

  abstract progressPercent(): number;
  abstract toJsonable(): JSONUploadState | null;

  static fromJsonable(data: JSONUploadState): UploadState {
    const info = UploadInfo.fromJsonable(data.info);
    switch (data.kind) {
    case JSONUploadStateKind.RESUMABLE: {
      return new UploadStateResumable(info, (data as JSONUploadStateResumable).curProgress, null);
    }
    case JSONUploadStateKind.RESUMING: {
      return new UploadStateResuming(info, (data as JSONUploadStateResuming).curProgress, null);
    }
    case JSONUploadStateKind.COMPLETE: {
      return new UploadStateComplete(info, null);
    }
    }
    throw new Error("unsupported upload state");
  }
}

export class UploadStateInProgress extends UploadState {
  progress: UploadInProgress;
  ctx: UploadCtx;

  constructor(ctx: UploadCtx, info: UploadInfo, fileList: FileList | null) {
    super(info, fileList);
    this.ctx = ctx;
    this.progress = new UploadInProgress();
  }

  progressPercent() {
    return this.progress.progress;
  }

  uploadSpeed() {
    return this.progress.uploadSpeed;
  }

  eta() {
    return this.progress.eta;
  }

  cancellable() { return this.progress.cancellable; }

  async run(cbProgress: (this_: UploadStateInProgress) => void) {
    this.progress.start();
    const prom = this.ctx.run(
      (done: number, total: number) => {
        this.progress.setProgress(done, total);
        cbProgress(this);
      },
      this.cancellable());
    this.progress.uploadProm = prom;
    return prom;
  }

  async cancel(): Promise<UploadStateResumable> {
    await this.progress.cancel();
    return new UploadStateResumable(this.info, this.progress.progress, this.fileList);
  }

  error(): UploadStateResumable {
    return new UploadStateResumable(this.info, this.progress.progress, this.fileList);
  }

  finished(): UploadStateComplete {
    return new UploadStateComplete(this.info, this.fileList);
  }

  toJsonable(): null {
    return null;
  }
}

export class UploadStateResuming extends UploadState {
  readonly curProgress: number;
  valid: boolean;

  constructor(info: UploadInfo, curProgress: number, fileList: FileList | null) {
    super(info, fileList);
    this.curProgress = curProgress;
    this.valid = true;
  }

  resumed(ctx: UploadCtx): UploadStateInProgress {
    return new UploadStateInProgress(ctx, this.info, this.fileList);
  }

  retry(): UploadStateResumable {
    this.valid = false;
    return new UploadStateResumable(this.info, this.curProgress, this.fileList);
  }

  invalid(): boolean {
    return this.valid === false;
  }

  progressPercent() {
    return this.curProgress;
  }

  toJsonable(): JSONUploadStateResuming {
    return {info: this.info.jsonable(), curProgress: this.curProgress, kind: JSONUploadStateKind.RESUMING};
  }
}

export class UploadStateResumable extends UploadState {
  readonly curProgress: number;

  constructor(info: UploadInfo, curProgress: number, fileList: FileList | null) {
    super(info, fileList);
    this.curProgress = curProgress;
  }

  resuming(): UploadStateResuming {
    return new UploadStateResuming(this.info, this.curProgress, this.fileList);
  }

  progressPercent() {
    return this.curProgress;
  }

  toJsonable(): JSONUploadStateResumable {
    return {info: this.info.jsonable(), curProgress: this.curProgress, kind: JSONUploadStateKind.RESUMABLE};
  }
}

export class UploadStateComplete extends UploadState {
  progressPercent() { return 100; }

  toJsonable(): JSONUploadStateComplete {
    return {info: this.info.jsonable(), kind: JSONUploadStateKind.COMPLETE};
  }
}

export class AppState {
  states: Map<string, UploadState>;
  curState: UploadState | null;
  channel: BroadcastChannel;
  onStateUpdate: () => void;

  constructor() {
    this.states = new Map();
    this.channel = new BroadcastChannel("uploadStates");
    this.channel.onmessage = (m) => { this.onUploadStateUpdated(m); };
    this.curState = null;
    this.onStateUpdate = () => {};

    this.initFromLocalStorage();
  }

  private initFromLocalStorage() {
    const storage = window.localStorage;
    const nfiles = storage.length;
    const all = [];
    for (let i = 0; i < nfiles; i += 1) {
      const id = storage.key(i);
      const {state, ts} = JSON.parse(storage.getItem(id));
      try {
        all.push({id, state: UploadState.fromJsonable(state), ts});
      }
      catch (e) {
        // Ignore invalid storage
      }
    }
    all.sort((a: any, b: any) => {
      if (a.ts < b.ts) return -1;
      if (a.ts > b.ts) return 1;
      return 0;
    });
    for (const {id, state} of all) {
      this.states.set(id, state);
    }
  }

  allStates() {
    return this.states.values();
  }

  selectState(state: UploadState) {
    this.curState = state;
  }

  selectNewState(state: UploadState) {
    this.states.set(state.id().str(), state);
    this.selectState(state);
    this.broadcastUploadState(state);
  }

  currentUploadState() { return this.curState; }

  setStateNewUpload() {
    this.curState = null;
  }

  updateUploadState(oldState: UploadState | null, newState: UploadState) {
    // TODO: verify the transition is legit
    const id = newState.id();
    this.states.set(id.str(), newState);
    this.broadcastUploadState(newState);
    if (oldState === this.curState) {
      this.curState = newState;
    }
    return newState;
  }

  updateCurState(state: UploadState) {
    return this.updateUploadState(this.curState, state);
  }

  broadcastUploadState(state: UploadState) {
    if (state instanceof UploadStateInProgress) {
      state = new UploadStateResumable(state.info, state.progressPercent(), null);
    }
    const stateJson = state.toJsonable();
    if (stateJson === null) {
      throw new Error("unable to serialize state");
    }
    const id = state.id().str();
    window.localStorage.setItem(id, JSON.stringify({state: stateJson, ts: new Date().getTime()}, jsonReplaceArrayBuffer));
    this.channel.postMessage({id, state: stateJson});
  }

  getStateByID(id: BaseID) {
    return this.states.get(id.str()) || null;
  }

  deleteState(state: UploadState) {
    const id = state.id().str();
    this.states.delete(id);
    window.localStorage.removeItem(id);
    this.channel.postMessage({id, state: null});
  }

  private onUploadStateUpdated(m: any) {
    const id = m.data.id;
    if (m.data.state === null) {
      if (this.curState !== null && (this.curState.id().str() === id)) {
        this.setStateNewUpload();
      }
      this.states.delete(id);
    }
    else {
      const state = UploadState.fromJsonable(m.data.state);
      this.states.set(id, state);
    }
    this.onStateUpdate();
  }
}
