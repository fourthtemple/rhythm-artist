// Browser I/O primitives for saving and loading the rhythm config. These are
// the side-effecting boundary (blob download, save POST, fetch GET) with no
// dependency on editor state, so the editor can wrap them with its own
// normalization and re-render logic.

/** Trigger a client-side download of `content` as a JSON file. */
export function downloadJsonFile(content, fileName = "kamorebi-rhythm-sequence.json") {
  const blob = new Blob([content], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * POST a game asset to the dev server's save endpoint. Resolves with the
 * parsed server result `{ ok, backupPath?, error? }`, or throws when the
 * request fails or the server reports an error.
 */
export async function saveGameAsset(fileName, content) {
  const response = await fetch("/api/save-game-asset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, content })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.error || "Save failed");
  }
  return result;
}

/** Fetch and parse a saved rhythm config JSON from `url`. Throws on non-200. */
export async function fetchSavedConfig(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
