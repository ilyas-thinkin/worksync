// usage: node mkfile.js <in.xlsx> <out.xlsx> <excelize|variant>
// excelize: fill the cached formula results Excel would store (D op code, J SAH, K emp code).
// variant:  excelize, then rename op of row 1, re-time row 2 (x1.5), drop the last 5 rows.
const ExcelJS = require('/home/worksync/worksync-staging/backend/node_modules/exceljs');
const [,, inPath, outPath, mode] = process.argv;
const plain = v => (v && typeof v === 'object') ? (v.result ?? '') : (v ?? '');
const before = s => { const t = String(s || ''); const i = t.indexOf(' | '); return i === -1 ? '' : t.slice(0, i).trim(); };
(async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(inPath);
  const sh = wb.getWorksheet('Line Plan') || wb.worksheets[0];
  const rows = [];
  for (let r = 17; r <= 2001; r++) {
    const x = sh.getRow(r);
    if (!plain(x.getCell(3).value) && !plain(x.getCell(5).value)) break;
    rows.push(r);
  }
  if (mode === 'variant') {
    sh.getRow(rows[0]).getCell(5).value = 'TEST RENAMED OPERATION';
    const f = sh.getRow(rows[1]).getCell(6); f.value = Math.round(Number(plain(f.value)) * 1.5);
    for (const r of rows.splice(-5)) { const x = sh.getRow(r); for (let c = 1; c <= 12; c++) x.getCell(c).value = null; }
  }
  for (const r of rows) {
    const x = sh.getRow(r);
    const setResult = (c, result) => { const v = x.getCell(c).value; const formula = (v && typeof v === 'object' && v.formula) ? v.formula : null; x.getCell(c).value = formula ? { formula, result } : result; };
    setResult(4, before(plain(x.getCell(5).value)));
    setResult(10, Number(plain(x.getCell(6).value)) / 3600);
    setResult(11, before(plain(x.getCell(12).value)));
  }
  await wb.xlsx.writeFile(outPath);
  console.log(mode, outPath, 'rows', rows.length);
})().catch(e => { console.error(e); process.exit(1); });
