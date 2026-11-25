/**
 * LỚP A 1999–2002 — Bộ xử lý v2 (tách riêng, không đụng tới Lưu bút cũ)
 * Tính năng: Sổ điểm danh · Thả tim lưu bút · Cập nhật thông tin của tớ · Tìm lại bạn cũ
 *
 * CÀI ĐẶT (làm 1 lần):
 *  1. Tạo Google Sheet mới tên "LopA-Backend-2" → menu Tiện ích mở rộng → Apps Script.
 *  2. Xoá hết mã mẫu, dán toàn bộ file này vào, bấm Lưu.
 *  3. Bánh răng "Cài đặt dự án" → "Thuộc tính tập lệnh" → thêm 2 thuộc tính:
 *       ADMIN_PASS = (mật khẩu Quản trị anh đang dùng cho Lưu bút)
 *       LOP_TOKEN  = (chuỗi Claude gửi riêng cho anh)
 *  4. Triển khai → Tùy chọn triển khai mới → Loại: Ứng dụng web
 *       Thực thi với tư cách: Tôi · Người có quyền truy cập: Bất kỳ ai → Triển khai → cấp quyền.
 *  5. Sao chép "URL ứng dụng web" (…/exec) gửi cho Claude.
 * Các trang tính (DiemDanh, Tim, CapNhat, TimBan) tự tạo khi có dữ liệu đầu tiên.
 */

const SHEETS = {
  DiemDanh: ['Thời gian', 'STT', 'Biệt danh', 'Thiết bị'],
  Tim:      ['Mã lời nhắn', 'Số tim'],
  CapNhat:  ['Mã', 'Thời gian', 'STT', 'Biệt danh', 'Đang ở (tỉnh/TP)', 'Công việc', 'Ngày ấy (kỷ niệm)', 'Bây giờ (đôi dòng)', 'Trạng thái'],
  TimBan:   ['Thời gian', 'Người báo (STT)', 'Người báo', 'Bạn cần tìm', 'Thông tin', 'Đã xử lý'],
};

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SHEETS[name].length).setFontWeight('bold');
  }
  return sh;
}
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const clip_ = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
/* Giữ xuống dòng (thơ, nhiều đoạn) cho các ô văn bản dài */
const clipText_ = (s, n) => String(s || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const okToken_ = p => p.token && prop_('LOP_TOKEN') && p.token === prop_('LOP_TOKEN');
const okAdmin_ = p => p.password && prop_('ADMIN_PASS') && p.password === prop_('ADMIN_PASS');
const rows_ = name => { const v = sheet_(name).getDataRange().getValues(); v.shift(); return v; };

function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) { return handle_(e.parameter || {}); }

function handle_(p) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    switch (p.action) {
      case 'checkin':  return checkin_(p);
      case 'hearts':   return hearts_(p);
      case 'heart':    return heart_(p);
      case 'capnhat':  return capnhat_(p);
      case 'thongtin': return thongtin_(p);
      case 'timban':   return timban_(p);
      case 'admin':    return admin_(p);
      case 'duyet':    return duyet_(p);
      default:         return json_({ success: true, service: 'LopA v2' });
    }
  } catch (err) {
    return json_({ success: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* Sổ điểm danh: ghi mỗi lần vào trang (chỉ người đã điểm danh đúng mới có token) */
function checkin_(p) {
  if (!okToken_(p)) return json_({ success: false, error: 'token' });
  sheet_('DiemDanh').appendRow([new Date(), clip_(p.stt, 4), clip_(p.name, 60), clip_(p.ua, 40)]);
  return json_({ success: true });
}

/* Thả tim lưu bút */
function hearts_(p) {
  if (!okToken_(p)) return json_({ success: false, error: 'token' });
  const map = {};
  rows_('Tim').forEach(r => { map[String(r[0])] = Number(r[1]) || 0; });
  return json_({ success: true, hearts: map });
}
function heart_(p) {
  if (!okToken_(p)) return json_({ success: false, error: 'token' });
  const id = clip_(p.id, 80);
  if (!id) return json_({ success: false, error: 'id' });
  const sh = sheet_('Tim'), v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === id) {
      const n = (Number(v[i][1]) || 0) + 1;
      sh.getRange(i + 1, 2).setValue(n);
      return json_({ success: true, count: n });
    }
  }
  sh.appendRow([id, 1]);
  return json_({ success: true, count: 1 });
}

/* Cập nhật thông tin của tớ (chờ Lớp trưởng duyệt) */
function capnhat_(p) {
  if (!okToken_(p)) return json_({ success: false, error: 'token' });
  const id = Utilities.getUuid().slice(0, 8);
  sheet_('CapNhat').appendRow([id, new Date(), clip_(p.stt, 4), clip_(p.name, 60), clip_(p.noi, 60),
    clip_(p.viec, 120), clipText_(p.ngayay, 500), clipText_(p.baygio, 500), 'cho']);
  return json_({ success: true });
}
/* Thông tin đã duyệt — mỗi bạn lấy bản mới nhất */
function thongtin_(p) {
  if (!okToken_(p)) return json_({ success: false, error: 'token' });
  const latest = {};
  rows_('CapNhat').forEach(r => {
    if (r[8] !== 'duyet') return;
    latest[String(r[2])] = { stt: String(r[2]), name: r[3], noi: r[4], viec: r[5], ngayay: r[6], baygio: r[7] };
  });
  return json_({ success: true, items: Object.values(latest) });
}

/* Tìm lại bạn cũ: ai biết tin thì báo */
function timban_(p) {
  if (!okToken_(p)) return json_({ success: false, error: 'token' });
  sheet_('TimBan').appendRow([new Date(), clip_(p.stt, 4), clip_(p.name, 60), clip_(p.target, 60), clipText_(p.info, 500), '']);
  return json_({ success: true });
}

/* Quản trị */
function admin_(p) {
  if (!okAdmin_(p)) return json_({ success: false, error: 'Sai mật khẩu' });
  const fmt = d => d instanceof Date ? Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm') : String(d);
  const dd = rows_('DiemDanh');
  const last = {};
  dd.forEach(r => { last[String(r[1])] = { stt: String(r[1]), name: r[2], time: fmt(r[0]), n: ((last[String(r[1])] || {}).n || 0) + 1 }; });
  return json_({
    success: true,
    diemdanh: Object.values(last),
    capnhat: rows_('CapNhat').filter(r => r[8] === 'cho').map(r => ({ id: r[0], time: fmt(r[1]), stt: String(r[2]), name: r[3], noi: r[4], viec: r[5], ngayay: r[6], baygio: r[7] })),
    timban: rows_('TimBan').filter(r => !r[5]).map(r => ({ time: fmt(r[0]), name: r[2], target: r[3], info: r[4] })),
  });
}
function duyet_(p) {
  if (!okAdmin_(p)) return json_({ success: false, error: 'Sai mật khẩu' });
  const sh = sheet_('CapNhat'), v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === String(p.id)) {
      sh.getRange(i + 1, 9).setValue(p.ok === '1' ? 'duyet' : 'xoa');
      return json_({ success: true });
    }
  }
  return json_({ success: false, error: 'Không thấy mục này' });
}
