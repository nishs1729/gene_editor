// A minimal ZIP writer: files are stored uncompressed, which every unzip tool
// reads. FASTA is small enough next to the browser's own download limits that
// compression is not worth a dependency.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** DOS date and time fields, the only timestamp a ZIP header has room for. */
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Give every name in the archive its own spelling: two open files called
 * `sample.fasta` would otherwise overwrite each other when unzipped.
 * @param {string[]} names
 * @returns {string[]}
 */
export function uniqueNames(names) {
  const taken = new Set();
  return names.map(name => {
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    while (taken.has(`${stem} (${n})${ext}`)) n++;
    const unique = `${stem} (${n})${ext}`;
    taken.add(unique);
    return unique;
  });
}

/**
 * @param {Array<{name: string, data: string | Uint8Array}>} entries
 * @param {Date} [date] - modification time recorded for every entry
 * @returns {Uint8Array} the archive's bytes
 */
export function createZip(entries, date = new Date()) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const names = uniqueNames(entries.map(e => e.name));

  const locals = [];
  const centrals = [];
  let offset = 0;

  entries.forEach((entry, i) => {
    const nameBytes = encoder.encode(names[i]);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0x0800, true); // flags: names are UTF-8
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra field length
    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014B50, true); // central directory signature
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    // extra, comment, disk number, internal and external attributes: all zero
    central.setUint32(42, offset, true); // where the local header starts
    centrals.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  });

  const centralSize = centrals.reduce((s, part) => s + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true); // end of central directory signature
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // entries in total
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // where the central directory starts

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, part) => s + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
