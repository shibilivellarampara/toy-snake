import QRCode from "qrcode";
import jsQR from "jsqr";

export async function renderQR(canvas: HTMLCanvasElement, payload: string) {
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: "L",
    margin: 1,
    width: 320,
    color: { dark: "#0f1a13", light: "#ffffff" },
  });
}

export interface QRScanner {
  stop: () => void;
}

export function startQRScan(
  video: HTMLVideoElement,
  onResult: (text: string) => void,
  onError?: (err: unknown) => void,
): QRScanner {
  let stopped = false;
  let stream: MediaStream | null = null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;

  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "environment" } })
    .then((s) => {
      if (stopped) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      video.srcObject = s;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      video.play().catch(() => {});
      requestAnimationFrame(tick);
    })
    .catch((err) => onError?.(err));

  function tick() {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        onResult(code.data);
        return;
      }
    }
    requestAnimationFrame(tick);
  }

  return {
    stop: () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    },
  };
}
