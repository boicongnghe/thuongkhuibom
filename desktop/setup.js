// Logic màn hình cài đặt — chỉ dùng window.setupApi (preload.js), không có Node.js
const $ = (id) => document.getElementById(id);
const api = window.setupApi;
const mode = new URLSearchParams(location.search).get('mode');

let verifiedUrl = null;   // chỉ cho lưu khi địa chỉ đã kiểm tra được

function setMsg(el, text, ok) {
  el.textContent = text || '';
  el.className = `msg ${ok ? 'ok' : 'err'}`;
}

function currentUrl() {
  return $('urlEdit').hidden ? $('urlFixedText').textContent : $('url').value.trim();
}

function updateSave() {
  $('save').disabled = !verifiedUrl;
}

async function loadPrinters(selected) {
  const sel = $('printer');
  sel.innerHTML = '';
  sel.add(new Option('— Chưa chọn —', ''));
  try {
    const list = await api.printers();
    for (const p of list) sel.add(new Option(p.name + (p.isDefault ? ' (mặc định)' : ''), p.name));
    // Chọn lại máy in cũ, hoặc tự đoán máy in nhiệt (POS / 58 / 80 / XP / GEZHI)
    const guess = list.find(p => p.name === selected)
      || list.find(p => /pos|58|80|xp-|xprinter|gezhi|thermal/i.test(p.name));
    if (guess) sel.value = guess.name;
  } catch {
    sel.add(new Option('(Không đọc được danh sách máy in)', ''));
  }
}

async function test(url) {
  $('test').disabled = true;
  $('test').textContent = 'Đang kiểm tra...';
  try {
    const r = await api.testUrl(url);
    setMsg($('testMsg'), (r.ok ? '✓ ' : '✗ ') + r.message, r.ok);
    verifiedUrl = r.ok ? r.url : null;
  } finally {
    $('test').disabled = false;
    $('test').textContent = 'Kiểm tra';
    updateSave();
  }
}

async function init() {
  if (mode === 'edit') {
    $('title').textContent = 'Đổi máy in / địa chỉ dịch vụ';
    $('intro').textContent = 'Đổi xong bấm Lưu — app sẽ tự khởi động lại.';
  }
  const cfg = await api.get();
  const url = cfg.centralUrl || cfg.defaultUrl;
  if (url) {
    // Đã có địa chỉ (người cung cấp đặt sẵn khi build): chỉ cần kiểm tra, không bắt gõ
    $('urlFixed').hidden = false;
    $('urlEdit').hidden = true;
    $('urlFixedText').textContent = url;
    $('url').value = url;
    test(url);
  }
  await loadPrinters(cfg.printerName);
}

$('changeUrl').addEventListener('click', () => {
  $('urlFixed').hidden = true;
  $('urlEdit').hidden = false;
  verifiedUrl = null;
  updateSave();
  $('url').focus();
});
$('url').addEventListener('input', () => { verifiedUrl = null; setMsg($('testMsg'), ''); updateSave(); });
$('test').addEventListener('click', () => {
  const url = $('url').value.trim();
  if (!url) { setMsg($('testMsg'), 'Hãy nhập địa chỉ dịch vụ', false); return; }
  test(url);
});
$('reloadPrinters').addEventListener('click', () => loadPrinters($('printer').value));

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!verifiedUrl) return;
  $('save').disabled = true;
  $('save').textContent = 'Đang lưu...';
  const r = await api.save({ centralUrl: verifiedUrl || currentUrl(), printerName: $('printer').value });
  if (r.ok) {
    setMsg($('saveMsg'), '✓ Đã lưu. App đang khởi động lại...', true);
  } else {
    setMsg($('saveMsg'), r.message, false);
    $('save').textContent = 'Lưu và mở app';
    updateSave();
  }
});

init();
