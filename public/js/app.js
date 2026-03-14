'use strict';

// ===== 状態管理 =====
let allProducts = [];
let allCategories = [];
let currentEditCode = null;
let pamphletSelected = []; // { product_code, product_name }
let pamphletAllProducts = [];
let allPamphletSets = [];
let editingSetId = null; // おすすめセット編集中のID

// ===== ページ切替 =====
const pages = ['list', 'register', 'detail', 'pamphlet', 'preview', 'category', 'csv-import', 'pamphlet-sets'];
function showPage(name) {
  pages.forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.toggle('d-none', p !== name);
  });
  if (name === 'list') loadProducts();
  if (name === 'register') { clearRegisterForm(); populateCategorySelects(); }
  if (name === 'pamphlet') { loadPamphletPage(); }
  if (name === 'category') loadCategories();
  if (name === 'csv-import') resetCsvImport();
  if (name === 'pamphlet-sets') loadPamphletSetsPage();
}

// ===== API共通 =====
async function api(method, url, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return await res.json();
}

// ===== Toast通知 =====
function showToast(msg, type = 'success') {
  document.getElementById('toast-body').textContent = msg;
  const toast = document.getElementById('app-toast');
  toast.className = `toast border-${type === 'success' ? 'success' : 'danger'}`;
  new bootstrap.Toast(toast, { delay: 3000 }).show();
}

function showAlert(elId, msg, type = 'danger') {
  const el = document.getElementById(elId);
  if (el) {
    el.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show py-2 small" role="alert">
      ${msg}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
  }
}

// ===== カテゴリ =====
async function loadCategories() {
  const res = await api('GET', '/api/categories');
  if (!res.success) return;
  allCategories = res.data;
  renderCategoryTable();
  populateCategorySelects();
}

function renderCategoryTable() {
  const tbody = document.getElementById('category-table-body');
  if (!allCategories.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">カテゴリがありません</td></tr>';
    return;
  }
  tbody.innerHTML = allCategories.map(c => `
    <tr>
      <td><input type="text" class="form-control form-control-sm" id="cat-edit-name-${c.id}" value="${esc(c.category_name)}"></td>
      <td style="width:100px"><input type="number" class="form-control form-control-sm" id="cat-edit-order-${c.id}" value="${c.sort_order || ''}"></td>
      <td class="text-center" style="width:130px">
        <button class="btn btn-outline-primary btn-sm" onclick="updateCategory(${c.id})"><i class="bi bi-save"></i></button>
        <button class="btn btn-outline-danger btn-sm" onclick="deleteCategory(${c.id}, '${esc(c.category_name)}')"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('');
}

function populateCategorySelects() {
  ['filter-category', 'reg-category', 'edit-category'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isFilter = id === 'filter-category';
    const current = el.value;
    el.innerHTML = (isFilter ? '<option value="">全カテゴリ</option>' : '') +
      allCategories.map(c => `<option value="${c.id}">${esc(c.category_name)}</option>`).join('');
    if (current) el.value = current;
  });
}

async function addCategory() {
  const name = document.getElementById('cat-name').value.trim();
  const order = document.getElementById('cat-order').value;
  if (!name) return showAlert('cat-alert', 'カテゴリ名を入力してください');
  const res = await api('POST', '/api/categories', { category_name: name, sort_order: order || null });
  if (!res.success) return showAlert('cat-alert', res.message);
  document.getElementById('cat-name').value = '';
  document.getElementById('cat-order').value = '';
  document.getElementById('cat-alert').innerHTML = '';
  showToast('カテゴリを追加しました');
  loadCategories();
}

async function updateCategory(id) {
  const name = document.getElementById(`cat-edit-name-${id}`).value.trim();
  const order = document.getElementById(`cat-edit-order-${id}`).value;
  if (!name) return showToast('カテゴリ名を入力してください', 'danger');
  const res = await api('PUT', `/api/categories/${id}`, { category_name: name, sort_order: order || null });
  if (!res.success) return showToast(res.message, 'danger');
  showToast('カテゴリを更新しました');
  loadCategories();
}

async function deleteCategory(id, name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  const res = await api('DELETE', `/api/categories/${id}`);
  if (!res.success) return showToast(res.message, 'danger');
  showToast('カテゴリを削除しました');
  loadCategories();
}

// ===== 商品一覧 =====
async function loadProducts() {
  if (!allCategories.length) await loadCategories();
  const keyword = document.getElementById('filter-keyword')?.value || '';
  const categoryId = document.getElementById('filter-category')?.value || '';
  const params = new URLSearchParams();
  if (keyword) params.set('keyword', keyword);
  if (categoryId) params.set('category_id', categoryId);
  const res = await api('GET', `/api/products?${params}`);
  if (!res.success) return;
  allProducts = res.data;
  renderProductTable();
}

function renderProductTable() {
  const tbody = document.getElementById('product-table-body');
  const count = document.getElementById('product-count');
  if (!allProducts.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5 text-muted"><i class="bi bi-inbox fs-2 d-block mb-2"></i>商品がありません</td></tr>';
    count.textContent = '';
    return;
  }
  count.textContent = `${allProducts.length}件`;
  tbody.innerHTML = allProducts.map(p => `
    <tr style="cursor:pointer" onclick="openDetail('${esc(p.product_code)}')">
      <td><span class="badge bg-secondary">${esc(p.product_code)}</span></td>
      <td class="fw-semibold">${esc(p.product_name)}</td>
      <td><span class="badge bg-light text-dark border">${esc(p.category_name || '−')}</span></td>
      <td class="text-end">¥${Number(p.price).toLocaleString()}</td>
      <td class="text-muted small">${esc(p.volume || '−')}</td>
      <td class="text-muted small font-monospace">${esc(p.jan_code || '−')}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation();openDetail('${esc(p.product_code)}')"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation();confirmDelete('${esc(p.product_code)}','${esc(p.product_name)}')"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('');
}

function clearFilter() {
  document.getElementById('filter-keyword').value = '';
  document.getElementById('filter-category').value = '';
  loadProducts();
}

// ===== 商品登録 =====
function clearRegisterForm() {
  ['reg-code', 'reg-name', 'reg-price', 'reg-volume', 'reg-jan', 'reg-description'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('register-alert').innerHTML = '';
}

async function registerProduct() {
  const body = {
    product_code: document.getElementById('reg-code').value.trim(),
    product_name: document.getElementById('reg-name').value.trim(),
    category_id: document.getElementById('reg-category').value,
    price: document.getElementById('reg-price').value,
    description: document.getElementById('reg-description').value.trim(),
    volume: document.getElementById('reg-volume').value.trim(),
    jan_code: document.getElementById('reg-jan').value.trim(),
  };
  const res = await api('POST', '/api/products', body);
  if (!res.success) return showAlert('register-alert', res.message);
  showToast('商品を登録しました！');
  showPage('list');
}

// ===== 商品詳細・編集 =====
async function openDetail(code) {
  if (!allCategories.length) await loadCategories();
  const res = await api('GET', `/api/products/${code}`);
  if (!res.success) return showToast(res.message, 'danger');
  const p = res.data;
  currentEditCode = code;
  document.getElementById('edit-code').value = p.product_code;
  document.getElementById('edit-name').value = p.product_name;
  document.getElementById('edit-price').value = p.price;
  document.getElementById('edit-volume').value = p.volume || '';
  document.getElementById('edit-jan').value = p.jan_code || '';
  document.getElementById('edit-description').value = p.description || '';
  document.getElementById('detail-alert').innerHTML = '';
  document.getElementById('detail-timestamps').textContent = `作成: ${p.created_at}　最終更新: ${p.updated_at}`;
  populateCategorySelects();
  document.getElementById('edit-category').value = p.category_id;

  // 画像
  const img = document.getElementById('detail-image');
  const placeholder = document.getElementById('detail-image-placeholder');
  if (p.image_path) {
    img.src = p.image_path;
    img.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    img.style.display = 'none';
    placeholder.style.display = 'flex';
  }
  document.getElementById('upload-msg').textContent = '';

  showPage('detail');
}

async function updateProduct() {
  const body = {
    product_name: document.getElementById('edit-name').value.trim(),
    category_id: document.getElementById('edit-category').value,
    price: document.getElementById('edit-price').value,
    description: document.getElementById('edit-description').value.trim(),
    volume: document.getElementById('edit-volume').value.trim(),
    jan_code: document.getElementById('edit-jan').value.trim(),
  };
  const res = await api('PUT', `/api/products/${currentEditCode}`, body);
  if (!res.success) return showAlert('detail-alert', res.message);
  showToast('商品を更新しました');
}

async function uploadImage() {
  const file = document.getElementById('image-upload').files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('image', file);
  const res = await fetch(`/api/products/${currentEditCode}/upload-image`, { method: 'POST', body: formData });
  const data = await res.json();
  if (!data.success) return document.getElementById('upload-msg').innerHTML = `<span class="text-danger">${data.message}</span>`;
  const img = document.getElementById('detail-image');
  img.src = data.data.image_path + '?t=' + Date.now();
  img.style.display = 'block';
  document.getElementById('detail-image-placeholder').style.display = 'none';
  document.getElementById('upload-msg').innerHTML = '<span class="text-success">アップロード完了</span>';
  showToast('画像をアップロードしました');
}

// ===== 削除 =====
function confirmDelete(code, name) {
  document.getElementById('delete-modal-body').textContent = `「${name}」を削除しますか？`;
  const btn = document.getElementById('confirm-delete-btn');
  btn.onclick = async () => {
    const res = await api('DELETE', `/api/products/${code}`);
    bootstrap.Modal.getInstance(document.getElementById('deleteModal'))?.hide();
    if (!res.success) return showToast(res.message, 'danger');
    showToast('商品を削除しました');
    if (!document.getElementById('page-list').classList.contains('d-none')) {
      loadProducts();
    } else {
      showPage('list');
    }
  };
  new bootstrap.Modal(document.getElementById('deleteModal')).show();
}

async function deleteProduct() {
  confirmDelete(currentEditCode, document.getElementById('edit-name').value);
}

// ===== パンフレット選択 =====
async function loadPamphletPage() {
  if (!allCategories.length) await loadCategories();
  const res = await api('GET', '/api/products');
  if (res.success) {
    pamphletAllProducts = res.data;
    renderPamphletProductList(pamphletAllProducts);
  }
  // おすすめセット読み込み
  const setsRes = await api('GET', '/api/pamphlet-sets');
  if (setsRes.success) {
    allPamphletSets = setsRes.data;
    renderPamphletSetButtons();
  }
  renderSelectedList();
}

function filterPamphletList() {
  const q = document.getElementById('pamphlet-filter').value.toLowerCase();
  const filtered = pamphletAllProducts.filter(p =>
    p.product_name.toLowerCase().includes(q) || p.product_code.toLowerCase().includes(q)
  );
  renderPamphletProductList(filtered);
}

function renderPamphletProductList(products) {
  const el = document.getElementById('pamphlet-product-list');
  if (!products.length) {
    el.innerHTML = '<div class="text-muted p-2 small">商品がありません</div>';
    return;
  }
  el.innerHTML = products.map(p => {
    const isSelected = pamphletSelected.some(s => s.product_code === p.product_code);
    return `<div class="pamphlet-product-item ${isSelected ? 'selected' : ''}" onclick="togglePamphletSelect('${esc(p.product_code)}','${esc(p.product_name)}')">
      <div class="fw-semibold">${esc(p.product_name)}</div>
      <div class="text-muted" style="font-size:0.78rem">${esc(p.product_code)} | ${esc(p.category_name || '')} | ¥${Number(p.price).toLocaleString()}</div>
    </div>`;
  }).join('');
}

// ===== 全選択・全解除 =====
function selectAllPamphlet() {
  const q = document.getElementById('pamphlet-filter').value.toLowerCase();
  const targets = q
    ? pamphletAllProducts.filter(p =>
        p.product_name.toLowerCase().includes(q) || p.product_code.toLowerCase().includes(q))
    : pamphletAllProducts;
  targets.forEach(p => {
    if (!pamphletSelected.some(s => s.product_code === p.product_code)) {
      pamphletSelected.push({ product_code: p.product_code, product_name: p.product_name });
    }
  });
  renderSelectedList();
  renderPamphletProductList(targets);
}

function deselectAllPamphlet() {
  pamphletSelected = [];
  renderSelectedList();
  filterPamphletList();
}

function togglePamphletSelect(code, name) {
  const idx = pamphletSelected.findIndex(s => s.product_code === code);
  if (idx >= 0) {
    pamphletSelected.splice(idx, 1);
  } else {
    pamphletSelected.push({ product_code: code, product_name: name });
  }
  renderSelectedList();
  const q = document.getElementById('pamphlet-filter').value.toLowerCase();
  renderPamphletProductList(pamphletAllProducts.filter(p =>
    p.product_name.toLowerCase().includes(q) || p.product_code.toLowerCase().includes(q)
  ));
}

function renderSelectedList() {
  const el = document.getElementById('selected-products-list');
  document.getElementById('selected-count').textContent = pamphletSelected.length;
  if (!pamphletSelected.length) {
    el.innerHTML = '<div class="text-muted p-2">商品が選択されていません</div>';
    return;
  }
  el.innerHTML = pamphletSelected.map((s, i) => `
    <div class="selected-item">
      <span class="badge bg-primary">${i + 1}</span>
      <span class="flex-grow-1">${esc(s.product_name)}</span>
      <span class="text-muted small">${esc(s.product_code)}</span>
      <button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="togglePamphletSelect('${esc(s.product_code)}','${esc(s.product_name)}')"><i class="bi bi-x"></i></button>
    </div>`).join('');
}

// ===== おすすめセットボタン表示 =====
function renderPamphletSetButtons() {
  const el = document.getElementById('pamphlet-set-buttons');
  if (!el) return;
  if (!allPamphletSets.length) {
    el.innerHTML = '<div class="text-muted small">おすすめセットがまだありません。<a href="#" onclick="showPage(\'pamphlet-sets\')">管理画面</a>で登録してください。</div>';
    return;
  }
  el.innerHTML = allPamphletSets.map(s => `
    <button class="btn btn-outline-warning btn-sm" onclick="applyPamphletSet(${s.id})">
      <i class="bi bi-star-fill me-1"></i>${esc(s.set_name)}
    </button>`).join('');
}

function applyPamphletSet(id) {
  const set = allPamphletSets.find(s => s.id === id);
  if (!set) return;
  let codes;
  try { codes = JSON.parse(set.product_codes); } catch(e) { return; }
  pamphletSelected = [];
  codes.forEach(code => {
    const p = pamphletAllProducts.find(p => p.product_code === code);
    if (p) pamphletSelected.push({ product_code: p.product_code, product_name: p.product_name });
  });
  renderSelectedList();
  filterPamphletList();
  showToast(`「${set.set_name}」を適用しました`);
}

// ===== パンフレット生成 =====
async function generatePamphlet() {
  if (!pamphletSelected.length) return showToast('商品を選択してください', 'danger');
  const codes = pamphletSelected.map(s => s.product_code);
  const res = await api('POST', '/api/pamphlet', { codes });
  if (!res.success) return showToast(res.message, 'danger');
  const itemsPerPage = parseInt(document.getElementById('items-per-page').value) || 6;
  renderPamphletPreview(res.data, itemsPerPage);
  showPage('preview');
}

function renderPamphletPreview(products, itemsPerPage = 6) {
  const area = document.getElementById('pamphlet-preview-area');
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const ITEMS_PER_PAGE = itemsPerPage;

  const pamphletPages = [];
  for (let i = 0; i < products.length; i += ITEMS_PER_PAGE) {
    pamphletPages.push(products.slice(i, i + ITEMS_PER_PAGE));
  }

  function makeItemHtml(p) {
    const tax = Math.round(p.price * 1.1);
    const imgHtml = p.image_path
      ? `<img src="${p.image_path}" alt="${esc(p.product_name)}" class="pamphlet-item-image">`
      : `<div class="pamphlet-item-image-placeholder"><i class="bi bi-image"></i></div>`;
    return `
      <div class="pamphlet-item">
        ${imgHtml}
        <div class="pamphlet-item-body">
          <div class="pamphlet-code-badge mb-1">${esc(p.product_code)}</div>
          <div class="pamphlet-item-name">${esc(p.product_name)}</div>
          ${p.volume ? `<div class="pamphlet-item-volume">${esc(p.volume)}</div>` : ''}
          <div class="pamphlet-item-price">
            ¥${Number(p.price).toLocaleString()} <span style="font-size:0.75rem;color:#888">（税込 ¥${tax.toLocaleString()}）</span>
          </div>
          ${p.description ? `<div class="pamphlet-item-desc">${esc(p.description)}</div>` : ''}
        </div>
      </div>`;
  }

  // 1ページあたりの件数から列数を決定（全ページ統一）
  const cols = itemsPerPage <= 6 ? 2 : 3;
  const gridClass = `pamphlet-grid pamphlet-grid-${cols}col`;

  const pagesHtml = pamphletPages.map((pageProducts, pageIndex) => {
    const itemsHtml = pageProducts.map(makeItemHtml).join('');
    const pageLabel = pamphletPages.length > 1 ? `（${pageIndex + 1}ページ / 全${pamphletPages.length}ページ）` : '';
    return `
      <div class="pamphlet-page" data-cols="${cols}">
        <div class="pamphlet-header d-flex justify-content-between align-items-end">
          <div>
            <div class="text-muted small mb-1">商品情報 ${pageLabel}</div>
            <div class="pamphlet-title">商品パンフレット</div>
          </div>
          <div class="text-muted small">${today}</div>
        </div>
        <div class="${gridClass}">
          ${itemsHtml}
        </div>
        <div class="mt-4 pt-3 border-top text-muted" style="font-size:0.72rem">
          ※ 価格は税抜き定価です。税込価格は消費税10%で計算しています。
        </div>
      </div>`;
  }).join('');

  area.innerHTML = pagesHtml;
}

function printPamphlet() {
  window.print();
}

// ===== おすすめセット管理画面 =====
async function loadPamphletSetsPage() {
  if (!allCategories.length) await loadCategories();
  const res = await api('GET', '/api/products');
  if (res.success) pamphletAllProducts = res.data;
  const setsRes = await api('GET', '/api/pamphlet-sets');
  if (setsRes.success) allPamphletSets = setsRes.data;
  renderPamphletSetsTable();
  renderSetProductCheckboxes();
  editingSetId = null;
  document.getElementById('set-name-input').value = '';
  document.getElementById('set-alert').innerHTML = '';
  document.getElementById('set-save-btn').textContent = '保存する';
}

function renderPamphletSetsTable() {
  const tbody = document.getElementById('pamphlet-sets-tbody');
  if (!allPamphletSets.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">おすすめセットがありません</td></tr>';
    return;
  }
  tbody.innerHTML = allPamphletSets.map(s => {
    let codes = [];
    try { codes = JSON.parse(s.product_codes); } catch(e) {}
    const names = codes.map(code => {
      const p = pamphletAllProducts.find(p => p.product_code === code);
      return p ? esc(p.product_name) : `(${esc(code)})`;
    }).join('、');
    return `<tr>
      <td class="fw-semibold">${esc(s.set_name)}</td>
      <td class="small text-muted">${names || '−'}</td>
      <td class="text-center" style="white-space:nowrap">
        <button class="btn btn-outline-primary btn-sm me-1" onclick="editPamphletSet(${s.id})"><i class="bi bi-pencil"></i> 編集</button>
        <button class="btn btn-outline-danger btn-sm" onclick="deletePamphletSet(${s.id}, '${esc(s.set_name)}')"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function renderSetProductCheckboxes() {
  const el = document.getElementById('set-product-checkboxes');
  if (!pamphletAllProducts.length) {
    el.innerHTML = '<div class="text-muted small">商品がありません</div>';
    return;
  }
  el.innerHTML = pamphletAllProducts.map(p => `
    <div class="form-check">
      <input class="form-check-input set-product-check" type="checkbox" value="${esc(p.product_code)}" id="set-chk-${esc(p.product_code)}">
      <label class="form-check-label small" for="set-chk-${esc(p.product_code)}">
        <span class="fw-semibold">${esc(p.product_name)}</span>
        <span class="text-muted ms-1">(${esc(p.product_code)})</span>
      </label>
    </div>`).join('');
}

function editPamphletSet(id) {
  const set = allPamphletSets.find(s => s.id === id);
  if (!set) return;
  editingSetId = id;
  document.getElementById('set-name-input').value = set.set_name;
  let codes = [];
  try { codes = JSON.parse(set.product_codes); } catch(e) {}
  document.querySelectorAll('.set-product-check').forEach(chk => {
    chk.checked = codes.includes(chk.value);
  });
  document.getElementById('set-save-btn').textContent = '更新する';
  document.getElementById('set-alert').innerHTML = '';
  document.getElementById('set-name-input').scrollIntoView({ behavior: 'smooth' });
}

async function savePamphletSet() {
  const name = document.getElementById('set-name-input').value.trim();
  const codes = Array.from(document.querySelectorAll('.set-product-check:checked')).map(c => c.value);
  if (!name) return showAlert('set-alert', 'セット名を入力してください');
  if (!codes.length) return showAlert('set-alert', '商品を1つ以上選択してください');

  let res;
  if (editingSetId) {
    res = await api('PUT', `/api/pamphlet-sets/${editingSetId}`, { set_name: name, product_codes: codes });
  } else {
    res = await api('POST', '/api/pamphlet-sets', { set_name: name, product_codes: codes });
  }
  if (!res.success) return showAlert('set-alert', res.message);
  showToast(editingSetId ? 'おすすめセットを更新しました' : 'おすすめセットを登録しました');
  editingSetId = null;
  document.getElementById('set-name-input').value = '';
  document.getElementById('set-save-btn').textContent = '保存する';
  document.querySelectorAll('.set-product-check').forEach(chk => chk.checked = false);
  document.getElementById('set-alert').innerHTML = '';
  const setsRes = await api('GET', '/api/pamphlet-sets');
  if (setsRes.success) allPamphletSets = setsRes.data;
  renderPamphletSetsTable();
}

function cancelSetEdit() {
  editingSetId = null;
  document.getElementById('set-name-input').value = '';
  document.getElementById('set-save-btn').textContent = '保存する';
  document.querySelectorAll('.set-product-check').forEach(chk => chk.checked = false);
  document.getElementById('set-alert').innerHTML = '';
}

async function deletePamphletSet(id, name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  const res = await api('DELETE', `/api/pamphlet-sets/${id}`);
  if (!res.success) return showToast(res.message, 'danger');
  showToast('おすすめセットを削除しました');
  const setsRes = await api('GET', '/api/pamphlet-sets');
  if (setsRes.success) allPamphletSets = setsRes.data;
  renderPamphletSetsTable();
}

// ===== ユーティリティ =====
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== CSV一括登録 =====
let csvFile = null;

function resetCsvImport() {
  csvFile = null;
  document.getElementById('csv-file-input').value = '';
  document.getElementById('csv-file-name').textContent = '';
  document.getElementById('csv-import-btn').disabled = true;
  document.getElementById('csv-result').classList.add('d-none');
  document.getElementById('csv-drop-area').style.background = '#f8fff8';
}

function handleCsvFileSelect(event) {
  const file = event.target.files[0];
  if (file) setCsvFile(file);
}

function handleCsvDrop(event) {
  event.preventDefault();
  document.getElementById('csv-drop-area').style.background = '#f8fff8';
  const file = event.dataTransfer.files[0];
  if (file) setCsvFile(file);
}

function setCsvFile(file) {
  if (!file.name.endsWith('.csv')) {
    showToast('CSVファイル（.csv）を選択してください', 'danger');
    return;
  }
  csvFile = file;
  document.getElementById('csv-file-name').innerHTML =
    `<i class="bi bi-file-earmark-spreadsheet text-success me-1"></i><strong>${esc(file.name)}</strong>（${(file.size/1024).toFixed(1)} KB）`;
  document.getElementById('csv-import-btn').disabled = false;
  document.getElementById('csv-result').classList.add('d-none');
}

async function importCsv() {
  if (!csvFile) return showToast('CSVファイルを選択してください', 'danger');

  const btn = document.getElementById('csv-import-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>登録中...';

  try {
    const formData = new FormData();
    formData.append('csv', csvFile);

    const res = await fetch('/api/products/import-csv', { method: 'POST', body: formData });
    const data = await res.json();

    btn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>登録する';
    btn.disabled = false;

    if (!data.success) {
      showToast(data.message, 'danger');
      return;
    }

    const { success, errors } = data.data;
    const resultDiv = document.getElementById('csv-result');
    resultDiv.classList.remove('d-none');

    document.getElementById('csv-result-summary').innerHTML = `
      <div class="d-flex gap-3 flex-wrap">
        <span class="badge bg-success fs-6 px-3 py-2"><i class="bi bi-check-circle me-1"></i>登録成功：${success.length}件</span>
        <span class="badge ${errors.length > 0 ? 'bg-danger' : 'bg-secondary'} fs-6 px-3 py-2">
          <i class="bi bi-exclamation-triangle me-1"></i>エラー・スキップ：${errors.length}件
        </span>
      </div>`;

    const successArea = document.getElementById('csv-success-area');
    if (success.length > 0) {
      successArea.classList.remove('d-none');
      document.getElementById('csv-success-list').innerHTML =
        success.map(c => `<span class="badge bg-success me-1 mb-1">${esc(c)}</span>`).join('');
    } else {
      successArea.classList.add('d-none');
    }

    const errorArea = document.getElementById('csv-error-area');
    if (errors.length > 0) {
      errorArea.classList.remove('d-none');
      document.getElementById('csv-error-list').innerHTML =
        errors.map(e => `<div class="text-danger py-1 border-bottom"><i class="bi bi-x-circle me-1"></i>${esc(e)}</div>`).join('');
    } else {
      errorArea.classList.add('d-none');
    }

    if (success.length > 0) showToast(`${success.length}件の商品を登録しました`, 'success');

  } catch(e) {
    btn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>登録する';
    btn.disabled = false;
    showToast('通信エラーが発生しました', 'danger');
  }
}

function downloadCsvTemplate() {
  const header = '商品コード,商品名,カテゴリ,定価,内容量,JANコード,説明文';
  const sample = 'A001,サンプル商品A,食品,1200,500ml,,おいしい商品です\nB002,サンプル商品B,飲料,350,350ml,,';
  const bom = '\uFEFF';
  const blob = new Blob([bom + header + '\n' + sample], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = '商品登録テンプレート.csv';
  a.click(); URL.revokeObjectURL(url);
}

// ===== 初期化 =====
(async () => {
  await loadCategories();
  await loadProducts();
})();
