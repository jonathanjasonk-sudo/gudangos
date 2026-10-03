const ExcelJS = require('exceljs');

const MATERIALS = ['Shoe Box', 'Size Label', 'Karton Label', 'Marking'];

function materialQty(history, material) {
  return history.filter(entry => entry.material === material).reduce((total, entry) => total + Number(entry.qty), 0);
}
function itemMaterials(item) {
  return Array.isArray(item.materials) && item.materials.length ? item.materials : MATERIALS;
}
function materialsComplete(history, qty, materials = MATERIALS) {
  return materials.every(material => materialQty(history, material) >= Number(qty));
}
function hasMaterialProgress(history, materials = MATERIALS) {
  return materials.some(material => materialQty(history, material) > 0);
}
function takenCompletionDate(item) {
  const materials = itemMaterials(item);
  const totals = Object.fromEntries(materials.map(material => [material, 0]));
  for (const entry of item.pengambilan.history) {
    if (materials.includes(entry.material)) totals[entry.material] += Number(entry.qty);
    if (materials.every(material => totals[material] >= Number(item.qty))) return entry.date;
  }
  return null;
}

async function buildExportWorkbook(items) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Marketing System';
  workbook.created = new Date();
  const sheets = [
    { name: 'REQ PRODUKSI', items: items.filter(item => !hasMaterialProgress(item.whReady.history, itemMaterials(item)) && !hasMaterialProgress(item.pengambilan.history, itemMaterials(item))) },
    { name: 'MARKETING READY', items: items.filter(item => hasMaterialProgress(item.whReady.history, itemMaterials(item)) && !materialsComplete(item.pengambilan.history, item.qty, itemMaterials(item))) },
    { name: 'TAKEN', items: items.filter(item => hasMaterialProgress(item.pengambilan.history, itemMaterials(item))) }
  ];
  const materialColumns = MATERIALS.flatMap((material, index) => [
    { header: `${material} Ready`, key: `ready${index}`, width: 16 },
    { header: `${material} Ready Balance`, key: `readyBalance${index}`, width: 20 },
    { header: `${material} Taken`, key: `taken${index}`, width: 16 },
    { header: `${material} Taken Balance`, key: `takenBalance${index}`, width: 20 }
  ]);

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = [
      { header: 'SPK', key: 'spk', width: 20 },
      { header: 'STYLE', key: 'style', width: 20 },
      { header: 'Customer', key: 'customer', width: 24 },
      { header: 'Tanggal Request', key: 'requestDate', width: 20, style: { numFmt: 'dd mmm yyyy' } },
      { header: 'XFD', key: 'xfd', width: 16, style: { numFmt: 'dd mmm yyyy' } },
      { header: 'QTY', key: 'qty', width: 12 },
      { header: 'Status Taken', key: 'takenStatus', width: 18 },
      { header: 'Tanggal OK Ambil', key: 'takenDate', width: 20, style: { numFmt: 'dd mmm yyyy' } },
      ...materialColumns
    ];
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C2333' } };

    for (const item of sheet.items) {
      const materials = itemMaterials(item);
      const isTakenComplete = materialsComplete(item.pengambilan.history, item.qty, materials);
      const row = {
        spk: item.spk,
        style: item.style || '',
        customer: item.customer,
        requestDate: item.createdAt ? new Date(item.createdAt) : null,
        xfd: item.xfd,
        qty: Number(item.qty),
        takenStatus: isTakenComplete ? 'Lengkap' : 'Dalam proses',
        takenDate: isTakenComplete ? takenCompletionDate(item) : null
      };
      MATERIALS.forEach((material, index) => {
        const ready = materialQty(item.whReady.history, material);
        const taken = materialQty(item.pengambilan.history, material);
        row[`ready${index}`] = ready;
        row[`readyBalance${index}`] = Math.max(0, Number(item.qty) - ready);
        row[`taken${index}`] = taken;
        row[`takenBalance${index}`] = Math.max(0, Number(item.qty) - taken);
      });
      worksheet.addRow(row);
    }
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: worksheet.columnCount } };
  }

  return workbook;
}

async function buildSpkTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Marketing System';
  const worksheet = workbook.addWorksheet('MASTER SPK');
  worksheet.columns = [
    { header: 'SPK', key: 'spk', width: 22 },
    { header: 'STYLE', key: 'style', width: 22 },
    { header: 'CUSTOMER', key: 'customer', width: 36 },
    { header: 'XFD', key: 'xfd', width: 16, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'QTY', key: 'qty', width: 14 }
  ];
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C2333' } };
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };
  return workbook;
}

buildExportWorkbook.buildSpkTemplate = buildSpkTemplateWorkbook;
module.exports = buildExportWorkbook;