export type OverlaySpec = {
  hookText: string;
  subText?: string;
  hookDurationSec?: number; // default 3
};

export type ClipPlan = {
  startSec: number;
  durationSec: number;
  overlay: OverlaySpec;
  title: string;
  description: string;
};

export type RenderedClip = {
  blob: Blob;
  startSec: number;
  durationSec: number;
  title: string;
  description: string;
};

function drawFittedVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvasWidth: number,
  canvasHeight: number
) {
  const videoAspect = video.videoWidth / video.videoHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let sx = 0;
  let sy = 0;
  let sWidth = video.videoWidth;
  let sHeight = video.videoHeight;

  // Cover strategy: fill canvas, cropping if necessary
  if (videoAspect > canvasAspect) {
    // Video is wider than canvas; crop left/right
    const expectedWidth = video.videoHeight * canvasAspect;
    sx = (video.videoWidth - expectedWidth) / 2;
    sWidth = expectedWidth;
  } else if (videoAspect < canvasAspect) {
    // Video is taller; crop top/bottom
    const expectedHeight = video.videoWidth / canvasAspect;
    sy = (video.videoHeight - expectedHeight) / 2;
    sHeight = expectedHeight;
  }

  ctx.drawImage(
    video,
    sx,
    sy,
    sWidth,
    sHeight,
    0,
    0,
    canvasWidth,
    canvasHeight
  );
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  _canvasHeight: number,
  hookText: string,
  subText: string | undefined,
  opacity: number
) {
  const padding = 24;
  const maxWidth = canvasWidth - padding * 2;

  // Semi-transparent black background rectangle at top
  const boxHeight = subText ? 220 : 160;
  ctx.save();
  ctx.globalAlpha = 0.6 * opacity;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasWidth, boxHeight);
  ctx.restore();

  // Hook text
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 54px Inter, system-ui, -apple-system, Segoe UI, Roboto";
  wrapText(ctx, hookText.toUpperCase(), padding, 68, maxWidth, 62);

  if (subText) {
    ctx.font = "500 36px Inter, system-ui, -apple-system, Segoe UI, Roboto";
    wrapText(ctx, subText, padding, 140, maxWidth, 46);
  }
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(/\s+/);
  let line = "";
  let yy = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line ? `${line} ${words[n]}` : words[n];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, yy);
      line = words[n];
      yy += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

export async function renderClip(
  file: File,
  plan: ClipPlan,
  options?: { width?: number; height?: number; fps?: number }
): Promise<RenderedClip> {
  const width = options?.width ?? 1080;
  const height = options?.height ?? 1920;
  const fps = options?.fps ?? 30;

  // Create media elements
  const video = document.createElement("video");
  video.src = URL.createObjectURL(file);
  video.crossOrigin = "anonymous";
  video.muted = true; // ensure autoplay in some browsers
  await video.play().catch(() => void 0);
  await new Promise<void>((resolve) => {
    if (video.readyState >= 1) resolve();
    else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9,opus",
    videoBitsPerSecond: 6_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const { startSec, durationSec, overlay } = plan;
  const hookDuration = overlay.hookDurationSec ?? 3;

  // Seek to start
  await new Promise<void>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.currentTime = Math.min(Math.max(0, startSec), video.duration - 0.1);
    video.addEventListener("seeked", onSeeked);
  });

  let animationFrameId = 0;
  let startedAt = 0;

  const drawFrame = (now: number) => {
    if (!startedAt) startedAt = now;
    const elapsed = (now - startedAt) / 1000;

    drawFittedVideo(ctx, video, width, height);

    if (elapsed <= hookDuration) {
      const opacity = Math.min(1, elapsed / 0.3) * Math.min(1, (hookDuration - elapsed) / 0.5);
      drawOverlay(ctx, width, height, overlay.hookText, overlay.subText, opacity);
    }

    if (elapsed < durationSec) {
      animationFrameId = requestAnimationFrame(drawFrame);
    }
  };

  const playbackPromise = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(100);
  video.play();
  animationFrameId = requestAnimationFrame(drawFrame);

  await new Promise((r) => setTimeout(r, durationSec * 1000));

  cancelAnimationFrame(animationFrameId);
  recorder.stop();
  video.pause();

  await playbackPromise;

  const blob = new Blob(chunks, { type: "video/webm" });

  return {
    blob,
    startSec: startSec,
    durationSec: durationSec,
    title: plan.title,
    description: plan.description,
  };
}

export async function generateEvenlySpacedPlans(
  file: File,
  clipLengthSec: number,
  totalClips: number,
  hookGenerator: (index: number) => OverlaySpec,
  titleGenerator: (index: number) => string,
  descriptionGenerator: (index: number) => string
): Promise<ClipPlan[]> {
  const videoUrl = URL.createObjectURL(file);
  const probe = document.createElement("video");
  probe.src = videoUrl;
  await new Promise<void>((resolve) => {
    if (probe.readyState >= 1) resolve();
    else probe.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });
  const duration = probe.duration;
  URL.revokeObjectURL(videoUrl);

  const totalDurationNeeded = clipLengthSec * totalClips;
  const gap = Math.max(0, (duration - totalDurationNeeded) / (totalClips + 1));

  const plans: ClipPlan[] = [];
  let cursor = gap;
  for (let i = 0; i < totalClips; i++) {
    const start = Math.min(cursor, Math.max(0, duration - clipLengthSec));
    plans.push({
      startSec: start,
      durationSec: Math.min(clipLengthSec, duration - start),
      overlay: hookGenerator(i),
      title: titleGenerator(i),
      description: descriptionGenerator(i),
    });
    cursor = start + clipLengthSec + gap;
  }
  return plans;
}
