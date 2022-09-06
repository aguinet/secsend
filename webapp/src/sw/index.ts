import {Client, ClientError} from '../core/client';
import {parseDownloadURL} from '../core/url';
import {StreamChunkerTransformer, ChunksTransformer, transformStream} from '../core/transformers';
import {AESGCMChunks, decryptFunc, verifyKey} from '../core/e2ee';
import {decryptMetadata} from '../core/metadata';
import {StreamRange} from '../core/range';

declare let self: ServiceWorkerGlobalScope;
export {};

const client = new Client("/");

function getRange(rangeTxt: string | null, chunkSize: number, encrChunkSize: number, orgSize: number): StreamRange | null
{
  if (rangeTxt === null) {
    return null;
  }
  const m = rangeTxt.match(/bytes=([0-9]+)-([0-9]+)?/);
  const outRangeStartTxt = m[1] || null;
  const outRangeEndTxt = m[2] || null;
  if (outRangeStartTxt === null && outRangeEndTxt === null) {
    return null;
  }
  const outRangeStart = parseInt(outRangeStartTxt, 10);
  if (outRangeStart === 0 && outRangeEndTxt === null) {
    return null;
  }

  let outLength: number;
  if (outRangeEndTxt !== null) {
    const outRangeEnd = parseInt(outRangeEndTxt, 10);
    outLength = outRangeEnd-outRangeStart+-1;
  }
  else {
    outLength = orgSize-outRangeStart;
  }

  return StreamRange.compute(encrChunkSize, chunkSize, outRangeStart, outLength);
}

self.addEventListener('fetch', async event => {
  if (!event.request.url.includes("/v1/download/")) {
    return;
  }

  event.respondWith(async function() {
    // Get key & ID
    const reqUrl = event.request.url;
    const {url, preview} = parseDownloadURL(reqUrl, self.crypto);
    await url.fileURLPromise;
    const {key, id} = url.fileURL;
    const newUrl = new URL(reqUrl);
    newUrl.pathname = "/v1/download/" + id.str();

    const metadataOrErr = await client.metadata(id).catch((e) => { return e; });
    if (metadataOrErr instanceof ClientError) {
      return new Response("Error: " + metadataOrErr.message, {status: metadataOrErr.err.status, statusText: metadataOrErr.err.description});
    }
    const {metadata: encrMetadata, size: encrSize} = metadataOrErr;

    if (encrMetadata.complete === false) {
      return new Response("Error: file is still being uploaded", {status: 400, statusText: "Invalid request"});
    }
    if (encrMetadata.algo !== AESGCMChunks.PROTO_NAME) {
      return new Response("Error: unsupported encryption algorithm", {status: 400, statusText: "Invalid request"});
    }
    if ((await verifyKey(self.crypto, encrMetadata.keySign, key, encrMetadata.iv)) === false) {
      return new Response("Invalid password", {status: 403, statusText: "Forbidden access"});
    }

    const cipher = await AESGCMChunks.import(self.crypto, encrMetadata.iv, key);
    const metadata = await decryptMetadata(encrMetadata, cipher);
    const orgSize = AESGCMChunks.decryptedSize(encrSize, metadata.chunkSize);
    const encrChunkSize = AESGCMChunks.outChunkSize(metadata.chunkSize);

    // Handle Range
    const rangeTxt = event.request.headers.get("Range");
    const range = getRange(rangeTxt, metadata.chunkSize, encrChunkSize, orgSize);

    const myreq = new Request(newUrl.toString(), {headers: event.request.headers});
    const myheaders: any = {};
    let inChunkBegin = 0;
    if (range !== null) {
      inChunkBegin = range.inChunkBegin;
      let t = 'bytes='+range.inStreamSeekBytes+"-";
      const rangeEnd = range.inStreamRangeEnd();
      if (rangeEnd !== null) {
        t += rangeEnd;
      }
      myheaders['Range'] = t;
    }
    const req = await fetch(myreq.url, {headers: myheaders});
    const reqStream = await req.body;

    const transDecr = new ChunksTransformer(decryptFunc(cipher), inChunkBegin);

    let stream = transformStream(reqStream, new StreamChunkerTransformer(encrChunkSize));
    stream = transformStream(stream, transDecr);
    if (range) {
      stream = transformStream(stream, range.outTruncator());
    }

    const resHeaders = new Headers(await req.headers);
    resHeaders.delete('Content-Range');
    resHeaders.delete('Content-Length');
    resHeaders.delete('Content-Disposition');
    resHeaders.delete('Content-Type');

    let disposition = preview ? "inline":"attachment";
    disposition += "; filename=" + metadata.name;
    resHeaders.append('Content-Disposition', disposition);
    let mimeType = metadata.mimeType;
    if (mimeType === "text/html") {
      // Do not render untrusted HTML pages (even if javascript is disabled)
      mimeType = "text/plain";
    }
    resHeaders.append('Content-Type', mimeType);

    if (rangeTxt === null) {
      resHeaders.append('Content-Length', orgSize.toString());
    }
    else {
      let resRangeTxt;
      let outStreamLength;
      if (range === null) {
        resRangeTxt = "bytes 0-"+(orgSize-1)+"/"+orgSize;
        outStreamLength = orgSize;
        resHeaders.append('Accept-Ranges', 'bytes');
      }
      else {
        const rend = range.outStreamLength+range.outStreamBegin-1;
        resRangeTxt = "bytes "+range.outStreamBegin+"-"+rend+"/"+orgSize;
        outStreamLength = range.outStreamLength;
      }
      resHeaders.append('Content-Range', resRangeTxt);
      resHeaders.append('Content-Length', outStreamLength.toString());
    }
    // Add a CSP that prevents any script to be executed (in case HTML is shipped)
    resHeaders.delete('Content-Security-Policy');
    resHeaders.append('Content-Security-Policy', "script-src 'none'");

    return new Response(stream, {status: req.status, statusText: req.statusText, headers: resHeaders});
  }());
});
