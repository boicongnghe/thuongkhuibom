const { printer: ThermalPrinter, types: PrinterTypes } = require('node-thermal-printer');
require('dotenv').config();

const PRINTER_NAME  = process.env.PRINTER_NAME  || 'POS-80';
const PRINTER_WIDTH = parseInt(process.env.PRINTER_WIDTH || '80');
const SHOP_NAME     = process.env.SHOP_NAME     || 'SHOP CỦA BẠN';

/**
 * In 1 bình luận ra máy in nhiệt
 * @param {object} data - { username, tiktokUserId, comment, timestamp, orderNum }
 */
async function printComment(data) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `printer:${PRINTER_NAME}`,
    characterSet: 'PC858_EURO',
    removeSpecialCharacters: false,
    lineCharacter: '=',
    width: PRINTER_WIDTH === 80 ? 48 : 32, // ký tự/dòng
  });

  const isConnected = await printer.isPrinterConnected();
  if (!isConnected) {
    throw new Error(`Không tìm thấy máy in: ${PRINTER_NAME}`);
  }

  const divider = PRINTER_WIDTH === 80
    ? '================================'
    : '========================';

  const time = new Date(data.timestamp).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  // ── Layout phiếu in ──────────────────────────────────
  printer.alignCenter();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println(SHOP_NAME);
  printer.setTextNormal();
  printer.println('CHOT DON TIKTOK LIVE');
  printer.bold(false);
  printer.println(divider);

  printer.alignLeft();
  printer.println(`ID     : ${data.tiktokUserId}`);
  printer.println(`User   : @${data.username}`);
  printer.println(divider);

  // Bình luận - wrap nếu dài
  printer.bold(true);
  printer.println('Binh luan:');
  printer.bold(false);
  printer.println(data.comment);
  printer.println(divider);

  printer.println(`Thoi gian: ${time}`);
  if (data.orderNum) {
    printer.println(`Don so   : #${data.orderNum}`);
  }

  printer.alignCenter();
  printer.println(divider);
  printer.println('Cam on quy khach!');

  printer.cut();

  await printer.execute();
  printer.clear();
}

/**
 * Kiểm tra máy in có sẵn sàng không
 */
async function checkPrinter() {
  try {
    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `printer:${PRINTER_NAME}`,
    });
    const ok = await printer.isPrinterConnected();
    return { ok, printerName: PRINTER_NAME };
  } catch (err) {
    return { ok: false, printerName: PRINTER_NAME, error: err.message };
  }
}

module.exports = { printComment, checkPrinter };
