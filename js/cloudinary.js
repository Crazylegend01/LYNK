// ============================================================
// LYNK By Legends — Cloudinary Upload & Optimization Helper
// Safe for browser use: uses unsigned uploads (no API secret).
// Requires an unsigned upload preset in your Cloudinary
// dashboard → Settings → Upload → Upload presets.
// ============================================================

const CLOUD_NAME = 'dc5biubfq';
const UPLOAD_PRESET = 'lynk_uploads';

/**
 * Transform a Cloudinary URL with auto-format, auto-quality, and optional resize.
 * Safe to call with non-Cloudinary URLs — returns them unchanged.
 */
export function optimizeCloudinaryUrl(url, { width, height, crop = 'fill' } = {}) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  const transforms = ['f_auto', 'q_auto'];
  if (width)  transforms.push(`w_${width}`);
  if (height) transforms.push(`h_${height}`);
  if (width || height) transforms.push(`c_${crop}`);
  return url.replace('/upload/', `/upload/${transforms.join(',')}/`);
}

/**
 * Upload a file to Cloudinary and return the secure URL.
 * @param {File}   file   - The file to upload (image or video)
 * @param {string} folder - Cloudinary folder path (e.g. 'lynk/posts')
 * @returns {Promise<string>} The secure HTTPS URL of the uploaded file
 */
export async function uploadToCloudinary(file, folder = 'lynk') {
  const resourceType = file.type.startsWith('video') ? 'video' : 'image';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', folder);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
    { method: 'POST', body: formData }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Cloudinary upload failed (${res.status})`);
  }

  const data = await res.json();
  return data.secure_url;
}
