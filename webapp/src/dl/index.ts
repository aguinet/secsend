// Install the service worker (in case it hasn't been done), and redirect to
// the download URL. Also ask for the key if not provided directly in the URL.
// We voluntary keep this file really small, with no dependencies, in order to
// save bandwidth on each download.

import "./styles.css";

function redirect(rootUrl: string, id: string, preview: string, key: string, saveHistory: boolean) {
  const url = rootUrl + "v1/download/" + id + "?v=" + preview + "#" + key;
  if (saveHistory) {
    window.location.assign(url);
  }
  else {
    window.location.replace(url);
  }
}

function cleanupKey(key: string) {
  let ret = key.trim();
  if ((ret.length > 0) && (ret[0] === "#")) {
    ret = ret.substring(1);
  }
  return ret;
}

async function run() {
  const loc = window.location;
  const rootUrl = loc.origin + loc.pathname.replace("/dl","/");
  try {
    await navigator.serviceWorker.register('./sw.js', {'scope': '/v1/download/'});
  }
  catch (e) {
    loc.replace(rootUrl);
    return;
  }

  const query = (new URL(loc.href)).searchParams;
  const id = query.get('id') || null;
  if (id === null) {
    loc.replace(rootUrl);
    return;
  }
  const preview = query.get('v') || "0";
  const key = cleanupKey(window.location.hash);
  if (key.length > 0) {
    redirect(rootUrl, id, preview, key, false);
  }
  else {
    const key_form = document.forms.namedItem("key_form") as HTMLFormElement;
    const key_value = key_form.elements.namedItem("key_value") as HTMLInputElement;
    key_form.onsubmit = (event: SubmitEvent) => {
      event.preventDefault();
      let key = key_value.value;
      key = cleanupKey(key);
      if (key.length > 0) {
        redirect(rootUrl, id, preview, key, true);
      }
    };

    document.getElementById("toggle_password").onclick = (event: Event) => {
      const elt = event.currentTarget as HTMLImageElement;
      if (key_value.type === "password") {
        key_value.type = "text";
        elt.classList.replace("fa-eye", "fa-eye-slash");
      }
      else {
        key_value.type = "password";
        elt.classList.replace("fa-eye-slash", "fa-eye");
      }
    };

    if (parseInt(preview) === 1) {
      (key_form.elements.namedItem("btn") as HTMLButtonElement).textContent = "Preview";
    }

    key_form.style.display = "";
  }
}
document.addEventListener('DOMContentLoaded', async () => {
  run();
});
