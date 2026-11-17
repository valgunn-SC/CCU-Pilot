/* Lecteur XLSX minimal pour Chrome moderne : inventaire et tokens, sans dépendance externe. */
(function () {
  'use strict';
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);
  const text = (bytes) => new TextDecoder('utf-8').decode(bytes);
  const xml = (value) => new DOMParser().parseFromString(value, 'application/xml');
  const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer); const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Archive XLSX invalide (EOCD absent).');
    const entries = u16(view, eocd + 10); let pos = u32(view, eocd + 16); const files = {};
    for (let i = 0; i < entries; i++) {
      if (u32(view, pos) !== 0x02014b50) throw new Error('Archive XLSX invalide (répertoire central).');
      const method = u16(view, pos + 10); const compressedSize = u32(view, pos + 20);
      const nameLen = u16(view, pos + 28); const extraLen = u16(view, pos + 30); const commentLen = u16(view, pos + 32);
      const localOffset = u32(view, pos + 42); const name = text(bytes.slice(pos + 46, pos + 46 + nameLen));
      if (u32(view, localOffset) !== 0x04034b50) throw new Error('Archive XLSX invalide (entrée locale).');
      const localNameLen = u16(view, localOffset + 26); const localExtraLen = u16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      if (method === 0) files[name] = compressed;
      else if (method === 8) files[name] = await inflateRaw(compressed);
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  const colIndex = (ref) => {
    const letters = (ref.match(/[A-Z]+/i) || ['A'])[0].toUpperCase(); let n = 0;
    for (const char of letters) n = n * 26 + char.charCodeAt(0) - 64;
    return n - 1;
  };

  async function read(file) {
    const files = await unzip(await file.arrayBuffer());
    if (!files['xl/workbook.xml']) throw new Error('Classeur XLSX sans workbook.xml.');
    const shared = files['xl/sharedStrings.xml'] ? tags(xml(text(files['xl/sharedStrings.xml'])), 'si').map((si) => tags(si, 't').map((t) => t.textContent).join('')) : [];
    const wb = xml(text(files['xl/workbook.xml']));
    const rels = files['xl/_rels/workbook.xml.rels'] ? xml(text(files['xl/_rels/workbook.xml.rels'])) : null;
    const relMap = {};
    if (rels) tags(rels, 'Relationship').forEach((r) => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const result = {};
    for (const sheet of tags(wb, 'sheet')) {
      const name = sheet.getAttribute('name');
      const relId = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap[relId] || `worksheets/sheet${Object.keys(result).length + 1}.xml`;
      target = target.replace(/^\//, '').replace(/^xl\//, '');
      const path = `xl/${target}`.replace(/\/\.\//g, '/');
      if (!files[path]) continue;
      const doc = xml(text(files[path])); const rows = [];
      tags(doc, 'row').forEach((row) => {
        const rowIndex = Number(row.getAttribute('r') || rows.length + 1) - 1;
        const values = [];
        tags(row, 'c').forEach((cell) => {
          const idx = colIndex(cell.getAttribute('r') || 'A1'); const type = cell.getAttribute('t');
          const vNode = tags(cell, 'v')[0]; let value = vNode ? vNode.textContent : '';
          if (type === 's') value = shared[Number(value)] ?? '';
          else if (type === 'inlineStr') value = tags(cell, 't').map((t) => t.textContent).join('');
          else if (type === 'b') value = value === '1';
          else if (type !== 'str' && value !== '' && Number.isFinite(Number(value))) value = Number(value);
          values[idx] = value;
        });
        rows[rowIndex] = values;
      });
      result[name] = rows;
    }
    return { SheetNames: Object.keys(result), Sheets: result };
  }

  window.XLSXLite = { read };
})();
