import { ApiError, authed } from "./api";

const LOGO = "billflow-logo";
const AVATAR = "billflow-avatar";

export const MAX_IMAGE_BYTES = 2_000_000;

export function readLogo() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LOGO);
}

export function readAvatar() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AVATAR);
}

export function storeLogo(dataUrl: string) {
  localStorage.setItem(LOGO, dataUrl);
}

export function storeAvatar(dataUrl: string) {
  localStorage.setItem(AVATAR, dataUrl);
}

export function compressImage(file: File, maxEdge: number) {
  return new Promise<string>((resolve, reject) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      reject(new Error("Use a JPEG, PNG, or WebP image."));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error("That image is over 2 MB."));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not prepare the image."));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    image.src = url;
  });
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, data] = dataUrl.split(",");
  const type = /data:(.*?);/.exec(meta)?.[1] || "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

interface PresignResponse {
  provider?: string;
  url: string;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  public_url?: string;
  key?: string;
}

/** A presign is either a signed PUT or a multipart POST. */
async function sendPresigned(signed: PresignResponse, blob: Blob) {
  if (signed.fields) {
    const form = new FormData();
    for (const [name, value] of Object.entries(signed.fields)) form.append(name, value);
    form.append("file", blob, "upload.jpg");
    return fetch(signed.url, { method: "POST", body: form });
  }
  return fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
}

/** Uploads when storage is configured. Otherwise keeps the preview on this device. */
export async function publishImage(kind: "logo" | "avatar" | "product" | "site", dataUrl: string): Promise<{ url: string; remote: boolean; message?: string }> {
  const blob = dataUrlToBlob(dataUrl);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("Keep the image under 2 MB.");
  if (kind === "logo") storeLogo(dataUrl);
  else if (kind === "avatar") storeAvatar(dataUrl);
  const local = { url: dataUrl, remote: false, message: "Storage is not set up yet. The preview stays on this device." };
  try {
    const signed = await authed<PresignResponse>("/uploads/presign", {
      method: "POST",
      body: JSON.stringify({ kind, content_type: blob.type || "image/jpeg", size: blob.size }),
    });
    const uploaded = await sendPresigned(signed, blob);
    if (!uploaded.ok) throw new Error("The storage service did not accept the image.");
    const publicUrl = signed.public_url;
    if (!publicUrl) return local;
    if (kind === "logo") {
      await authed("/tenants/current", { method: "PATCH", body: JSON.stringify({ logo_url: publicUrl }) });
      storeLogo(publicUrl);
    } else if (kind === "avatar") {
      await authed("/auth/me", { method: "PATCH", body: JSON.stringify({ avatar_url: publicUrl }) });
      storeAvatar(publicUrl);
    }
    return { url: publicUrl, remote: true };
  } catch (error) {
    if (error instanceof ApiError && (error.code === "STORAGE_NOT_CONFIGURED" || error.status === 503)) return local;
    throw error;
  }
}
