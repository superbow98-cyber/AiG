// AiG — gprParser
// Parse GPR binary files into a common shape:
//   { matrix: Float32Array[][], metadata: { traces, samples, dt_ns, dx_m, format } }
// matrix convention (matches BScanViewer): rows = samples (depth), columns = traces (distance).
// matrix[sampleIndex][traceIndex] = reflected amplitude.
import { detectFormat, readFileAsArrayBuffer, readFileAsText } from './fileHelpers';

// ---------------------------------------------------------------------------
// GSSI .DZT
// ---------------------------------------------------------------------------

/**
 * Parse a GSSI .DZT file.
 * Header is little-endian. Fields used here (offsets in bytes):
 *   0-1   rh_tag         uint16  — should read 0xFFFF
 *   2-3   rh_data        uint16  — header size. Values < 300 are a count of 1KB
 *                                  blocks (GSSI convention), so real size = value * 1024.
 *   4-5   rh_nsamp       uint16  — samples per trace
 *   6-7   rh_bits        uint16  — bits per sample (16 or 32)
 *   8-9   rh_zero        int16   — ADC zero-offset baseline, subtracted from every sample
 *   10-13 rh_sps         float32 — scans per second (time-based surveys)
 *   14-17 rh_spm         float32 — scans per metre (odometer surveys)
 *   18-21 rh_time_window float32 — two-way travel time window, in nanoseconds
 * After the header: traces of `rh_nsamp` samples each (Int16, or Int32 if rh_bits = 32).
 */
export function parseDZT(buffer) {
  if (buffer.byteLength < 60) {
    throw new Error('File is too small to contain a valid GSSI DZT header.');
  }

  const view = new DataView(buffer);

  const rh_tag = view.getUint16(0, true);
  if (rh_tag !== 0xffff) {
    // Not every GSSI export uses the canonical tag — warn instead of hard-failing.
    console.warn(`AiG: unexpected DZT tag 0x${rh_tag.toString(16)} (expected 0xffff).`);
  }

  const rh_data = view.getUint16(2, true);
  const headerSize = rh_data < 300 ? rh_data * 1024 : rh_data;

  const rh_nsamp = view.getUint16(4, true);
  const rh_bits = view.getUint16(6, true);
  const rh_zero = view.getInt16(8, true);
  const rh_sps = view.getFloat32(10, true);
  const rh_spm = view.getFloat32(14, true);
  const rh_time_window = view.getFloat32(18, true);

  if (!rh_nsamp) {
    throw new Error('DZT header reports zero samples per trace — file may be corrupt.');
  }

  const bytesPerSample = rh_bits === 32 ? 4 : 2;
  const traceDataSize = rh_nsamp * bytesPerSample;
  const nTraces = Math.floor((buffer.byteLength - headerSize) / traceDataSize);

  if (nTraces <= 0) {
    throw new Error('DZT header parsed but no trace data follows — check header size.');
  }

  const matrix = Array.from({ length: rh_nsamp }, () => new Float32Array(nTraces));

  for (let t = 0; t < nTraces; t++) {
    const traceStart = headerSize + t * traceDataSize;
    for (let s = 0; s < rh_nsamp; s++) {
      const offset = traceStart + s * bytesPerSample;
      const raw = rh_bits === 32 ? view.getInt32(offset, true) : view.getInt16(offset, true);
      matrix[s][t] = raw - rh_zero;
    }
  }

  return {
    matrix,
    metadata: {
      traces: nTraces,
      samples: rh_nsamp,
      dt_ns: rh_time_window / rh_nsamp,
      dx_m: rh_spm > 0 ? 1 / rh_spm : 0.02, // fall back to a typical 2cm trace spacing
      format: 'dzt',
      bits: rh_bits,
      headerSize,
      scansPerSecond: rh_sps || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Mala .dt2 / .rd3
// ---------------------------------------------------------------------------

/**
 * Parse a Mala .rd3/.dt2 raw data file. Mala stores raw samples with NO embedded
 * header — the companion .rad text file ("KEY:VALUE" per line) supplies the
 * samples-per-trace count and survey spacing. radText must be provided.
 */
export function parseMalaRD3(buffer, radText = null) {
  if (!radText) {
    throw new Error(
      'Mala .rd3/.dt2 files need their companion .rad header file to know samples per trace — please select both files.'
    );
  }

  const header = parseMalaRadHeader(radText);
  if (!header.samples) {
    throw new Error('Could not find a SAMPLES value in the .rad header file.');
  }

  const bytesPerSample = 2; // Mala raw data is 16-bit signed integers
  const traceDataSize = header.samples * bytesPerSample;
  const nTraces = Math.floor(buffer.byteLength / traceDataSize);

  if (nTraces <= 0) {
    throw new Error('No complete traces found — check that SAMPLES in the .rad file matches the data file.');
  }

  const view = new DataView(buffer);
  const matrix = Array.from({ length: header.samples }, () => new Float32Array(nTraces));

  for (let t = 0; t < nTraces; t++) {
    const traceStart = t * traceDataSize;
    for (let s = 0; s < header.samples; s++) {
      matrix[s][t] = view.getInt16(traceStart + s * bytesPerSample, true);
    }
  }

  return {
    matrix,
    metadata: {
      traces: nTraces,
      samples: header.samples,
      dt_ns: header.timewindow ? header.timewindow / header.samples : 0.1,
      dx_m: header.distanceInterval ?? 0.02,
      format: 'rd3',
    },
  };
}

function parseMalaRadHeader(radText) {
  const result = { samples: null, timewindow: null, distanceInterval: null };

  for (const rawLine of radText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes(':')) continue;

    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toUpperCase();
    const value = rest.join(':').trim();

    if (key === 'SAMPLES') result.samples = parseInt(value, 10);
    if (key === 'TIMEWINDOW') result.timewindow = parseFloat(value);
    if (key === 'DISTANCE INTERVAL') result.distanceInterval = parseFloat(value);
  }

  return result;
}

// ---------------------------------------------------------------------------
// SEG-Y (.sgy / .segy)
// ---------------------------------------------------------------------------

const SEGY_TEXT_HEADER_SIZE = 3200;
const SEGY_BIN_HEADER_SIZE = 400;
const SEGY_TRACE_HEADER_SIZE = 240;

/**
 * Parse a standard SEG-Y file: 3200B textual header + 400B binary header,
 * then repeating [240B trace header][sample data] blocks. Binary header and
 * trace data are big-endian per the SEG-Y spec.
 * Supports data sample format codes 1 (IBM float), 2 (int32), 3 (int16), 5 (IEEE float32).
 */
export function parseSEGY(buffer) {
  if (buffer.byteLength < SEGY_TEXT_HEADER_SIZE + SEGY_BIN_HEADER_SIZE) {
    throw new Error('File is too small to be a valid SEG-Y file.');
  }

  const view = new DataView(buffer);
  const binOffset = SEGY_TEXT_HEADER_SIZE;

  const sampleIntervalUs = view.getInt16(binOffset + 16, false);
  const samplesPerTrace = view.getInt16(binOffset + 20, false);
  const formatCode = view.getInt16(binOffset + 24, false);

  if (!samplesPerTrace || samplesPerTrace <= 0) {
    throw new Error('Could not read a valid sample count from the SEG-Y binary header.');
  }

  const bytesPerSample = formatCode === 3 ? 2 : 4;
  const traceDataSize = samplesPerTrace * bytesPerSample;
  const traceBlockSize = SEGY_TRACE_HEADER_SIZE + traceDataSize;
  const dataStart = SEGY_TEXT_HEADER_SIZE + SEGY_BIN_HEADER_SIZE;
  const nTraces = Math.floor((buffer.byteLength - dataStart) / traceBlockSize);

  if (nTraces <= 0) {
    throw new Error('SEG-Y file has a valid header but no trace data.');
  }

  const matrix = Array.from({ length: samplesPerTrace }, () => new Float32Array(nTraces));

  for (let t = 0; t < nTraces; t++) {
    const traceStart = dataStart + t * traceBlockSize + SEGY_TRACE_HEADER_SIZE;
    for (let s = 0; s < samplesPerTrace; s++) {
      const offset = traceStart + s * bytesPerSample;
      matrix[s][t] = readSegySample(view, offset, formatCode);
    }
  }

  return {
    matrix,
    metadata: {
      traces: nTraces,
      samples: samplesPerTrace,
      // Sample interval is stored in microseconds per the SEG-Y spec; GPR data sampled
      // sub-microsecond may need a vendor-specific scalar — adjustable in Settings.
      dt_ns: sampleIntervalUs * 1000,
      dx_m: null,
      format: 'sgy',
      sampleFormatCode: formatCode,
    },
  };
}

function readSegySample(view, offset, formatCode) {
  switch (formatCode) {
    case 1:
      return ibmFloatToFloat32(view.getUint32(offset, false));
    case 2:
      return view.getInt32(offset, false);
    case 3:
      return view.getInt16(offset, false);
    case 5:
      return view.getFloat32(offset, false);
    case 8:
      return view.getInt8(offset);
    default:
      return view.getFloat32(offset, false);
  }
}

/** Standard IBM hexadecimal floating point → IEEE 754 conversion. */
function ibmFloatToFloat32(bits) {
  const sign = bits >>> 31 ? -1 : 1;
  const exponent = (bits >>> 24) & 0x7f;
  const mantissa = bits & 0x00ffffff;
  if (mantissa === 0) return 0;
  return sign * mantissa * Math.pow(2, 4 * (exponent - 64) - 24);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Parse a plain numeric CSV export. Convention: each line is one depth sample,
 * each comma-separated value is one trace — matching the matrix orientation
 * used everywhere else. Ragged rows are zero-padded to the widest row.
 */
export function parseCSV(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error('CSV file is empty.');
  }

  const rows = lines.map((line) =>
    line
      .split(',')
      .map((cell) => parseFloat(cell.trim()))
      .filter((n) => !Number.isNaN(n))
  );

  const nTraces = Math.max(...rows.map((r) => r.length));
  if (nTraces === 0) {
    throw new Error('Could not find any numeric values in the CSV file.');
  }

  const matrix = rows.map((row) => {
    const padded = new Float32Array(nTraces);
    row.forEach((v, i) => {
      padded[i] = v;
    });
    return padded;
  });

  return {
    matrix,
    metadata: {
      traces: nTraces,
      samples: matrix.length,
      dt_ns: 0.1, // unknown for plain CSV — default sample interval, adjustable in Settings
      dx_m: 0.02, // unknown for plain CSV — default trace spacing, adjustable in Settings
      format: 'csv',
    },
  };
}

// ---------------------------------------------------------------------------
// Synthetic demo scan (no real file needed — unblocks UI work on every layer)
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic B-scan with a handful of point-reflector hyperbolas
 * over background noise, so Visualise/Detect/Classify can be built and
 * demoed before real GPR files are available.
 */
export function generateSyntheticScan({ traces = 200, samples = 300, dt_ns = 0.2, dx_m = 0.02 } = {}) {
  const matrix = Array.from({ length: samples }, () => new Float32Array(traces));

  for (let s = 0; s < samples; s++) {
    for (let t = 0; t < traces; t++) {
      matrix[s][t] = (Math.random() - 0.5) * 8; // ambient background noise
    }
  }

  const reflectors = [
    { traceCenter: 50, depthSample: 80, amplitude: 180 },
    { traceCenter: 120, depthSample: 150, amplitude: 150 },
    { traceCenter: 165, depthSample: 60, amplitude: 120 },
  ];
  const curvature = 1.2; // higher = narrower hyperbola arms

  for (const { traceCenter, depthSample, amplitude } of reflectors) {
    for (let t = 0; t < traces; t++) {
      const dTrace = t - traceCenter;
      const travelExtra =
        Math.sqrt(dTrace * dTrace + (depthSample / curvature) ** 2) * curvature - depthSample;
      const peakSample = Math.round(depthSample + travelExtra);

      for (let ds = -3; ds <= 3; ds++) {
        const s = peakSample + ds;
        if (s < 0 || s >= samples) continue;
        matrix[s][t] += amplitude * Math.exp(-(ds * ds) / 4);
      }
    }
  }

  return {
    matrix,
    metadata: { traces, samples, dt_ns, dx_m, format: 'synthetic' },
  };
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Detect the format from the filename and run the matching parser.
 * For Mala files, pass the companion .rad file as options.radFile.
 */
export async function parseGPRFile(file, { radFile = null } = {}) {
  const format = detectFormat(file.name);
  if (!format) {
    throw new Error(`Unsupported file: ${file.name}`);
  }

  let result;

  switch (format) {
    case 'dzt': {
      const buffer = await readFileAsArrayBuffer(file);
      result = parseDZT(buffer);
      break;
    }
    case 'dt2':
    case 'rd3': {
      const buffer = await readFileAsArrayBuffer(file);
      const radText = radFile ? await readFileAsText(radFile) : null;
      result = parseMalaRD3(buffer, radText);
      break;
    }
    case 'sgy':
    case 'segy': {
      const buffer = await readFileAsArrayBuffer(file);
      result = parseSEGY(buffer);
      break;
    }
    case 'csv': {
      const text = await readFileAsText(file);
      result = parseCSV(text);
      break;
    }
    default:
      throw new Error(`No parser implemented for format: ${format}`);
  }

  return { ...result, filename: file.name };
}
