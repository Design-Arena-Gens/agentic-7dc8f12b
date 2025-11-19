"use client";

import { useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import { ClipPlan, RenderedClip, generateEvenlySpacedPlans, renderClip } from "@/lib/canvasClipper";
import { requestYouTubeAccessToken } from "@/lib/googleAuth";
import { uploadToYouTube } from "@/lib/youtubeUpload";

function defaultHookGenerator(topic: string) {
  const hooks = [
    (i: number) => ({ hookText: `${topic}: The #${i + 1} tip you missed`, subText: "Watch till the end", hookDurationSec: 3 }),
    (_: number) => ({ hookText: `3-STEP ${topic.toUpperCase()}`, subText: "Clip highlights in 30s", hookDurationSec: 3 }),
    (_: number) => ({ hookText: `STOP DOING THIS IN ${topic.toUpperCase()}`, subText: "Try this instead", hookDurationSec: 3 }),
    (_: number) => ({ hookText: `SECRETS ABOUT ${topic.toUpperCase()}`, subText: "Nobody talks about #shorts", hookDurationSec: 3 }),
  ];
  return (index: number) => hooks[index % hooks.length](index);
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [topic, setTopic] = useState("Productivity");
  const [clipLengthSec, setClipLengthSec] = useState(30);
  const [numClips, setNumClips] = useState(3);
  const [plans, setPlans] = useState<ClipPlan[] | null>(null);
  const [clips, setClips] = useState<RenderedClip[]>([]);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [log, setLog] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);

  const planTitles = useMemo(
    () => (index: number) => `${topic} Tip #${index + 1} in ${clipLengthSec}s`,
    [topic, clipLengthSec]
  );
  const planDescriptions = useMemo(
    () => (index: number) => `Auto-clipped from long-form. Topic: ${topic}. Clip #${index + 1}. #shorts #${topic.replace(/\s+/g, "").toLowerCase()}`,
    [topic]
  );

  async function onGenerate() {
    if (!file) return;
    setProcessing(true);
    setLog("");
    try {
      const plans = await generateEvenlySpacedPlans(
        file,
        clipLengthSec,
        numClips,
        defaultHookGenerator(topic),
        planTitles,
        planDescriptions
      );
      setPlans(plans);

      const results: RenderedClip[] = [];
      for (let i = 0; i < plans.length; i++) {
        setLog((l) => l + `Rendering clip ${i + 1}/${plans.length}...\n`);
        const rendered = await renderClip(file, plans[i], { width: 1080, height: 1920, fps: 30 });
        results.push(rendered);
      }
      setClips(results);
      setLog((l) => l + `Done. ${results.length} clips ready.\n`);
    } catch (e: any) {
      console.error(e);
      setLog((l) => l + `Error: ${e?.message || String(e)}\n`);
    } finally {
      setProcessing(false);
    }
  }

  function onFileChange(f: File | null) {
    setFile(f);
    setClips([]);
    setPlans(null);
  }

  async function onUploadAll() {
    if (!clips.length) return;
    setUploading(true);
    setLog((l) => l + `Requesting YouTube access...\n`);
    try {
      const token = await requestYouTubeAccessToken();
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        setLog((l) => l + `Uploading ${i + 1}/${clips.length}: ${c.title}\n`);
        const { videoId } = await uploadToYouTube(token, c.blob, {
          title: c.title,
          description: c.description,
          tags: ["shorts", topic.replace(/\s+/g, "").toLowerCase()],
          privacyStatus: "unlisted",
        });
        setLog((l) => l + `Uploaded: https://youtu.be/${videoId}\n`);
      }
      setLog((l) => l + `All uploads completed.\n`);
    } catch (e: any) {
      console.error(e);
      setLog((l) => l + `Upload error: ${e?.message || String(e)}\n`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 style={{ fontSize: 28, marginBottom: 12 }}>Auto Shorts Generator</h1>
        <p style={{ opacity: 0.8, marginBottom: 24 }}>
          Upload a long-form video file, auto-generate vertical clips with hook overlays, then upload to YouTube.
        </p>

        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
          <label>
            Topic
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              style={{ marginLeft: 6 }}
            />
          </label>
          <label>
            Clip length (s)
            <input
              type="number"
              min={5}
              max={60}
              value={clipLengthSec}
              onChange={(e) => setClipLengthSec(Number(e.target.value))}
              style={{ marginLeft: 6, width: 80 }}
            />
          </label>
          <label>
            Clips
            <input
              type="number"
              min={1}
              max={10}
              value={numClips}
              onChange={(e) => setNumClips(Number(e.target.value))}
              style={{ marginLeft: 6, width: 80 }}
            />
          </label>
          <button disabled={!file || processing} onClick={onGenerate}>
            {processing ? "Generating..." : "Generate Clips"}
          </button>
          <button disabled={!clips.length || uploading} onClick={onUploadAll}>
            {uploading ? "Uploading..." : "Upload All to YouTube"}
          </button>
        </div>

        {file && (
          <video
            ref={videoRef}
            src={URL.createObjectURL(file)}
            controls
            style={{ width: 480, marginTop: 16 }}
          />
        )}

        {!!clips.length && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16, marginTop: 24, width: "100%" }}>
            {clips.map((clip, idx) => {
              const url = URL.createObjectURL(clip.blob);
              return (
                <div key={idx} style={{ border: "1px solid #333", padding: 12, borderRadius: 8 }}>
                  <video src={url} controls style={{ width: "100%", aspectRatio: "9/16", background: "#000" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    <input
                      type="text"
                      value={clip.title}
                      onChange={(e) => {
                        const v = e.target.value;
                        setClips((arr) => arr.map((c, i) => (i === idx ? { ...c, title: v } : c)));
                      }}
                      placeholder="Title"
                    />
                    <textarea
                      value={clip.description}
                      onChange={(e) => {
                        const v = e.target.value;
                        setClips((arr) => arr.map((c, i) => (i === idx ? { ...c, description: v } : c)));
                      }}
                      placeholder="Description"
                      rows={3}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <pre style={{ marginTop: 24, width: "100%", whiteSpace: "pre-wrap" }}>{log}</pre>
      </main>
    </div>
  );
}
