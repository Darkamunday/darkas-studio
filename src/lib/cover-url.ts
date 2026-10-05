// Shared by server and client. Cover responses are cached for a year, so the URL carries the
// file name: changing a cover changes the file, which changes the URL.
export function coverVersion(imagePath: string | null | undefined): string {
  const file = imagePath?.split("/").pop();
  return file ? `?v=${encodeURIComponent(file)}` : "";
}
