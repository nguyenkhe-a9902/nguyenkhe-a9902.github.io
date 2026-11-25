#!/usr/bin/env python3
"""Mã hoá nội dung web Lớp A vào index.html.

Cách dùng:  python3 tools/ma-hoa.py <duong-dan/lopA-du-lieu-goc.json> [index.html]

- Dữ liệu gốc (danh sách lớp, ngày sinh, quỹ, sự kiện) nằm trong file JSON riêng,
  lưu ở Google Drive của Lớp trưởng — KHÔNG đưa lên GitHub.
- Khoá chung lưu trong file dữ liệu gốc (trường "_khoaChung"); giữ nguyên khoá này thì
  cập nhật nội dung xong mọi người KHÔNG phải điểm danh lại. Xoá trường đó = buộc mọi máy đăng nhập lại.
- Khoá vào trang của mỗi bạn = (tên | họ tên | biệt danh) + ngày, tháng sinh.
  Bạn nào chưa có ngày sinh trong dữ liệu thì chưa vào được.
Cần: pip install cryptography
"""
import base64, hashlib, json, os, re, sys, unicodedata
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ITER = 200_000
b64 = lambda b: base64.b64encode(b).decode()


def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = s.replace('đ', 'd').replace('Đ', 'D').lower().strip()
    return re.sub(r'\s+', ' ', s)


def name_variants(full, nick):
    v = {norm(full), norm(nick)}
    if full.strip(): v.add(norm(full.split()[-1]))   # tên gọi: "Hùng"
    if nick.strip(): v.add(norm(nick.split()[0]))    # chữ đầu biệt danh
    return {x for x in v if x}


def seal(key, obj):
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode(), None)
    return b64(iv), b64(ct)


def main(src, html='index.html'):
    goc = json.load(open(src, encoding='utf-8'))
    payload = {k: goc[k] for k in ('members', 'khoanChi', 'events', 'dsSub', 'quyNote2')}
    payload['matLienLac'] = goc.get('matLienLac', [])  # STT các bạn đang mất liên lạc (mục Tìm bạn cũ)
    if goc.get('_khoaChung'):
        K = base64.b64decode(goc['_khoaChung'])
    else:
        K = AESGCM.generate_key(256)
        goc['_khoaChung'] = b64(K)
        json.dump(goc, open(src, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('Tạo khoá chung mới và lưu vào file dữ liệu gốc (nhớ cập nhật bản trên Drive).')
    salt = os.urandom(16)
    iv, ct = seal(K, payload)
    keys, owner, thieu = {}, {}, []
    for i, r in enumerate(goc['members']):
        m = re.match(r'^(\d{2})/(\d{2})(?:/\d{4})?$', r[2] or '')
        if not m:
            thieu.append(r[5]); continue
        ddmm = m.group(1) + m.group(2)
        for name in name_variants(r[1], r[5]):
            bits = hashlib.pbkdf2_hmac('sha256', f'{name}|{ddmm}'.encode(), salt, ITER, 48)
            kid = bits[32:].hex()
            if kid in owner and owner[kid] != i:
                print(f'  ! Trùng khoá "{name}|{ddmm}" giữa {goc["members"][owner[kid]][5]} và {r[5]} — giữ người đầu')
                continue
            owner[kid] = i
            keys[kid] = list(seal(bits[:32], {'k': b64(K), 'i': i}))
    enc = {'v': 1, 'iter': ITER, 'salt': b64(salt), 'iv': iv, 'ct': ct, 'keys': keys}
    s = open(html, encoding='utf-8').read()
    s, n = re.subn(r'/\*ENC-START\*/.*?/\*ENC-END\*/',
                   '/*ENC-START*/' + json.dumps(enc, separators=(',', ':')) + '/*ENC-END*/', s, flags=re.S)
    assert n == 1, 'Không tìm thấy chỗ ENC-START/ENC-END trong index.html'
    open(html, 'w', encoding='utf-8').write(s)
    print(f'Đã mã hoá: {len(goc["members"])} thành viên, {len(keys)} khoá vào trang.')
    if thieu:
        print(f'Chưa có ngày sinh (chưa vào được): {", ".join(thieu)}')


if __name__ == '__main__':
    main(*sys.argv[1:])
