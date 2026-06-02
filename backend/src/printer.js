require('dotenv').config();
const { execFile } = require('child_process');
const path = require('path');

const PRINTER_NAME  = process.env.PRINTER_NAME  || 'POS-58';
const PRINTER_WIDTH = parseInt(process.env.PRINTER_WIDTH || '58', 10);
const SHOP_NAME     = process.env.SHOP_NAME     || 'SHOP CUA BAN';
const PS_SCRIPT     = path.join(__dirname, 'raw_print.ps1');

const LINE_WIDTH = 32;
const DIVIDER    = '='.repeat(LINE_WIDTH);

// ─── ESC/POS byte builders ────────────────────────────────────────────────────

const ESC = 0x1B;
const GS  = 0x1D;

function escInit()          { return [ESC, 0x40]; }           // Reset máy in
function escFeed(n = 4)     { return [ESC, 0x64, n]; }        // Feed n lines
function escCut()           { return [GS, 0x56, 0x41, 0x03]; }// Cut (partial)
function escAlign(a)        { return [ESC, 0x61, a]; }        // 0=left 1=center 2=right
function escText(str)       {
  const buf = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    buf.push(code < 128 ? code : 0x3F); // non-ASCII → '?'
  }
  buf.push(0x0A); // newline
  return buf;
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function wrapText(text, maxLength = LINE_WIDTH) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Chuyển tiếng Việt sang ASCII gần đúng để máy in đọc được
  const ascii = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');

  const lines = [];
  ascii.split('\n').forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); return; }
    let line = '';
    words.forEach((word) => {
      if (word.length > maxLength) {
        if (line) { lines.push(line); line = ''; }
        for (let i = 0; i < word.length; i += maxLength) lines.push(word.slice(i, i + maxLength));
        return;
      }
      const nextLine = line ? `${line} ${word}` : word;
      if (nextLine.length > maxLength) { lines.push(line); line = word; }
      else { line = nextLine; }
    });
    if (line) lines.push(line);
  });
  return lines;
}

function fitLine(line)   { return String(line || '').slice(0, LINE_WIDTH); }

function centerLine(text) {
  const value   = fitLine(text);
  const padding = Math.max(0, Math.floor((LINE_WIDTH - value.length) / 2));
  return `${' '.repeat(padding)}${value}`;
}

function formatTime(timestamp) {
  return new Date(timestamp || Date.now()).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Build ESC/POS bytes ──────────────────────────────────────────────────────

function buildEscPos(textLines) {
  const bytes = [
    ...escInit(),
    ...escAlign(0), // left align
  ];

  for (const ln of textLines) {
    bytes.push(...escText(fitLine(ln)));
  }

  bytes.push(...escFeed(4));
  bytes.push(...escCut());
  return Buffer.from(bytes);
}

// ─── Send to printer via PowerShell ──────────────────────────────────────────

function sendToPrinter(data) {
  const hexStr = data.toString('hex').toUpperCase();

  return new Promise((resolve, reject) => {
    const args = [
      '-ExecutionPolicy', 'Bypass',
      '-File', PS_SCRIPT,
      '-PrinterName', PRINTER_NAME,
      '-DataHex', hexStr,
    ];

    execFile('powershell.exe', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        return reject(new Error(`PowerShell print error: ${msg}`));
      }
      const out = stdout.trim();
      console.log(`[Printer] PowerShell output: ${out}`);
      if (!out.startsWith('OK')) {
        return reject(new Error(`Printer trả về: ${out}`));
      }
      resolve(out);
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

function buildTestEscPos() {
  const now = new Date().toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return buildEscPos([
    centerLine('===================='),
    centerLine('TEST PRINT'),
    centerLine('TikTok Order System'),
    centerLine('Connection Success'),
    centerLine(now),
    centerLine('===================='),
  ]);
}

async function printComment(data) {
  console.log('[Printer] Bắt đầu in...');

  const displayName = data.displayName || data.username || '';
  const textLines = [
    centerLine(SHOP_NAME),
    DIVIDER,
    ...wrapText(`Ten: ${displayName}`),
    ...wrapText(`@${data.username || ''}`),
    DIVIDER,
    'Binh luan:',
    ...wrapText(data.comment),
    DIVIDER,
    ...wrapText(`Thoi gian: ${formatTime(data.timestamp)}`),
  ];

  if (data.orderNum) textLines.push(...wrapText(`Don so: #${data.orderNum}`));

  try {
    const escposData = buildEscPos(textLines);
    await sendToPrinter(escposData);
    console.log('[Printer] In thành công!');
  } catch (err) {
    const message = err?.message || String(err);
    console.error(`[Printer] Lỗi: ${message}`);
    throw new Error(message);
  }
}

async function checkPrinter() {
  console.log('[Printer] Kiểm tra kết nối...');
  try {
    // Kiểm tra bằng PowerShell xem printer có tồn tại không
    const result = await new Promise((resolve, reject) => {
      execFile('powershell.exe', [
        '-Command',
        `$p = Get-Printer -Name '${PRINTER_NAME}' -ErrorAction SilentlyContinue; if(!$p){ Write-Output 'NOT_FOUND'; exit }; $port = $p.PortName; if($port -match '^USB'){ $pnp = Get-PnpDevice -Class 'Printer' -Status 'OK' -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^USB' }; if($pnp){ Write-Output 'OK:USB' } else { Write-Output 'OFFLINE:NoUSBDevice' } } else { $s = $p.PrinterStatus.ToString(); if($p.WorkOffline -eq $true -or $s -ne 'Normal'){ Write-Output "OFFLINE:$s" } else { Write-Output "OK:$s" } }`
      ], { timeout: 5000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim());
      });
    });

    const ok = result.startsWith('OK');
    console.log(`[Printer] Status: ${result}`);
    return { ok, printerName: PRINTER_NAME, status: result };
  } catch (err) {
    const message = err?.message || String(err);
    console.error(`[Printer] Lỗi kiểm tra: ${message}`);
    return { ok: false, printerName: PRINTER_NAME, error: message };
  }
}

function getPrinterInfo() {
  return { printerName: PRINTER_NAME, printerWidth: PRINTER_WIDTH, lineWidth: LINE_WIDTH };
}

module.exports = { printComment, checkPrinter, getPrinterInfo, buildTestEscPos };
