import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { finalElim, maskFromGray, pickElim, readHudNumbers } from '../shared/hudScan.js';

const exec = promisify(execFile);
const WIDTH = 280;
const HEIGHT = 64;

function run(bin, args) {
  return exec(bin, args, { windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
}

async function ffmpegBin() {
  for (const bin of ['ffmpeg', 'ffmpeg.exe']) {
    try {
      await run(bin, ['-version']);
      return bin;
    } catch { /* try next */ }
  }
  return '';
}

export async function scanElims(file) {
  const bin = await ffmpegBin();
  if (!bin) return { elims: 0, method: 'none', note: 'Install ffmpeg to scan clips on the server. The browser scan is used instead.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogv-cup-'));
  try {
    await run(bin, [
      '-y', '-i', file,
      '-vf', `fps=1,crop=iw*0.22:ih*0.09:iw*0.70:ih*0.005,scale=${WIDTH}:${HEIGHT},format=gray`,
      '-frames:v', '900',
      path.join(dir, 'f%04d.pgm'),
    ]);
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.pgm')).sort();
    const readings = [];
    for (const name of files) {
      const raw = fs.readFileSync(path.join(dir, name));
      const start = raw.indexOf(0x0a, raw.indexOf(0x0a) + 1) + 1;
      readings.push(pickElim(readHudNumbers(maskFromGray(raw.subarray(start)), WIDTH, HEIGHT)));
    }
    const elims = finalElim(readings);
    return { elims, method: 'ffmpeg', note: `Read the top-right elim number across ${files.length} frames.` };
  } catch {
    return { elims: 0, method: 'fail', note: 'The server could not read that clip.' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
