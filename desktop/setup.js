// Logic màn hình cài đặt — chỉ dùng window.setupApi (preload.js), không có Node.js
const $ = (id) => document.getElementById(id);
const api = window.setupApi;
const mode = new URLSearchParams(location.search).get('mode');

let testedUri = null;   // chỉ cho lưu khi chuỗi hiện tại đã kiểm tra thành công

function setMsg(el, text, ok) {
  el.textContent = text || '';
  el.className = `msg ${ok ? 'ok' : 'err'}`;
}

function updateSaveButton() {
  $('save').disabled = $('uri').value.trim() === '' || $('uri').value.trim() !== testedUri;
}

async function loadPrinters(selected) {
  const sel = $('printer');
  sel.innerHTML = '';
  const none = new Option('— Chưa chọn —', '');
  sel.add(none);
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

async function init() {
  if (mode === 'edit') {
    $('title').textContent = 'Cài đặt kết nối / máy in';
    $('intro').textContent = 'Đổi xong bấm Lưu — app sẽ tự khởi động lại với cấu hình mới.';
  }
  const cfg = await api.get();
  $('uri').value  = cfg.mongodbUri || '';
  $('shop').value = cfg.shopName || '';
  $('port').value = cfg.port || 3001;
  if (cfg.mongodbUri) testedUri = cfg.mongodbUri;   // chuỗi đang dùng coi như đã kiểm tra
  updateSaveButton();
  await loadPrinters(cfg.printerName);
}

$('uri').addEventListener('input', () => { setMsg($('testMsg'), ''); updateSaveButton(); });

$('test').addEventListener('click', async () => {
  const uri = $('uri').value.trim();
  if (!uri) { setMsg($('testMsg'), 'Hãy dán chuỗi kết nối MongoDB vào ô trên', false); return; }
  $('test').disabled = true;
  $('test').textContent = 'Đang kiểm tra...';
  try {
    const r = await api.testMongo(uri);
    setMsg($('testMsg'), (r.ok ? '✓ ' : '✗ ') + r.message, r.ok);
    testedUri = r.ok ? uri : null;
  } finally {
    $('test').disabled = false;
    $('test').textContent = 'Kiểm tra kết nối';
    updateSaveButton();
  }
});

$('reloadPrinters').addEventListener('click', () => loadPrinters($('printer').value));

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('save').disabled) return;
  $('save').disabled = true;
  $('save').textContent = 'Đang lưu...';
  const r = await api.save({
    mongodbUri:  $('uri').value.trim(),
    printerName: $('printer').value,
    shopName:    $('shop').value.trim(),
    port:        Number($('port').value) || 3001,
  });
  if (r.ok) {
    setMsg($('saveMsg'), '✓ Đã lưu. App đang khởi động lại...', true);
  } else {
    setMsg($('saveMsg'), r.message, false);
    $('save').textContent = 'Lưu và mở app';
    updateSaveButton();
  }
});

document.querySelectorAll('[data-ext]').forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  api.openExternal(a.dataset.ext);
}));

init();
