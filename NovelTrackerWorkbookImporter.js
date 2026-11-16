/* Browser-side reader for Novel Nook .xlsx/.xlsm workbooks.
   It reads the workbook ZIP/XML without uploading the file or changing the source. */
(function () {
  'use strict';
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const DROPDOWN_NAMES = {
    Acquired:'acquired', Adaptations:'adaptations', Age_Rating:'ageRating',
    Auth_Ship:'relationshipWithAuthor', Countries:'country', Gender:'gender',
    Genres:'genre', Imprints:'imprint', Merchants:'merchant',
    Publication_Year:'year', Publishers:'publisher', Sub_Genres:'subGenre',
    Volumes:'volumes', Page_Count:'pageCount', Category_Score:'categoryScore'
  };
  const localName = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const childText = (node, name) => node.getElementsByTagNameNS(MAIN, name)[0]?.textContent || '';
  const xml = (text, label) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`${label} is not valid workbook XML.`);
    return doc;
  };
  const colIndex = ref => {
    const letters = String(ref).match(/[A-Za-z]+/)?.[0] || '';
    let n = 0;
    for (const c of letters.toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
    return n;
  };
  const resolvePart = (base, target) => {
    const parts = (target.startsWith('/') ? target.slice(1) : `${base.slice(0, base.lastIndexOf('/') + 1)}${target}`).split('/');
    const clean = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') clean.pop(); else clean.push(part);
    }
    return clean.join('/');
  };
  async function unzip(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = offset => view.getUint16(offset, true), u32 = offset => view.getUint32(offset, true);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (u32(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This file is not a readable Excel workbook.');
    const entries = u16(eocd + 10), directoryOffset = u32(eocd + 16);
    if (entries === 0xffff || directoryOffset === 0xffffffff) throw new Error('This workbook uses a ZIP64 format that the web app cannot read yet.');
    const decoder = new TextDecoder('utf-8');
    const files = new Map();
    let cursor = directoryOffset;
    for (let i = 0; i < entries; i++) {
      if (u32(cursor) !== 0x02014b50) throw new Error('The workbook file is damaged or incomplete.');
      const flags = u16(cursor + 8), method = u16(cursor + 10), compressedSize = u32(cursor + 20);
      const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32), localOffset = u32(cursor + 42);
      if (flags & 1) throw new Error('Password-protected workbooks are not supported.');
      const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('This workbook uses a ZIP64 format that the web app cannot read yet.');
      if (name && !name.endsWith('/')) {
        if (u32(localOffset) !== 0x04034b50) throw new Error('The workbook file is damaged or incomplete.');
        const dataStart = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
        const packed = bytes.slice(dataStart, dataStart + compressedSize);
        let content;
        if (method === 0) content = packed;
        else if (method === 8) {
          if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unpack Excel workbooks. Update Safari or use JSON/CSV import.');
          try { content = new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
          catch { throw new Error('This browser could not unpack the workbook. Update Safari or save it as .xlsx and try again.'); }
        } else throw new Error(`This workbook uses unsupported ZIP compression (${method}).`);
        files.set(name, content);
      }
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return {
      has: name => files.has(name),
      text: name => { const data = files.get(name); if (!data) throw new Error(`The workbook is missing ${name}.`); return decoder.decode(data); },
      optionalText: name => files.has(name) ? decoder.decode(files.get(name)) : ''
    };
  }
  function parseSheet(text, shared) {
    const doc = xml(text, 'A worksheet');
    const grid = new Map();
    for (const row of localName(doc, 'row')) {
      const rowIndex = Number(row.getAttribute('r')) || 0, cells = new Map();
      for (const cell of localName(row, 'c')) {
        const ref = cell.getAttribute('r') || '', type = cell.getAttribute('t') || '', valueNode = cell.getElementsByTagNameNS(MAIN, 'v')[0];
        let value = '';
        if (type === 'inlineStr') value = localName(cell, 't').map(t => t.textContent || '').join('');
        else if (valueNode) {
          const raw = valueNode.textContent || '';
          if (type === 's') value = shared[Number(raw)] ?? '';
          else if (type === 'b') value = raw === '1' ? '1' : '0';
          else value = raw;
        }
        cells.set(colIndex(ref), value);
      }
      grid.set(rowIndex, cells);
    }
    const tableIds = localName(doc, 'tablePart').map(node => node.getAttributeNS(REL, 'id') || node.getAttribute('r:id')).filter(Boolean);
    return {grid, tableIds};
  }
  function relationshipMap(doc) {
    return new Map(localName(doc, 'Relationship').map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
  }
  function parseDropdownOptions(workbook, grids) {
    const names = new Map(localName(workbook, 'definedName').map(node => [node.getAttribute('name'), (node.textContent || '').trim().replace(/^=/, '')]));
    const result = {};
    for (const [name, key] of Object.entries(DROPDOWN_NAMES)) {
      const match = names.get(name)?.match(/^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);
      if (!match) continue;
      const sheet = match[1] || match[2], firstCol = colIndex(match[3]), firstRow = Number(match[4]), lastCol = colIndex(match[5]), lastRow = Number(match[6]);
      if (!grids.has(sheet) || firstCol !== lastCol) continue;
      const values = [];
      for (let row = firstRow; row <= lastRow; row++) {
        const value = String(grids.get(sheet).get(row)?.get(firstCol) || '').trim();
        if (value && !values.includes(value)) values.push(value);
      }
      result[key] = values;
    }
    result.year = Array.from({length:141}, (_, i) => String(1900 + i));
    result.publicationYear = result.year.slice();
    result.bestOfYear = Array.from({length:41}, (_, i) => String(2000 + i));
    return result;
  }
  async function importWorkbook(file) {
    const zip = await unzip(file);
    const workbook = xml(zip.text('xl/workbook.xml'), 'The workbook index');
    const workbookRels = relationshipMap(xml(zip.text('xl/_rels/workbook.xml.rels'), 'The workbook links'));
    const sharedDoc = zip.has('xl/sharedStrings.xml') ? xml(zip.text('xl/sharedStrings.xml'), 'The shared text list') : null;
    const shared = sharedDoc ? localName(sharedDoc, 'si').map(si => localName(si, 't').map(t => t.textContent || '').join('')) : [];
    const sheetParts = new Map();
    for (const sheet of localName(workbook, 'sheet')) {
      const target = workbookRels.get(sheet.getAttributeNS(REL, 'id') || sheet.getAttribute('r:id'));
      if (target) sheetParts.set(sheet.getAttribute('name'), resolvePart('xl/workbook.xml', target));
    }
    const grids = new Map(), sheetTableTargets = new Map();
    for (const [name, part] of sheetParts) {
      if (!zip.has(part)) continue;
      const parsed = parseSheet(zip.text(part), shared);
      grids.set(name, parsed.grid);
      const relPart = resolvePart(part, `_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`);
      const rels = zip.has(relPart) ? relationshipMap(xml(zip.text(relPart), 'Worksheet links')) : new Map();
      sheetTableTargets.set(name, parsed.tableIds.map(id => rels.has(id) ? resolvePart(part, rels.get(id)) : '').filter(Boolean));
    }
    const tableToSheet = new Map();
    for (const [sheet, targets] of sheetTableTargets) for (const target of targets) tableToSheet.set(target, sheet);
    const sourceTables = {}, books = [];
    const tableParts = [...tableToSheet.keys()].sort();
    for (const part of tableParts) {
      const table = xml(zip.text(part), 'A workbook table').documentElement;
      const name = table.getAttribute('displayName') || table.getAttribute('name') || part;
      const sheet = tableToSheet.get(part) || '', ref = table.getAttribute('ref') || 'A1:A1';
      const match = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (!match || !grids.has(sheet)) continue;
      const firstCol=colIndex(match[1]), firstRow=Number(match[2]), lastCol=colIndex(match[3]), lastRow=Number(match[4]);
      const columns=localName(table, 'tableColumn').map(column=>column.getAttribute('name') || ''), rows=[];
      for (let r=firstRow+1;r<=lastRow;r++) {
        const cells=grids.get(sheet).get(r) || new Map(), row={};
        for (let i=0;i<Math.min(columns.length,lastCol-firstCol+1);i++) row[columns[i]]=cells.get(firstCol+i) ?? '';
        if (Object.values(row).some(value=>String(value).trim())) rows.push(row);
      }
      sourceTables[name]={sheet,columns,rows};
      if (name==='Light_Novel') books.push(...rows);
    }
    const tools=grids.get('Tools') || new Map(), numberAt=(col,row)=>{const value=Number(tools.get(row)?.get(colIndex(col)));return Number.isFinite(value)?value:null};
    const scoringThresholds={Exceptional:numberAt('AE',1),Great:numberAt('AE',2),Good:numberAt('AE',3),Decent:numberAt('AE',4)};
    const quotes=(grids.get('More Quotes') || new Map());
    const quoteList=Array.from(quotes.values()).map(row=>String(row.get(1)||'').trim()).filter(Boolean);
    if (!books.length) throw new Error('No book records were found in the workbook’s Light_Novel table.');
    return {format:'NovelTrackerWorkbook',workbookName:file.name,books,quotes:quoteList,sourceTables,sourceSheets:[...sheetParts.keys()],scoringThresholds,dropdownOptions:parseDropdownOptions(workbook,grids)};
  }
  window.importNovelTrackerWorkbook = importWorkbook;
})();
