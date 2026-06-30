// AiG — File Helpers
// Format detection + validation for uploaded GPR files, plus small async file readers
// used by gprParser.js and Upload.jsx.

// Extension → human-readable format label (matches docs/GPR_FORMATS.md)
export const SUPPORTED_FORMATS = {
  dzt: { label: 'GSSI', manufacturer: 'GSSI' },
  dt2: { label: 'Mala (.dt2)', manufacturer: 'Mala' },
  rd3: { label: 'Mala (.rd3)', manufacturer: 'Mala' },
  sgy: { label: 'SEG-Y', manufacturer: 'Standard' },
  segy: { label: 'SEG-Y', manufacturer: 'Standard' },
  csv: { label: 'CSV', manufacturer: 'Any export' },
};

const MAX_FILE_SIZE_MB = 200;

/**
 * Pull the lowercase extension off a filename, no dot.
 * "Survey_01.DZT" -> "dzt"
 */
export function getExtension(filename = '') {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Map a filename to one of the supported GPR formats, or null if unrecognised.
 */
export function detectFormat(filename) {
  const ext = getExtension(filename);
  return SUPPORTED_FORMATS[ext] ? ext : null;
}

export function isSupportedFormat(filename) {
  return detectFormat(filename) !== null;
}

/**
 * Validate a File object before it gets handed to gprParser.js.
 * Returns { valid, format, error }.
 */
export function validateFile(file) {
  if (!file) {
    return { valid: false, format: null, error: 'No file selected.' };
  }

  const format = detectFormat(file.name);
  if (!format) {
    const accepted = Object.keys(SUPPORTED_FORMATS).map((e) => `.${e}`).join(', ');
    return {
      valid: false,
      format: null,
      error: `Unsupported file type. Accepted formats: ${accepted}.`,
    };
  }

  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > MAX_FILE_SIZE_MB) {
    return {
      valid: false,
      format,
      error: `File is too large (${sizeMB.toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE_MB} MB.`,
    };
  }

  if (file.size === 0) {
    return { valid: false, format, error: 'File is empty.' };
  }

  return { valid: true, format, error: null };
}

/**
 * Human-readable file size, e.g. 1master.5 MB / 320 KB / 12 bytes.
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 bytes';
  const units = ['bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

/**
 * Read a File as ArrayBuffer — needed for binary formats (.DZT, .dt2, .rd3, .sgy).
 */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read a File as text — needed for .csv.
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}
