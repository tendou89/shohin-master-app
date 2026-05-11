const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

// DB初期化
// DB初期化 - Persistent Disk対応
const isProd = process.env.RENDER === 'true';
const dbDir = isProd
  ? '/opt/render/project/src/db'
  : path.join(__dirname, 'db');
const dbPath = path.join(dbDir, 'shohin.db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL UNIQUE,
    sort_order INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    description TEXT,
    volume TEXT,
    jan_code TEXT,
    expiry_date TEXT,
    image_path TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  // 既存テーブルへのカラム追加（既に存在する場合はエラーを無視）
  db.run(`ALTER TABLE products ADD COLUMN expiry_date TEXT`, () => {});;
  // おすすめパンフレットセットテーブル
  db.run(`CREATE TABLE IF NOT EXISTS pamphlet_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_name TEXT NOT NULL UNIQUE,
    product_codes TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  const cats = ['食品','飲料','日用品','雑貨','衣料','その他'];
  cats.forEach((name, i) => {
    db.run('INSERT OR IGNORE INTO categories (category_name, sort_order) VALUES (?, ?)', [name, i+1]);
  });
});

const dbAll = (sql, params=[]) => new Promise((resolve, reject) =>
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const dbGet = (sql, params=[]) => new Promise((resolve, reject) =>
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const dbRun = (sql, params=[]) => new Promise((resolve, reject) =>
  db.run(sql, params, function(err) { err ? reject(err) : resolve(this); }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 画像保存先 - Persistent Disk対応
const uploadDir = isProd
  ? '/opt/render/project/src/db/uploads'
  : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const uploadImage = multer({ storage: imageStorage, limits: { fileSize: 10*1024*1024 } });
const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 } });

const ok = (res, data, message='') => res.json({ success: true, data, message });
const ng = (res, message, status=400) => res.status(status).json({ success: false, data: null, message });

// ===== カテゴリAPI =====
app.get('/api/categories', async (req, res) => {
  try { ok(res, await dbAll('SELECT * FROM categories ORDER BY sort_order, id')); }
  catch(e) { ng(res, e.message, 500); }
});
app.post('/api/categories', async (req, res) => {
  try {
    const { category_name, sort_order } = req.body;
    if (!category_name) return ng(res, 'カテゴリ名は必須です');
    await dbRun('INSERT INTO categories (category_name, sort_order) VALUES (?, ?)', [category_name.trim(), sort_order||null]);
    const row = await dbGet('SELECT * FROM categories WHERE category_name=?', [category_name.trim()]);
    ok(res, row, 'カテゴリを登録しました');
  } catch(e) {
    if (e.message.includes('UNIQUE')) return ng(res, 'そのカテゴリ名は既に存在します');
    ng(res, e.message, 500);
  }
});
app.put('/api/categories/:id', async (req, res) => {
  try {
    const { category_name, sort_order } = req.body;
    if (!category_name) return ng(res, 'カテゴリ名は必須です');
    await dbRun('UPDATE categories SET category_name=?, sort_order=? WHERE id=?', [category_name.trim(), sort_order||null, req.params.id]);
    ok(res, null, 'カテゴリを更新しました');
  } catch(e) { ng(res, e.message, 500); }
});
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const used = await dbGet('SELECT COUNT(*) as cnt FROM products WHERE category_id=? AND is_deleted=0', [req.params.id]);
    if (used.cnt > 0) return ng(res, 'このカテゴリは商品で使用中です');
    await dbRun('DELETE FROM categories WHERE id=?', [req.params.id]);
    ok(res, null, 'カテゴリを削除しました');
  } catch(e) { ng(res, e.message, 500); }
});

// ===== 商品API =====
app.get('/api/products', async (req, res) => {
  try {
    const { keyword, category_id } = req.query;
    let sql = `SELECT p.*, c.category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.is_deleted=0`;
    const params = [];
    if (category_id) { sql += ' AND p.category_id=?'; params.push(category_id); }
    if (keyword) {
      sql += ' AND (p.product_code LIKE ? OR p.product_name LIKE ? OR p.description LIKE ?)';
      const k = `%${keyword}%`;
      params.push(k, k, k);
    }
    sql += ' ORDER BY p.updated_at DESC';
    ok(res, await dbAll(sql, params));
  } catch(e) { ng(res, e.message, 500); }
});

// Excelテンプレートダウンロード
app.get('/api/products/template-xlsx', (req, res) => {
  const wb = XLSX.utils.book_new();
  // ヘッダー行
  const header = [['商品コード','商品名','カテゴリ','定価','内容量','JANコード','説明文']];
  const sample = [['A001','サンプル商品A','食品',1200,'500ml','4900000000000','おいしい商品です']];
  const ws = XLSX.utils.aoa_to_sheet([...header, ...sample]);
  // JANコード列（F列=index5）を文字列形式に設定
  if (!ws['!cols']) ws['!cols'] = [];
  for (let i = 0; i < 7; i++) ws['!cols'][i] = { wch: i === 5 ? 16 : 20 };
  // F2セルのJANコードサンプルを文字列型で上書き
  ws['F2'] = { t: 's', v: '4900000000000' };
  XLSX.utils.book_append_sheet(wb, ws, '商品登録');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'%E5%95%86%E5%93%81%E7%99%BB%E9%8C%B2%E3%83%86%E3%83%B3%E3%83%97%E3%83%AC%E3%83%BC%E3%83%88.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// CSV一括登録 ※ /api/products/:code より前に定義すること
app.post('/api/products/import-csv', uploadCsv.single('csv'), async (req, res) => {
  try {
    if (!req.file) return ng(res, 'CSVファイルが必要です');

    let text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = splitCsvRows(text);
    if (lines.length < 2) return ng(res, 'CSVにデータがありません（ヘッダー行＋1行以上必要です）');

    const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const COL = {
      code:        findCol(header, ['商品コード','product_code','code']),
      name:        findCol(header, ['商品名','product_name','name']),
      category:    findCol(header, ['カテゴリ','category_name','category']),
      price:       findCol(header, ['定価','price','価格']),
      volume:      findCol(header, ['内容量','volume']),
      jan:         findCol(header, ['janコード','jan_code','jan']),
      description: findCol(header, ['説明文','description','説明']),
    };

    if (COL.code === -1) return ng(res, 'CSVに「商品コード」列が見つかりません');
    if (COL.name === -1) return ng(res, 'CSVに「商品名」列が見つかりません');

    const categories = await dbAll('SELECT * FROM categories');
    const catMap = {};
    categories.forEach(c => { catMap[c.category_name] = c.id; });

    const existingRows = await dbAll('SELECT product_code FROM products WHERE is_deleted=0');
    const existingCodes = new Set(existingRows.map(r => r.product_code));

    const success = [];
    const errors = [];
    const skipped = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const rowNum = i + 1;
      const code        = (cols[COL.code] || '').trim();
      const name        = COL.name !== -1        ? (cols[COL.name] || '').trim()         : '';
      const categoryName= COL.category !== -1    ? (cols[COL.category] || '').trim()     : '';
      const priceRaw    = COL.price !== -1        ? (cols[COL.price] || '0').trim()       : '0';
      const volume      = COL.volume !== -1       ? (cols[COL.volume] || '').trim()       : '';
      const jan         = COL.jan !== -1          ? (cols[COL.jan] || '').trim()          : '';
      const description = COL.description !== -1  ? (cols[COL.description] || '').trim()  : '';

      if (!code)  { errors.push(`${rowNum}行目: 商品コードが空です`); continue; }
      if (!name)  { errors.push(`${rowNum}行目 [${code}]: 商品名が空です`); continue; }
      if (!/^[A-Za-z0-9]{1,20}$/.test(code)) {
        errors.push(`${rowNum}行目 [${code}]: 商品コードは半角英数字20文字以内です`); continue;
      }
      // 科学表記（例：4.93501E+12）は精度が欠落しているため空欄扱い
      let janValue = jan || null;
      if (jan && /^[\d.]+[eE][+\-]?\d+$/.test(jan)) {
        janValue = null; // 科学表記は精度欠落のため破棄
      } else if (jan && !/^\d{13}$/.test(jan)) {
        errors.push(`${rowNum}行目 [${code}]: JANコードが13桁でないため空欄で登録しました`);
        janValue = null;
      }
      if (existingCodes.has(code)) {
        skipped.push(code);
        continue;
      }

      let categoryId = null;
      if (categoryName) {
        if (catMap[categoryName]) {
          categoryId = catMap[categoryName];
        } else {
          await dbRun('INSERT OR IGNORE INTO categories (category_name) VALUES (?)', [categoryName]);
          const newCat = await dbGet('SELECT id FROM categories WHERE category_name=?', [categoryName]);
          if (newCat) { catMap[categoryName] = newCat.id; categoryId = newCat.id; }
        }
      }
      if (!categoryId) {
        const def = await dbGet("SELECT id FROM categories WHERE category_name='その他'");
        categoryId = def ? def.id : 1;
      }

      const price = parseFloat(priceRaw.replace(/[^\d.]/g, '')) || 0;
      try {
        await dbRun(
          `INSERT INTO products (product_code,product_name,category_id,price,volume,jan_code,description) VALUES (?,?,?,?,?,?,?)`,
          [code, name, categoryId, price, volume||null, janValue, description||null]
        );
        existingCodes.add(code);
        success.push(code);
      } catch(e) {
        if (e.message.includes('UNIQUE')) {
          skipped.push(code);
        } else {
          errors.push(`${rowNum}行目 [${code}]: ${e.message}`);
        }
      }
    }
    ok(res, { success, errors, skipped }, `${success.length}件登録完了、${skipped.length}件スキップ、${errors.length}件エラー`);
  } catch(e) {
    ng(res, `CSV処理エラー: ${e.message}`, 500);
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { product_code, product_name, category_id, price, description, volume, jan_code, expiry_date } = req.body;
    if (!product_code||!product_name||!category_id) return ng(res, '商品コード・商品名・カテゴリは必須です');
    if (!/^[A-Za-z0-9]{1,20}$/.test(product_code)) return ng(res, '商品コードは半角英数字20文字以内です');
    if (jan_code && jan_code.length>0 && !/^\d{13}$/.test(jan_code)) return ng(res, 'JANコードは13桁数字です');
    await dbRun(`INSERT INTO products (product_code,product_name,category_id,price,description,volume,jan_code,expiry_date) VALUES (?,?,?,?,?,?,?,?)`,
      [product_code.trim(), product_name.trim(), category_id, parseFloat(price)||0, description||null, volume||null, jan_code||null, expiry_date||null]);
    ok(res, null, '商品を登録しました');
  } catch(e) {
    if (e.message.includes('UNIQUE')) return ng(res, 'その商品コードは既に使用されています');
    ng(res, e.message, 500);
  }
});
app.get('/api/products/:code', async (req, res) => {
  try {
    const row = await dbGet(`SELECT p.*, c.category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.product_code=? AND p.is_deleted=0`, [req.params.code]);
    if (!row) return ng(res, '商品が見つかりません', 404);
    ok(res, row);
  } catch(e) { ng(res, e.message, 500); }
});
app.put('/api/products/:code', async (req, res) => {
  try {
    const { product_name, category_id, price, description, volume, expiry_date } = req.body;
    const new_product_code = (req.body.new_product_code || '').trim();
    let jan_code = req.body.jan_code || '';
    if (!product_name||!category_id) return ng(res, '商品名・カテゴリは必須です');
    // 科学表記のJANコードを自動変換
    if (jan_code && /^[\d.]+[eE][+\-]?\d+$/.test(jan_code)) jan_code = '';
    if (jan_code && !/^\d{13}$/.test(jan_code)) return ng(res, 'JANコードは13桁数字です');

    const currentCode = req.params.code;
    const codeChanged = new_product_code && new_product_code !== currentCode;

    if (codeChanged) {
      if (!/^[A-Za-z0-9]{1,20}$/.test(new_product_code)) return ng(res, '商品コードは半角英数字20文字以内です');
      const dup = await dbGet('SELECT id, is_deleted FROM products WHERE product_code=?', [new_product_code]);
      if (dup) {
        if (dup.is_deleted === 0) return ng(res, 'その商品コードは既に使用されています');
        // 削除済み商品のコードを退避して解放する
        const freedCode = `_del_${Date.now()}`;
        await dbRun('UPDATE products SET product_code=? WHERE product_code=?', [freedCode, new_product_code]);
      }
      // おすすめセット内の参照を更新
      const sets = await dbAll('SELECT id, product_codes FROM pamphlet_sets');
      for (const set of sets) {
        try {
          const codes = JSON.parse(set.product_codes);
          if (codes.includes(currentCode)) {
            const updated = codes.map(c => c === currentCode ? new_product_code : c);
            await dbRun('UPDATE pamphlet_sets SET product_codes=? WHERE id=?', [JSON.stringify(updated), set.id]);
          }
        } catch(e) {}
      }
    }

    const targetCode = codeChanged ? new_product_code : currentCode;
    await dbRun(`UPDATE products SET product_code=?,product_name=?,category_id=?,price=?,description=?,volume=?,jan_code=?,expiry_date=?,updated_at=datetime('now','localtime') WHERE product_code=? AND is_deleted=0`,
      [targetCode, product_name.trim(), category_id, parseFloat(price)||0, description||null, volume||null, jan_code||null, expiry_date||null, currentCode]);
    ok(res, { new_product_code: targetCode }, '商品を更新しました');
  } catch(e) { ng(res, e.message, 500); }
});
app.delete('/api/products/:code', async (req, res) => {
  try {
    await dbRun(`UPDATE products SET is_deleted=1,updated_at=datetime('now','localtime') WHERE product_code=?`, [req.params.code]);
    ok(res, null, '商品を削除しました');
  } catch(e) { ng(res, e.message, 500); }
});
app.post('/api/products/:code/upload-image', (req, res) => {
  uploadImage.single('image')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return ng(res, '画像ファイルが10MBを超えています。10MB以内の画像を選択してください。');
      return ng(res, `アップロードエラー: ${err.message}`, 500);
    }
    try {
      if (!req.file) return ng(res, '画像ファイルが必要です');
      // 画像を圧縮・リサイズ（最大1200px・JPEG品質80%）
      const originalPath = req.file.path;
      const compressedFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const compressedPath = path.join(uploadDir, compressedFilename);
      await sharp(originalPath)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(compressedPath);
      fs.unlink(originalPath, () => {}); // 元ファイル削除
      const imagePath = `/uploads/${compressedFilename}`;
      await dbRun(`UPDATE products SET image_path=?,updated_at=datetime('now','localtime') WHERE product_code=?`, [imagePath, req.params.code]);
      ok(res, { image_path: imagePath }, '画像をアップロードしました');
    } catch(e) { ng(res, e.message, 500); }
  });
});

// 改行を含むセル（クォート内改行）を正しく扱いながら行分割する
function splitCsvRows(text) {
  const rows = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') { current += '"'; i++; }
      else { inQuote = !inQuote; current += ch; }
    } else if ((ch === '\r' || ch === '\n') && !inQuote) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (current.trim()) rows.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) rows.push(current);
  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i+1] === '"') { current += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      result.push(current); current = '';
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

function findCol(header, candidates) {
  for (const c of candidates) {
    const idx = header.indexOf(c.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// ===== パンフレットAPI =====
app.post('/api/pamphlet', async (req, res) => {
  try {
    const { codes } = req.body;
    if (!codes||codes.length===0) return ng(res, '商品コードを指定してください');
    const placeholders = codes.map(()=>'?').join(',');
    ok(res, await dbAll(`SELECT p.*,c.category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.product_code IN (${placeholders}) AND p.is_deleted=0`, codes));
  } catch(e) { ng(res, e.message, 500); }
});

// ===== おすすめパンフレットセットAPI =====
app.get('/api/pamphlet-sets', async (req, res) => {
  try {
    ok(res, await dbAll('SELECT * FROM pamphlet_sets ORDER BY id'));
  } catch(e) { ng(res, e.message, 500); }
});

app.post('/api/pamphlet-sets', async (req, res) => {
  try {
    const { set_name, product_codes } = req.body;
    if (!set_name) return ng(res, 'セット名は必須です');
    if (!product_codes || product_codes.length === 0) return ng(res, '商品を1つ以上選択してください');
    const codesJson = JSON.stringify(product_codes);
    await dbRun('INSERT INTO pamphlet_sets (set_name, product_codes) VALUES (?, ?)', [set_name.trim(), codesJson]);
    const row = await dbGet('SELECT * FROM pamphlet_sets WHERE set_name=?', [set_name.trim()]);
    ok(res, row, 'おすすめセットを登録しました');
  } catch(e) {
    if (e.message.includes('UNIQUE')) return ng(res, 'そのセット名は既に存在します');
    ng(res, e.message, 500);
  }
});

app.put('/api/pamphlet-sets/:id', async (req, res) => {
  try {
    const { set_name, product_codes } = req.body;
    if (!set_name) return ng(res, 'セット名は必須です');
    if (!product_codes || product_codes.length === 0) return ng(res, '商品を1つ以上選択してください');
    const codesJson = JSON.stringify(product_codes);
    await dbRun(`UPDATE pamphlet_sets SET set_name=?, product_codes=?, updated_at=datetime('now','localtime') WHERE id=?`,
      [set_name.trim(), codesJson, req.params.id]);
    ok(res, null, 'おすすめセットを更新しました');
  } catch(e) {
    if (e.message.includes('UNIQUE')) return ng(res, 'そのセット名は既に存在します');
    ng(res, e.message, 500);
  }
});

app.delete('/api/pamphlet-sets/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM pamphlet_sets WHERE id=?', [req.params.id]);
    ok(res, null, 'おすすめセットを削除しました');
  } catch(e) { ng(res, e.message, 500); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
