import {uploadState, uploadView} from './upload';
import {Client, ServerConfig} from '../core/client';

import "./bootstrap.min.css";
import "./styles.css";

const choo = require('choo');

const app = choo();

function initState(state: any) {
  state.crypto = window.crypto;
  state.client = new Client("/");
  state.timeoutValids = null;
  state.filesize_limit = 0;
  state.configProm = state.client.config().then((cfg: ServerConfig) => {
    const timeoutValids = cfg.timeout_s_valid.sort((a,b)=>a-b);
    // Infinity is the longest. Put it at the end.
    if (timeoutValids.length > 1 && timeoutValids[0] === 0) {
      timeoutValids.shift();
      timeoutValids.push(0);
    }
    state.timeoutValids = timeoutValids;
    state.lastSelectedTimeout = timeoutValids[timeoutValids.length-1];

    state.filesizeLimit = cfg.filesize_limit;
  });
}
app.use(initState);

app.use(uploadState);
app.route('/', uploadView);

const mountProm = app.mount('body');

// Test if serviceWorker is available, the feature may not be available in private mode in FF
// see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/serviceWorker
if (navigator.serviceWorker == null) {
  console.log('[**] No serviceWorker available, maybe due to FF in private mode ?');
} else {
 // Register service worker
 navigator.serviceWorker.register('./sw.js', {'scope': '/v1/download/'});
}

export default async () => {
  await mountProm;
};
