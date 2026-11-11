import { Box } from '#/box';
import { ErrorCode } from '#/constants';
import type { Sample, TypedArray } from '@types';
import { parseOneBox } from '#/parser';
import { DataStream } from '#/DataStream';
import { MultiBufferStream } from '#/buffer';
import { MP4BoxBuffer } from '#/mp4boxbuffer';
import type { ISOFile } from '#/isofile';
import type { vttCBox } from '#/boxes/vttC';
import type { tx3gSampleEntry } from '#/boxes/sampleentries/tx3g';

/*
 * Copyright (c) 2012-2013. Telecom ParisTech/TSI/MM/GPAC Cyril Concolato
 * License: BSD-3-Clause (see LICENSE file)
 */
export class VTTin4Parser {
  parseSample(data: TypedArray) {
    const cues: Array<Box> = [];
    const stream = new MultiBufferStream(MP4BoxBuffer.fromArrayBuffer(data.buffer, 0));

    while (!stream.isEof()) {
      const cue = parseOneBox(stream, false);
      if (cue.code === ErrorCode.OK && cue.box?.type === 'vttc') {
        cues.push(cue.box);
      }
    }
    return cues;
  }

  getText(startTime: number, endTime: number, data: TypedArray) {
    function pad(value: number, width: number) {
      const string = value.toString();
      if (string.length >= width) {
        return string;
      }
      return new Array(width - string.length + 1).join('0') + string;
    }
    function secToTimestamp(insec: number) {
      const h = Math.floor(insec / 3600);
      const m = Math.floor((insec - h * 3600) / 60);
      const s = Math.floor(insec - h * 3600 - m * 60);
      const ms = Math.floor((insec - h * 3600 - m * 60 - s) * 1000);
      return '' + pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + '.' + pad(ms, 3);
    }
    const cues = this.parseSample(data);
    let string = '';
    for (let i = 0; i < cues.length; i++) {
      const cueIn4 = cues[i];
      string += secToTimestamp(startTime) + ' --> ' + secToTimestamp(endTime) + '\r\n';
      // @ts-expect-error FIXME: which box should get a payl-property?
      string += cueIn4.payl.text;
    }
    return string;
  }
}

export class XMLSubtitlein4Parser {
  parseSample(sample: Sample) {
    const res = {
      resources: [] as Array<Uint8Array>,
      documentString: '',
      document: undefined as undefined | Document,
    };
    const stream = new DataStream(sample.data.buffer);
    if (!sample.subsamples || sample.subsamples.length === 0) {
      res.documentString = stream.readString(sample.data.length);
    } else {
      res.documentString = stream.readString(sample.subsamples[0].size);
      if (sample.subsamples.length > 1) {
        for (let i = 1; i < sample.subsamples.length; i++) {
          res.resources[i] = stream.readUint8Array(sample.subsamples[i].size);
        }
      }
    }
    if (typeof DOMParser !== 'undefined') {
      res.document = new DOMParser().parseFromString(res.documentString, 'application/xml');
    }
    return res;
  }
}

export class Textin4Parser {
  parseSample(sample: Sample) {
    const stream = new DataStream(sample.data.buffer);
    const textString = stream.readString(sample.data.length);
    return textString;
  }

  parseConfig(data: TypedArray) {
    const stream = new DataStream(data.buffer);
    stream.readUint32(); // version & flags
    const textString = stream.readCString();
    return textString;
  }
}

export class TX3GParser {
  parseSample(sample: Sample) {
    const stream = new DataStream(sample.data.buffer);
    const size = stream.readUint16();
    if (size === 0) {
      // If size is 0, it indicates an empty text sample
      return;
    }

    return decodeTextTrackString(stream.readUint8Array(size));
  }
}

/*
 * Export of tx3g and wvtt subtitle tracks as WebVTT.
 */

/** Decode a 3GPP text string (UTF-8, or UTF-16 with BOM). */
function decodeTextTrackString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function readU32(data: Uint8Array, pos: number): number {
  return ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0;
}

function readU16(data: Uint8Array, pos: number): number {
  return (data[pos] << 8) | data[pos + 1];
}

function fourCC(data: Uint8Array, pos: number): string {
  return String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
}

/** Escape text for use as WebVTT cue text. */
function escapeVttText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Format a time in seconds as a WebVTT timestamp (HH:MM:SS.mmm). */
function formatVttTime(sec: number): string {
  const totalMs = Math.round(sec * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const pad = (v: number, w: number) => String(v).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

interface Tx3gStyleRun {
  startChar: number;
  endChar: number;
  /** face style flags: bit 0 = bold, bit 1 = italic, bit 2 = underline */
  face: number;
}

/** Parse a tx3g sample: text (UTF-8/UTF-16) plus style runs from the styl box. */
function parseTx3gSample(data: Uint8Array): { text: string; runs: Array<Tx3gStyleRun> } {
  const textLen = readU16(data, 0);
  if (textLen === 0) return { text: '', runs: [] };
  const text = decodeTextTrackString(data.subarray(2, 2 + textLen));
  const runs: Array<Tx3gStyleRun> = [];
  let pos = 2 + textLen;
  while (pos + 8 <= data.length) {
    const size = readU32(data, pos);
    if (size < 8 || pos + size > data.length) break;
    if (fourCC(data, pos + 4) === 'styl') {
      const count = readU16(data, pos + 8);
      for (let i = 0; i < count; i++) {
        const r = pos + 10 + i * 12;
        if (r + 12 > pos + size) break;
        runs.push({
          startChar: readU16(data, r),
          endChar: readU16(data, r + 2),
          face: data[r + 6],
        });
      }
    }
    pos += size;
  }
  return { text, runs };
}

function wrapTx3gStyle(segment: string, face: number): string {
  let open = '';
  let close = '';
  if (face & 1) {
    open += '<b>';
    close = '</b>' + close;
  }
  if (face & 2) {
    open += '<i>';
    close = '</i>' + close;
  }
  if (face & 4) {
    open += '<u>';
    close = '</u>' + close;
  }
  return open + segment + close;
}

/** Apply tx3g style runs to text, emitting WebVTT b/i/u tags. */
function applyTx3gStyles(text: string, runs: Array<Tx3gStyleRun>, defaultFace: number): string {
  const n = text.length;
  if (n === 0) return '';
  const faces = new Array<number>(n).fill(defaultFace);
  for (const run of runs) {
    const start = Math.max(0, run.startChar);
    const end = Math.min(n, run.endChar);
    for (let i = start; i < end; i++) {
      if (i >= 0 && i < n) faces[i] = run.face;
    }
  }
  let out = '';
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && faces[j] === faces[i]) j++;
    out += wrapTx3gStyle(escapeVttText(text.slice(i, j)), faces[i]);
    i = j;
  }
  return out;
}

interface WvttBox {
  type: string;
  payload: Uint8Array;
}

function readWvttBoxes(data: Uint8Array, start: number, end: number): Array<WvttBox> {
  const boxes: Array<WvttBox> = [];
  let pos = start;
  while (pos + 8 <= end) {
    const size = readU32(data, pos);
    if (size < 8 || pos + size > end) break;
    boxes.push({ type: fourCC(data, pos + 4), payload: data.subarray(pos + 8, pos + size) });
    pos += size;
  }
  return boxes;
}

/** Convert a wvtt sample into WebVTT cue/comment blocks. */
function wvttSampleToCueParts(data: Uint8Array, startSec: number, endSec: number): Array<string> {
  const parts: Array<string> = [];
  for (const box of readWvttBoxes(data, 0, data.length)) {
    if (box.type === 'vttc') {
      let iden = '';
      let sttg = '';
      let payl = '';
      for (const child of readWvttBoxes(box.payload, 0, box.payload.length)) {
        const text = decodeTextTrackString(child.payload);
        if (child.type === 'iden') iden = text;
        else if (child.type === 'sttg') sttg = text;
        else if (child.type === 'payl') payl = text;
      }
      let cue = '';
      const id = iden.replace(/[\r\n]+$/, '');
      if (id) cue += id + '\n';
      cue += `${formatVttTime(startSec)} --> ${formatVttTime(endSec)}`;
      const settings = sttg.replace(/[\r\n]+$/, '');
      if (settings) cue += ' ' + settings;
      cue += '\n' + payl.replace(/[\r\n]+$/, '');
      parts.push(cue);
    } else if (box.type === 'vtta') {
      parts.push(decodeTextTrackString(box.payload).replace(/[\r\n]+$/, ''));
    }
    // 'vtte' (empty cue) produces no output
  }
  return parts;
}

/**
 * Export a tx3g or wvtt subtitle track as a complete WebVTT document.
 *
 * @param file the ISOFile object
 * @param trackId the track id
 * @returns the WebVTT text, ready to be saved as a .vtt file
 */
export function getTrackAsWebVTT(file: ISOFile, trackId: number): string {
  const trak = file.getTrackById(trackId);
  if (!trak) {
    throw new Error(`Track ${trackId} not found`);
  }
  const timescale = trak.mdia.mdhd.timescale;
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const codec = entry.type;

  const parts: Array<string> = [];
  let defaultFace = 0;

  if (codec === 'wvtt') {
    const vttC = entry.boxes?.find(b => b.type === 'vttC') as vttCBox | undefined;
    const header = vttC?.text ?? 'WEBVTT';
    parts.push(header.replace(/[\r\n]+$/, ''));
  } else if (codec === 'tx3g') {
    parts.push('WEBVTT');
    const styleRecord = (entry as tx3gSampleEntry).style_record;
    defaultFace = styleRecord ? styleRecord[2] : 0;
  } else {
    throw new Error(`Track ${trackId} is not a tx3g or wvtt subtitle track (codec: ${codec})`);
  }

  for (let i = 0; i < trak.samples.length; i++) {
    const sample = file.getTrackSample(trackId, i);
    if (!sample) {
      throw new Error(
        `Sample ${i} of track ${trackId} is not available (sample data was discarded)`,
      );
    }
    const startSec = sample.cts / timescale;
    const endSec = (sample.cts + sample.duration) / timescale;
    if (codec === 'tx3g') {
      const { text, runs } = parseTx3gSample(sample.data);
      if (!text) continue; // empty sample → no cue
      const styled = applyTx3gStyles(text, runs, defaultFace);
      parts.push(`${formatVttTime(startSec)} --> ${formatVttTime(endSec)}\n${styled}`);
    } else {
      parts.push(...wvttSampleToCueParts(sample.data, startSec, endSec));
    }
  }

  return parts.join('\n\n') + '\n';
}
