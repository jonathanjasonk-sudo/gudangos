const ExcelJS = require('exceljs');

const MATERIALS = ['Shoe Box', 'Size Label', 'Karton Label', 'Marking'];

function materialQty(history, material) {
  return history.filter(entry => entry.material === material).reduce((total, entry) => total + Number(entry.qty), 0);
}
function materialsComplete(history, qty) {
  return MATERIALS.every(material => materialQty(history, material) >= Number(qty));
}
function hasMaterialProgress(history) {
  return MATERIALS.some(material => materialQty(history, material) > 0);
}
function takenCompletionDate(item) {
  const totals = Object.fromEntries(MATERIALS.map(material => [material, 0]));
  for (const entry of item.pengambilan.history) {
    if (MATERIALS.includes(entry.material)) totals[entry.material] += Number(entry.qty);
    if (MATERIALS.every(material => totals[material] >= Number(item.qty))) return entry.date;
  }
  return null;
}

async function buildExportWorkbook(items) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Marketing System';
  workbook.created = new Date();
  const sheets = [
    { name: 'REQ PRODUKSI', items: items.filter(item => !hasMaterialProgress(item.whReady.history) && !hasMaterialProgress(item.pengambilan.history)) },
    { name: 'MARKETING READY', items: items.filter(item => hasMaterialProgress(item.whReady.history) && !materialsComplete(item.pengambilan.history, item.qty)) },
    { name: 'TAKEN', items: items.filter(item => hasMaterialProgress(item.pengambilan.history)) }
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
      { header: 'Customer', key: 'customer', width: 24 },
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
      const isTakenComplete = materialsComplete(item.pengambilan.history, item.qty);
      const row = {
        spk: item.spk,
        customer: item.customer,
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

module.exports = buildExportWorkbook;