// nostr.build image hosting — plain multipart upload, no auth required
// for basic use. Returns a direct image URL to store as an "image" tag
// on a NIP-99 listing.
export async function uploadToNostrBuild(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("https://nostr.build/api/v2/upload/files", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}).`);
  }

  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) {
    throw new Error("Upload succeeded but no URL was returned — try again.");
  }
  return url;
}
