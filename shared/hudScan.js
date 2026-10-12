const GLYPHS = [
  ['0', '01110100011000110001100011000101110'],
  ['1', '00100011000010000100001000010001110'],
  ['2', '01110100010000100110010001000011111'],
  ['3', '01110100010000101110000011000101110'],
  ['4', '00010001100101010010111110001000010'],
  ['5', '11111100001111000001000011000101110'],
  ['6', '01110100011000011110100011000101110'],
  ['7', '11111000010001000100001000010000100'],
  ['8', '01110100011000101110100011000101110'],
  ['9', '01110100011000101111000011000101110'],
];

export function maskFromGray(pixels, min = 188) {
  const out = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 1) out[i] = pixels[i] >= min ? 1 : 0;
  return out;
}

export function maskFromRgba(data, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (y > 200 && sat < 70) out[i] = 1;
  }
  return out;
}

function blobs(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const found = [];
  const stack = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || seen[i]) continue;
    let area = 0;
    let minx = width;
    let maxx = 0;
    let miny = height;
    let maxy = 0;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p / width) | 0;
      area += 1;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      for (const n of [p - 1, p + 1, p - width, p + width]) {
        if (n < 0 || n >= mask.length || !mask[n] || seen[n]) continue;
        const nx = n % width;
        const ny = (n / width) | 0;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    found.push({ area, minx, maxx, miny, maxy, w: maxx - minx + 1, h: maxy - miny + 1 });
  }
  return found;
}

function gridOf(mask, width, blob) {
  let bits = '';
  for (let gy = 0; gy < 7; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      const x0 = blob.minx + Math.floor((gx * blob.w) / 5);
      const x1 = blob.minx + Math.floor(((gx + 1) * blob.w) / 5);
      const y0 = blob.miny + Math.floor((gy * blob.h) / 7);
      const y1 = blob.miny + Math.floor(((gy + 1) * blob.h) / 7);
      let ink = 0;
      let n = 0;
      for (let y = y0; y < Math.max(y0 + 1, y1); y += 1) {
        for (let x = x0; x < Math.max(x0 + 1, x1); x += 1) {
          ink += mask[y * width + x];
          n += 1;
        }
      }
      bits += ink / n > 0.32 ? '1' : '0';
    }
  }
  return bits;
}

function rowInk(bits, row) {
  let n = 0;
  for (let x = 0; x < 5; x += 1) if (bits[row * 5 + x] === '1') n += 1;
  return n;
}

function readDigit(mask, width, blob) {
  const bits = gridOf(mask, width, blob);
  let best = '';
  let score = 10;
  for (const [digit, glyph] of GLYPHS) {
    let d = 0;
    for (let i = 0; i < 35; i += 1) if (bits[i] !== glyph[i]) d += 1;
    if (d < score) {
      score = d;
      best = digit;
    }
  }
  if (best === '7' && rowInk(bits, 6) >= 3) best = '2';
  if (best === '2' && rowInk(bits, 6) <= 1 && rowInk(bits, 0) >= 3) best = '7';
  return score <= 10 ? best : '';
}

export function readHudNumbers(mask, width, height) {
  const digits = blobs(mask, width, height)
    .filter((blob) => (
      blob.area >= 10
      && blob.area <= 220
      && blob.h >= 8
      && blob.h <= Math.floor(height * 0.85)
      && blob.w >= 3
      && blob.w <= blob.h * 0.95
      && blob.h > blob.w * 1.05
    ))
    .sort((a, b) => a.minx - b.minx || a.miny - b.miny)
    .map((blob) => {
      const digit = readDigit(mask, width, blob);
      return digit ? { digit, x: blob.minx, y: blob.miny, h: blob.h } : null;
    })
    .filter(Boolean);

  const groups = [];
  for (const item of digits) {
    const last = groups[groups.length - 1];
    if (last && item.x - last.x1 <= Math.max(6, last.h * 0.7) && Math.abs(item.y - last.y) < last.h * 0.6) {
      last.text += item.digit;
      last.x1 = item.x + 4;
    } else {
      groups.push({
        text: item.digit, x: item.x, x1: item.x + 4, y: item.y, h: item.h,
      });
    }
  }
  return groups
    .map((group) => Number(group.text))
    .filter((n) => Number.isFinite(n) && n <= 40);
}

export function pickElim(numbers) {
  if (!numbers.length) return null;
  const small = numbers.filter((n) => n <= 15);
  if (small.length) return small[small.length - 1];
  return numbers[numbers.length - 1];
}

export function finalElim(readings) {
  const filled = readings.filter((n) => n != null);
  if (!filled.length) return 0;
  const tail = filled.slice(Math.floor(filled.length * 0.6));
  const sample = tail.length >= 3 ? tail : filled;
  const sorted = [...sample].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
