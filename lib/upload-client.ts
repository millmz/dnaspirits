/**
 * Browser-side chunked uploader (used by the composer and the carousel
 * "add media" control). Slices a file into 6MB pieces and sends them
 * sequentially with real progress; each piece is a small request that
 * survives proxies/CDNs and comes back with readable JSON on failure.
 */

const CHUNK = 6 * 1024 * 1024;

const uploadId = () =>
  `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function sendChunk(url: string, blob: Blob, onProgress: (sent: number) => void) {
  return new Promise<{ ok: boolean; error?: string; done?: boolean }>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("x-denada", "1");
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onerror = () => resolve({ ok: false, error: "Network error — check your connection and retry." });
    xhr.ontimeout = () => resolve({ ok: false, error: "Upload timed out — retry." });
    xhr.timeout = 120_000;
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 400 || !json.ok) {
          resolve({ ok: false, error: json.error || `Upload failed (${xhr.status}).` });
        } else {
          resolve({ ok: true, done: json.done });
        }
      } catch {
        // non-JSON body: something between the browser and the app intercepted the request
        resolve({ ok: false, error: `The network blocked this upload (status ${xhr.status}).` });
      }
    };
    xhr.send(blob);
  });
}

export async function uploadFileToPost(
  postId: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = uploadId();
  const base =
    `/api/posts/${encodeURIComponent(postId)}/media` +
    `?uploadId=${id}&filename=${encodeURIComponent(file.name)}` +
    `&mime=${encodeURIComponent(file.type)}&total=${file.size}`;

  let sent = 0;
  while (sent < file.size) {
    const blob = file.slice(sent, sent + CHUNK);
    const from = sent;
    const r = await sendChunk(`${base}&offset=${sent}`, blob, (loaded) =>
      onProgress(Math.min((from + loaded) / file.size, 0.99))
    );
    if (!r.ok) return { ok: false, error: r.error ?? "Upload failed." };
    sent += blob.size;
    if (r.done) break;
  }
  onProgress(1);
  return { ok: true };
}

export async function postJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-denada": "1" },
      body: JSON.stringify(body),
    });
    try {
      return await res.json();
    } catch {
      return { ok: false, error: `The network blocked this request (status ${res.status}).` };
    }
  } catch {
    return { ok: false, error: "Network error — check your connection and retry." };
  }
}
