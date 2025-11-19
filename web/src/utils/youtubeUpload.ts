export type UploadMetadata = {
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string; // default 22: People & Blogs
  privacyStatus?: "public" | "unlisted" | "private";
};

async function startResumableSession(
  accessToken: string,
  metadata: UploadMetadata
): Promise<string> {
  const body = {
    snippet: {
      title: metadata.title,
      description: metadata.description ?? "",
      tags: metadata.tags ?? [],
      categoryId: metadata.categoryId ?? "22",
    },
    status: {
      privacyStatus: metadata.privacyStatus ?? "unlisted",
    },
  };

  const res = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/webm",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start upload: ${res.status} ${text}`);
  }

  const location = res.headers.get("location");
  if (!location) throw new Error("No resumable upload location received");
  return location;
}

export async function uploadToYouTube(
  accessToken: string,
  video: Blob,
  metadata: UploadMetadata
): Promise<{ videoId: string }>
{
  const sessionUrl = await startResumableSession(accessToken, metadata);

  const res = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/webm",
      "Content-Length": String(video.size),
    },
    body: video,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  return { videoId: json.id };
}
