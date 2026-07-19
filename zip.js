(() => {
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[index] = value >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function view(size) {
    const bytes = new Uint8Array(size);
    return { bytes, data: new DataView(bytes.buffer) };
  }

  window.createZipBlob = function createZipBlob(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const bytes = file.bytes;
      const crc = crc32(bytes);
      const stamp = dosDateTime(file.date ?? new Date());
      const local = view(30);
      local.data.setUint32(0, 0x04034b50, true);
      local.data.setUint16(4, 20, true);
      local.data.setUint16(6, 0x0800, true);
      local.data.setUint16(8, 0, true);
      local.data.setUint16(10, stamp.time, true);
      local.data.setUint16(12, stamp.date, true);
      local.data.setUint32(14, crc, true);
      local.data.setUint32(18, bytes.length, true);
      local.data.setUint32(22, bytes.length, true);
      local.data.setUint16(26, name.length, true);
      local.data.setUint16(28, 0, true);
      localParts.push(local.bytes, name, bytes);

      const central = view(46);
      central.data.setUint32(0, 0x02014b50, true);
      central.data.setUint16(4, 20, true);
      central.data.setUint16(6, 20, true);
      central.data.setUint16(8, 0x0800, true);
      central.data.setUint16(10, 0, true);
      central.data.setUint16(12, stamp.time, true);
      central.data.setUint16(14, stamp.date, true);
      central.data.setUint32(16, crc, true);
      central.data.setUint32(20, bytes.length, true);
      central.data.setUint32(24, bytes.length, true);
      central.data.setUint16(28, name.length, true);
      central.data.setUint16(30, 0, true);
      central.data.setUint16(32, 0, true);
      central.data.setUint16(34, 0, true);
      central.data.setUint16(36, 0, true);
      central.data.setUint32(38, 0, true);
      central.data.setUint32(42, offset, true);
      centralParts.push(central.bytes, name);
      offset += local.bytes.length + name.length + bytes.length;
    }

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const end = view(22);
    end.data.setUint32(0, 0x06054b50, true);
    end.data.setUint16(4, 0, true);
    end.data.setUint16(6, 0, true);
    end.data.setUint16(8, files.length, true);
    end.data.setUint16(10, files.length, true);
    end.data.setUint32(12, centralSize, true);
    end.data.setUint32(16, offset, true);
    end.data.setUint16(20, 0, true);
    return new Blob([...localParts, ...centralParts, end.bytes], { type: "application/zip" });
  };
})();
