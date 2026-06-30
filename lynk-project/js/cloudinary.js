// ============================================================
// LYNK By Legends — Cloudinary Upload Helper
// Uses unsigned uploads with XHR for progress tracking.
// ============================================================

const CLOUD_NAME = 'dc5biubfq';
const UPLOAD_PRESET = 'lynk_uploads';

export function optimizeCloudinaryUrl(url, { width, height, crop = 'fill' } = {}) {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  const transforms = ['f_auto', 'q_auto'];
  if (width)  transforms.push(`w_${width}`);
  if (height) transforms.push(`h_${height}`);
  if (width || height) transforms.push(`c_${crop}`);
  return url.replace('/upload/', `/upload/${transforms.join(',')}/`);
}

/**
 * Upload a file to Cloudinary with optional progress callback.
 * @param {File}      file       - The file to upload
 * @param {string}    folder     - Cloudinary folder (e.g. 'lynk/posts')
 * @param {Function}  onProgress - Called with 0–100 as upload progresses
 * @returns {Promise<string>}    Secure URL
 */
export function uploadToCloudinary(file, folder = 'lynk', onProgress = null) {
  return new Promise((resolve, reject) => {
    const resourceType = file.type.startsWith('video') ? 'video' : 'image';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    formData.append('folder', folder);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data.secure_url);
        } catch (e) {
          reject(new Error('Invalid Cloudinary response'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error?.message || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.timeout = 120000; // 2-minute timeout for large videos

    xhr.send(formData);
  });
}
