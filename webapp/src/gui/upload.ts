import {AppState, UploadStateInProgress, UploadStateResuming, UploadStateResumable, UploadStateComplete, UploadState, UploadInfo, duplicateFileList} from './appState';
import {UploadCtx, InvalidKey} from './uploadCtx';
import {UploadCanceled} from '../core/client';
import {genWebDownloadURL, DownloadURL} from '../core/url';
import {NamedZipArchive, FileOrArchive} from './types';
import {debounce, formatSize, formatDuration, formatTime} from './utils';

const html = require('choo/html');

export function uploadState(state: any) {
  const appState = new AppState();
  state.appState = appState;
}

function processFileList(files: FileList, filename: string): FileOrArchive {
  if (files.length === 0) {
    return null;
  }
  if (files.length === 1) {
    return files[0];
  }
  const ar = new NamedZipArchive();
  for (let i = 0; i < files.length; ++i) {
    const f = files.item(i);
    ar.add({name: f.name, blob: f, lastMod: new Date(f.lastModified)});
  }
  ar.name = filename;
  return ar;
}

function getCurrentTimeout() {
  const timeout = (window.document.querySelector("#timeout") as HTMLSelectElement).selectedOptions[0].value;
  return Number.parseInt(timeout);
}

let doneConfigProm = false;

export function uploadView(state: any, emit_: any) {
  const emit = (e: string) => { console.log('emit'); emit_(e); };
  const debouncedRender = debounce(async () => { emit('render'); }, 100);
  state.appState.onStateUpdate = debouncedRender;
  // This is very hacky, and their should be a better way to do this. The
  // original problem is that each rendering calls uploadView, that calls the
  // configProm promise, that emits a rendering, and this goes into an infinite
  // rendering loop...
  if (!doneConfigProm) {
    state.configProm.then(() => { emit('render'); });
    doneConfigProm = true;
  }

  return html`
    <body>
    <main>
    <div class="wrapper">
    <div id="sidebar">
      <h1>secsend</h1>

      <p align="center"><a onclick=${showNewUpload} class="clickable">New upload</a></p>

      <h2>In-progress uploads</h2>
      <table>
        ${uploadsKind((s: UploadState) => (s instanceof UploadStateInProgress)).map(inProgressUpload)}
      </table>
      <hr>

      <h2>Unfinished uploads</h2>
      <ul class="list-unstyled">
        ${uploadsKind((s: UploadState) => (s instanceof UploadStateResumable || s instanceof UploadStateResuming)).map(resumeUpload)}
      </ul>
      <hr>

      <h2>Recent uploads</h2>
      <table>
        ${uploadsKind((s: UploadState) => (s instanceof UploadStateComplete)).map(finishedUploadInfo)}
      </table>
    </div>
    <div id="content" class="d-inline-flex justify-content-md-center text-center">
    <div class="container w-75">
      <div class="row">
        <div class="col-sm">
        <form class="p-md-4 border rounded-3 bg-light" id="upload" onsubmit=${onsubmit}>
          <p style="margin-bottom: 1em">
          ${formTitle()}
          </p>
          <div class="form-group row">
            <label for="file_input" class="col-sm-2 col-form-label" style='display: ${currentUploadState() instanceof UploadStateComplete ? "none":"block"}'>File</label>
            <div class="col-sm-10" style='display: ${currentUploadState() instanceof UploadStateComplete ? "none":"block"}'>
              <input type="file" class="form-control-plaintext" id="file_input" multiple onchange=${() => {emit('render');}} ${shouldDisableFileSelection() ? "disabled":""}>
            </div>
            <label for="file_name" class="col-sm-2 col-form-label" style='display: ${showFilename() ? 'block':'none'}'>Filename</label>
            <div class="col-sm-10" style='display: ${showFilename() ? 'block':'none'}'>
              <div style="display:flex;">
                <input type="text" class="form-control" id="file_name" placeholder="archive">
                <div>.zip</div>
              </div>
            </div>
            <label for="timeout" class="col-sm-2 col-form-label" style='display: ${currentUploadState() === null ? "block":"none"}'>Time limit</label>
            <div class="col-sm-10" style='display: ${currentUploadState() === null ? "block":"none"}'>
              <select class="form-control-plaintext" id="timeout" onchange=${onTimeoutChange}>
                ${getTimeouts().map(timeoutOption)}
              </select>
            </div>
            <button type="submit" class="w-100 btn btn-lg ${disableBtn() ? "btn-danger":"btn-primary"}" ${disableBtn() ? "disabled":""}>${btnName()}</button>
          </div>
        </form>
        </div>
      </div>

      <div class="row">
        <div class="col-sm">
        <div class="progress position-relative" style='visibility: ${currentProgress() === null ? "hidden":"visible"}'>
          <div class="progress-bar" role="progressbar" aria-valuenow=${currentProgress()} aria-valuemin="0" aria-valuemax="100" style="width:${currentProgress()}%">
          <div class="justify-content-center d-flex position-absolute w-100" style="color: #000000">${currentProgressText()}</div>
          <div class="justify-content-end d-flex position-absolute w-100" style="color: #000000">${currentETA()}</div>
          </div>
        </div>
        <p style='visibility: ${currentUploadState() === null ? "hidden":"visible"}' align="center">
          <table class='table-links'>
            <tr><td align="right">Links:</td><td><a href=${downloadLink(false, true)}>download</a> | <a href=${downloadLink(true, true)}>preview</a></td></tr>
            <tr class="tr-padding-top"><td align="right">Passwordless links:</td><td><a href=${downloadLink(false, false)}>download</a> | <a href=${downloadLink(true, false)}>preview</a></td></tr>
            <tr><td align="right">Password:</td><td style="font-family: monospace">${curFileKey()}</td></tr>
          </table>
        </p>

        <p><button type="button" onclick=${ondelete} class="w-100 btn btn-primary" style='display: ${currentUploadState() === null ? "none":"block"}'>Delete</button></p>
      </div>
      </div>
    </div>
    </div>
    </div>
    </main>
    </body>
  `;

  function onTimeoutChange() {
    state.lastSelectedTimeout = getCurrentTimeout();
  }

  function getTimeouts() {
    const ret = state.timeoutValids;
    if (ret === null) {
      return [];
    }
    return ret;
  }

  function timeoutOption(seconds: number) {
    const seconds_human = formatDuration(seconds);
    let selected = "";
    if (seconds === state.lastSelectedTimeout) {
      selected = "selected";
    }
    return html`<option value="${seconds}" ${selected}>${seconds_human}</option>`;
  }

  function shouldDisableFileSelection() {
    const curState = currentUploadState();
    return (curState !== null) && (curState.fileList.length > 0);
  }

  function showFilename() {
    const curState = currentUploadState();
    if (curState !== null) {
      return false;
    }
    const input = window.document.querySelector("#file_input");
    if (input === null) {
      return false;
    }
    const files = (input as HTMLInputElement).files;
    return files.length > 1;
  }

  function formTitle() {
    const curState = currentUploadState();
    if (curState === null) {
      return html`<strong>New upload</strong>`;
    }
    return curState.info.name;
  }

  function showNewUpload() {
    const appState: AppState = state.appState;
    appState.setStateNewUpload();
    const form = window.document.querySelector("#upload") as HTMLFormElement;
    if (form !== null) {
      form.reset();
    }
    emit('render');
  }

  function uploadsKind(filter: (s: UploadState) => boolean) {
    const appState: AppState = state.appState;
    // TODO: remove that temporary array...
    return Array.from(appState.allStates()).filter(filter).reverse();
  }

  function currentProgress() {
    const curState = currentUploadState();
    if (curState === null) {
      return null;
    }
    return curState.progressPercent();
  }

  function currentProgressText() {
    const curState = currentUploadState();
    if (curState === null) {
      return "";
    }
    let text = curState.progressPercent().toString() + "%";
    if (curState instanceof UploadStateInProgress) {
      const bw = curState.uploadSpeed();
      text += " (" + formatSize(bw) + "/s)";
    }
    return text;
  }

  function currentETA() {
    const curState = currentUploadState();
    if (curState === null || !(curState instanceof UploadStateInProgress)) {
      return "";
    }
    return "ETA: " + formatTime(curState.eta());
  }

  function downloadLink(preview: boolean, withKey: boolean): string {
    const curState = currentUploadState();
    if (curState === null) {
      return "";
    }
    const url = curState.url().fileURL;
    if (url === null) {
      return "";
    }
    return genWebDownloadURL(window.location.origin, url, preview, withKey);
  }

  function curFileKey(): string {
    const curState = currentUploadState();
    if (curState === null) {
      return "";
    }
    const url = curState.url().fileURL;
    if (url === null) {
      return "";
    }
    return DownloadURL.keyToTxt(url.key);
  }

  function currentUploadState(): UploadState | null {
    const appState: AppState = state.appState;
    return appState.currentUploadState();
  }

  function inputSizeIfAboveLimit(): number | null {
    if (state.filesizeLimit === 0) {
      return null;
    }

    const input = window.document.querySelector("#file_input");
    if (input === null) {
      return null;
    }
    const files = (input as HTMLInputElement).files;
    const fl = processFileList(files, "");
    if (fl === null) {
      return null;
    }
    const inputSize = fl.size;
    return inputSize >= state.filesizeLimit ? inputSize:null;
  }

  function disableBtn() {
    const curState = currentUploadState();
    const inputSize = inputSizeIfAboveLimit();
    return (curState === null) && (inputSize !== null);
  }

  function btnName() {
    const curState = currentUploadState();
    if (curState === null) {
      const isal = inputSizeIfAboveLimit();
      if (isal !== null) {
        return "Size is " + formatSize(isal) + ", which exceeds current limit of " + formatSize(state.filesizeLimit);
      }
      return "Upload";
    }
    if (curState instanceof UploadStateInProgress) {
      return "Pause";
    }
    if (curState instanceof UploadStateResuming) {
      return "Resuming... (retry)";
    }
    if (curState instanceof UploadStateResumable) {
      return "Resume";
    }
    if (curState instanceof UploadStateComplete) {
      return "New upload";
    }
  }

  async function onsubmit(e: Event) {
    e.preventDefault();
    const appState: AppState = state.appState;
    let curState = appState.currentUploadState();

    if (curState instanceof UploadStateComplete) {
      showNewUpload();
      return;
    }

    if (curState instanceof UploadStateInProgress) {
      appState.updateUploadState(curState, await curState.cancel());
      emit('render');
      return;
    }

    if (curState instanceof UploadStateResuming) {
      curState = appState.updateUploadState(curState, curState.retry());
    }

    const form = e.currentTarget as HTMLElement;
    const files = (form.querySelector("#file_input") as HTMLInputElement).files;
    const filenameInput = form.querySelector("#file_name") as HTMLInputElement;
    const filename = ((filenameInput.value === "") ? filenameInput.placeholder : filenameInput.value) + ".zip";
    const input = processFileList(files, filename);
    if (input === null) {
      return;
    }
    processState(curState, input, files);
  }

  async function processState(curState: UploadState | null, input: FileOrArchive, files: FileList) {
    const appState: AppState = state.appState;
    if (curState === null) {
      const timeout = getCurrentTimeout();
      const ctx = await UploadCtx.uploadNew(state.crypto, state.client, input, timeout);
      const info = new UploadInfo(ctx.url, ctx.metadata.name, ctx.metadata.mimeType);
      curState = new UploadStateInProgress(ctx, info, files);
      appState.selectNewState(curState);
    }
    else {
      if (input.name !== curState.info.name) {
        if (!window.confirm("Warning: the file name you chose is different from the previously uploaded file name. Are you sure you want to continue?")) {
          return;
        }
      }
      let ctx: UploadCtx;
      try {
        const url = curState.url();
        curState = appState.updateUploadState(curState, (curState as UploadStateResumable).resuming());
        debouncedRender();
        ctx = await UploadCtx.uploadResume(state.crypto, state.client, input, url);
      }
      catch (e) {
        if (e instanceof InvalidKey) {
          alert("Invalid encryption key! It looks like your application state is invalid. Unfortunately, there is no way to recover the good key.");
          return;
        }
        appState.updateUploadState(curState, (curState as UploadStateInProgress).error());
        throw e;
      }
      if ((curState as UploadStateResuming).invalid()) {
        return;
      }
      curState = appState.updateUploadState(curState, (curState as UploadStateResuming).resumed(ctx));
    }
    await runUpload(curState as UploadStateInProgress, input, files);
    emit('render');
  }

  async function runUpload(upstate: UploadStateInProgress, input: FileOrArchive, files: FileList) {
    const appState: AppState = state.appState;
    const update = (upstate: UploadStateInProgress) => {
      appState.broadcastUploadState(upstate);
      debouncedRender();
    };

    try {
      const prom = upstate.run(update);
      debouncedRender();
      await prom;
      appState.updateUploadState(upstate, upstate.finished());
    }
    catch (e) {
      if ((e instanceof UploadCanceled) === false) {
        appState.updateUploadState(upstate, upstate.error());
        // Automatically retry in 1s
        const id = upstate.id();
        setTimeout(async () => {
          const curState = appState.getStateByID(id);
          if (!(curState instanceof UploadStateResumable)) {
            return;
          }
          processState(curState, input, files);
        }, 1000);
      }
    }
  }

  function selectState(upstate: UploadState) {
    const appState: AppState = state.appState;
    appState.selectState(upstate);
    emit('render');

    const input = window.document.querySelector("#file_input");
    if (input !== null) {
      (input as HTMLInputElement).files = duplicateFileList(upstate.fileList);
    }
  }

  function inProgressUpload(upstate: UploadState) {
    const info = upstate.info;
    return html`<tr onclick=${() => { selectState(upstate);}} class="clickable"><td class="ellipsis">${info.name}</td><td>${upstate.progressPercent()}%</td></tr>`;
  }

  function resumeUpload(upstate: UploadState) {
    const info = upstate.info;
    return html`<li><div class="ellipsis clickable" title=${info.name} onclick=${() => { selectState(upstate);}}>${info.name}</div></li>`;
  }

  function finishedUploadInfo(upstate: UploadState) {
    const info = upstate.info;
    const url = info.url.fileURL;
    if (url === null) {
      info.url.fileURLPromise.then(debouncedRender);
      return null;
    }
    const dl = genWebDownloadURL(window.location.origin, url, false);
    const preview = genWebDownloadURL(window.location.origin, url, true);
    return html`<tr><td class="ellipsis clickable" title=${info.name} onclick=${showFinishedUpload}>${info.name}</td><td><a href=${dl}>dl</a></td><td><a href=${preview}>view</a></td></tr>`;

    function showFinishedUpload() {
      const appState: AppState = state.appState;
      appState.selectState(upstate);
      emit('render');
    }
  }

  async function ondelete() {
    let curstate = currentUploadState();
    if (curstate === null) {
      return;
    }
    if (confirm("Are you sure you want to delete this file? This is a non revertible operation!") === false) {
      return;
    }
    const appState: AppState = state.appState;
    if (curstate instanceof UploadStateInProgress) {
      const newstate = await curstate.cancel();
      appState.updateUploadState(curstate, newstate);
      curstate = newstate;
    }
    try {
      await state.client.delete(curstate.id());
    }
    catch (e) {
      if (e.res.status !== 404) {
        throw e;
      }
    }
    appState.deleteState(curstate);
    showNewUpload();
  }
}
