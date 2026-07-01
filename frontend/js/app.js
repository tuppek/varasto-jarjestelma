const API = "/api";

function viewMeta(view) {
  return { title: t(`view.${view}.title`), subtitle: t(`view.${view}.subtitle`) };
}

function statusLabel(status) {
  return t(`status.${status}`, status);
}

function fulfillmentLabel(type) {
  return t(`fulfillment.${type}`, type);
}

function serviceLabel(service) {
  return t(`service.${service}`, service);
}

function movementLabel(type) {
  return t(`movement.${type}`, type);
}

function stockBadgeLabel(low) {
  return low ? t("common.low") : t("common.ok");
}

function applyLanguageChange() {
  applyStaticI18n();
  const meta = viewMeta(currentView);
  document.getElementById("view-title").textContent = meta.title;
  document.getElementById("view-subtitle").textContent = meta.subtitle;
  if (currentEmployee) loadView(currentView);
}

function cameraBtnLabel(active) {
  return active ? t("scan.stopCamera") : t("scan.startCamera");
}

let products = [];
let customers = [];
let salesOrders = [];
let purchaseOrders = [];
let currentView = "dashboard";
let authToken = sessionStorage.getItem("authToken");
let currentEmployee = JSON.parse(sessionStorage.getItem("currentEmployee") || "null");
let ordersSearchTimer = null;
let ordersFulfillmentFilter = "";
let ordersList = [];
let customersSearchTimer = null;
let activeCamera = null;
let scanDebounceTimer = null;
let scanProcessing = false;

async function stopCamera() {
  if (!activeCamera) return;
  try {
    await activeCamera.html5QrCode.stop();
    activeCamera.html5QrCode.clear();
  } catch (_) {
    /* already stopped */
  }
  if (activeCamera.btn) activeCamera.btn.textContent = cameraBtnLabel(false);
  if (activeCamera.readerEl?.classList.contains("camera-reader-modal")) {
    activeCamera.readerEl.classList.add("hidden");
  }
  activeCamera = null;
}

async function toggleCameraFor(readerId, btnId, onDecode) {
  const btn = document.getElementById(btnId);
  const readerEl = document.getElementById(readerId);
  if (!btn || !readerEl) return;

  if (activeCamera?.readerId === readerId) {
    await stopCamera();
    return;
  }

  await stopCamera();

  if (typeof Html5Qrcode === "undefined") {
    showToast(t("toast.cameraLib"), "error");
    return;
  }

  if (readerEl.classList.contains("camera-reader-modal")) {
    readerEl.classList.remove("hidden");
  }
  const html5QrCode = new Html5Qrcode(readerId);
  try {
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      onDecode
    );
    activeCamera = { html5QrCode, btn, readerId, readerEl };
    btn.textContent = cameraBtnLabel(true);
  } catch (err) {
    if (readerEl.classList.contains("camera-reader-modal")) {
      readerEl.classList.add("hidden");
    }
    showToast(t("toast.cameraError", { msg: err.message }), "error");
  }
}

async function toggleScanViewCamera() {
  await toggleCameraFor("camera-reader", "camera-toggle-btn", async (decoded) => {
    document.getElementById("scan-input").value = decoded;
    await handleScanSearch();
  });
}

function resetScanView() {
  clearTimeout(scanDebounceTimer);
  scanProcessing = false;
  const input = document.getElementById("scan-input");
  if (input) {
    input.value = "";
    input.focus();
  }
  const result = document.getElementById("scan-result");
  if (result) result.innerHTML = "";
}

function setupAutoScanInput(inputEl, onScan) {
  if (!inputEl || inputEl.dataset.autoScanBound) return;
  inputEl.dataset.autoScanBound = "1";
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onScan();
    }
  });
  inputEl.addEventListener("input", () => {
    clearTimeout(scanDebounceTimer);
    if (!inputEl.value.trim()) return;
    scanDebounceTimer = setTimeout(onScan, 200);
  });
}

async function processOrderScan(sku) {
  const scanInput = document.getElementById("so-scan");
  const code = (sku || scanInput?.value || "").trim();
  if (!code) return;
  await handleProductScan(
    code,
    (p) => {
      addProductToOrderLine(p.id);
      if (scanInput) scanInput.value = "";
      showToast(`Lisätty: ${p.name}`);
    },
    (unknownSku) => {
      openUnknownProductModal(unknownSku, "order", (product) => {
        addProductToOrderLine(product.id);
        if (scanInput) scanInput.value = "";
        showToast(`Lisätty: ${product.name}`);
      });
    }
  );
}

async function toggleOrderScanCamera() {
  await toggleCameraFor("so-camera-reader", "so-camera-toggle-btn", async (decoded) => {
    const scanInput = document.getElementById("so-scan");
    if (scanInput) scanInput.value = decoded;
    try {
      await processOrderScan(decoded);
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API}${path}`, { ...options, headers });
  let data = {};
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (res.status === 401 && path !== "/auth/login") {
    logout(false);
    throw new Error(data.detail || t("toast.sessionExpired"));
  }
  if (!res.ok) {
    const msg = typeof data.detail === "string"
      ? data.detail
      : Array.isArray(data.detail)
        ? data.detail.map((d) => d.msg || JSON.stringify(d)).join(", ")
        : data.message || `Pyyntö epäonnistui (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add("hidden"), 3500);
}

function formatDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(getLocale());
}

function formatDateOnly(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(getLocale());
}

function statusBadge(status) {
  const cls = ["toimitettu", "vastaanotettu"].includes(status)
    ? "done"
    : status === "peruttu"
      ? "cancel"
      : "status";
  return `<span class="badge ${cls}">${statusLabel(status)}</span>`;
}

function fulfillmentBadge(type) {
  return `<span class="badge status">${fulfillmentLabel(type)}</span>`;
}

function orderServicesMeta(order) {
  const summary = order.services_summary?.trim();
  if (summary) return escapeHtml(summary);
  if (order.fulfillment_type) return fulfillmentBadge(order.fulfillment_type);
  return "";
}

function orderMeta(order) {
  const parts = [];
  if (order.fulfillment_type) {
    parts.push(`${fulfillmentLabel(order.fulfillment_type)}: ${formatDateOnly(order.scheduled_date)}`);
  }
  if (order.created_by_name) parts.push(t("order.createdBy", { name: order.created_by_name }));
  return parts.join(" · ");
}

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

let deferredInstallPrompt = null;

function initPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const banner = document.getElementById("install-banner");
  const installBtn = document.getElementById("install-app-btn");
  const bannerText = document.getElementById("install-banner-text");
  if (!banner) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn) installBtn.classList.remove("hidden");
    if (bannerText) {
      bannerText.innerHTML = t("login.installPrompt");
    }
    banner.classList.remove("hidden");
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installBtn.classList.add("hidden");
    });
  }

  if (!isStandaloneApp() && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    banner.classList.remove("hidden");
  }
}

function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("main-app").classList.remove("hidden");
  document.getElementById("current-user").textContent = `${currentEmployee.name} (#${currentEmployee.employee_number})`;
}

function showLogin(error = "") {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("main-app").classList.add("hidden");
  const errEl = document.getElementById("login-error");
  if (error) {
    errEl.textContent = error;
    errEl.classList.remove("hidden");
  } else {
    errEl.classList.add("hidden");
  }
}

async function login(employeeNumber) {
  const result = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ employee_number: employeeNumber }),
  });
  authToken = result.token;
  currentEmployee = result.employee;
  sessionStorage.setItem("authToken", authToken);
  sessionStorage.setItem("currentEmployee", JSON.stringify(currentEmployee));
  showApp();
  await refreshAll();
}

function logout(notify = true) {
  authToken = null;
  currentEmployee = null;
  sessionStorage.removeItem("authToken");
  sessionStorage.removeItem("currentEmployee");
  showLogin();
  if (notify) showToast(t("toast.loggedOut"));
}

function switchView(view) {
  if (view !== "scan" && activeCamera?.readerId === "camera-reader") {
    stopCamera();
  }
  currentView = view;
  document.querySelectorAll(".menu-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  const meta = viewMeta(view);
  document.getElementById("view-title").textContent = meta.title;
  document.getElementById("view-subtitle").textContent = meta.subtitle;
  loadView(view);
}

async function loadView(view) {
  try {
    if (view === "dashboard") await renderDashboard();
    if (view === "inventory") await renderInventory();
    if (view === "scan") await renderScan();
    if (view === "customers") await renderCustomers();
    if (view === "orders") await renderOrders();
    if (view === "purchases") await renderPurchases();
    if (view === "movements") await renderMovements();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function refreshAll() {
  products = await api("/products");
  customers = await api("/customers");
  salesOrders = await api("/sales-orders");
  purchaseOrders = await api("/purchase-orders");
  await loadView(currentView);
  if (currentView !== "orders" && currentView !== "customers") showToast(t("toast.dataUpdated"));
}

function productUnitCost(product) {
  const purchase = Number(product.purchase_price);
  const sale = Number(product.sale_price);
  if (Number.isFinite(purchase) && purchase > 0) return purchase;
  if (Number.isFinite(sale) && sale > 0) return sale;
  return 0;
}

function calcInventoryValue(productList) {
  return productList.reduce(
    (sum, product) => sum + (product.quantity_on_hand || 0) * productUnitCost(product),
    0
  );
}

async function renderDashboard() {
  const [stats, productList] = await Promise.all([api("/dashboard"), api("/products")]);
  products = productList;
  const inventoryTotal = calcInventoryValue(productList);
  document.getElementById("stats-grid").innerHTML = `
    <div class="stat-card"><div class="label">${t("dashboard.statProducts")}</div><div class="value">${stats.product_count}</div></div>
    <div class="stat-card info"><div class="label">${t("dashboard.statValue")}</div><div class="value">${formatPrice(inventoryTotal)}</div></div>
    <div class="stat-card"><div class="label">${t("dashboard.statOrdered")}</div><div class="value">${stats.total_ordered}</div></div>
    <div class="stat-card warning"><div class="label">${t("dashboard.statReserved")}</div><div class="value">${stats.total_reserved}</div></div>
    <div class="stat-card warning"><div class="label">${t("dashboard.statLow")}</div><div class="value">${stats.low_stock_count}</div></div>
    <div class="stat-card"><div class="label">${t("dashboard.statOpenOrders")}</div><div class="value">${stats.pending_sales_orders}</div></div>
  `;

  document.getElementById("dashboard-summary").innerHTML = `
    <div class="summary-row"><span>${t("dashboard.orderedIncoming")}</span><strong>${stats.total_ordered} ${t("common.pcs")}</strong></div>
    <div class="summary-row"><span>${t("dashboard.reservedSales")}</span><strong>${stats.total_reserved} ${t("common.pcs")}</strong></div>
    <div class="summary-row"><span>${t("dashboard.openPurchases")}</span><strong>${stats.pending_purchase_orders}</strong></div>
  `;

  if (stats.low_stock_count === 0) {
    document.getElementById("dashboard-alerts").innerHTML =
      `<p class="hint">${t("dashboard.allAboveMin")}</p>`;
  } else {
    products = await api("/products");
    const low = products.filter((p) => p.quantity_available <= p.min_stock_level);
    document.getElementById("dashboard-alerts").innerHTML = low
      .map(
        (p) =>
          `<div class="alert-item"><strong>${escapeHtml(p.name)}</strong> (${escapeHtml(p.sku)}): ${t("product.labelFree")} ${p.quantity_available}, ${t("common.minimum").toLowerCase()} ${p.min_stock_level}</div>`
      )
      .join("");
  }
}

async function renderInventory() {
  products = await api("/products");
  const query = document.getElementById("inventory-search").value.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (!query) return true;
    return [p.name, p.sku, p.manufacturer, p.wholesaler, p.description, p.shelf_location]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(query));
  });

  document.getElementById("inventory-table").innerHTML = filtered.length
    ? filtered
        .map((p) => {
          const low = p.quantity_available <= p.min_stock_level;
          return `<tr class="clickable-row" onclick="openProductDetailModal(${p.id})" title="${t("common.showDetails")}">
            <td>${p.sku}</td>
            <td>${p.name}</td>
            <td>${p.shelf_location ? escapeHtml(p.shelf_location) : "-"}</td>
            <td><strong>${p.quantity_on_hand}</strong></td>
            <td>${p.quantity_ordered}</td>
            <td>${p.quantity_reserved}</td>
            <td>${p.quantity_available}</td>
            <td>${p.min_stock_level}</td>
            <td><span class="badge ${low ? "low" : "ok"}">${stockBadgeLabel(low)}</span></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="9" class="empty-state">${products.length ? t("products.noResults") : t("inventory.empty")}</td></tr>`;
}

function toInputDate(iso) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

function setupServicePicker(prefix) {
  document.querySelectorAll(`input[name="${prefix}-service"]`).forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.value === "nouto" && cb.checked) {
        const delivery = document.querySelector(`input[name="${prefix}-service"][value="toimitus"]`);
        if (delivery) delivery.checked = false;
      }
      if (cb.value === "toimitus" && cb.checked) {
        const pickup = document.querySelector(`input[name="${prefix}-service"][value="nouto"]`);
        if (pickup) pickup.checked = false;
      }
      updateOrderDateLabel(prefix);
    });
  });
  updateOrderDateLabel(prefix);
}

function updateOrderDateLabel(prefix) {
  const label = document.getElementById(`${prefix}-date-label`);
  if (!label) return;
  const isPickup = document.querySelector(`input[name="${prefix}-service"][value="nouto"]`)?.checked;
  label.textContent = isPickup ? t("orders.pickupDate") : t("orders.deliveryDate");
}

function fulfillmentFromServices(services) {
  return services.includes("nouto") ? "nouto" : "toimitus";
}

function normalizeOrderServices(order) {
  const svcs = [...(order.services || [])].map((s) => (s === "kuljetus" ? "toimitus" : s));
  if (order.fulfillment_type === "nouto" && !svcs.includes("nouto")) {
    svcs.push("nouto");
  }
  if (!svcs.includes("toimitus") && !svcs.includes("nouto") && svcs.length === 0) {
    svcs.push("toimitus");
  }
  return svcs;
}

function orderActionButtons(order) {
  const btns = [];
  btns.push(`<button class="btn btn-secondary btn-sm" onclick="openOrderTimeline(${order.id})">${t("orders.timeline")}</button>`);
  if (!["toimitettu", "peruttu"].includes(order.status)) {
    btns.push(`<button class="btn btn-secondary btn-sm" onclick="openEditOrderModal(${order.id})">${t("common.edit")}</button>`);
  }
  if (order.status === "vastaanotettu") {
    btns.push(`<button class="btn btn-success btn-sm" onclick="approveSalesOrder(${order.id})">${t("orders.approve")}</button>`);
    btns.push(`<button class="btn btn-danger btn-sm" onclick="cancelSalesOrder(${order.id})">${t("orders.cancel")}</button>`);
  }
  if (["hyvaksytty", "osittain_toimitettu"].includes(order.status)) {
    const label = order.fulfillment_type === "nouto" ? t("orders.pickup") : t("orders.deliver");
    btns.push(`<button class="btn btn-primary btn-sm" onclick="openDeliverModal(${order.id})">${label}</button>`);
  }
  return btns.length ? `<div class="action-buttons">${btns.join("")}</div>` : "-";
}

async function renderOrders() {
  salesOrders = await api("/sales-orders");
  const q = document.getElementById("orders-search").value.trim();
  let path = "/orders";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (ordersFulfillmentFilter) params.set("fulfillment", ordersFulfillmentFilter);
  if ([...params].length) path += `?${params}`;

  ordersList = await api(path);

  document.getElementById("orders-table").innerHTML = ordersList.length
    ? ordersList
        .map(
          (o) => `<tr>
            <td><span class="order-number">${o.order_number}</span></td>
            <td>${o.customer}</td>
            <td>${o.customer_phone || "-"}</td>
            <td>${o.product_summary}</td>
            <td>${o.services_summary || "-"}</td>
            <td>${fulfillmentBadge(o.fulfillment_type)}</td>
            <td>${formatDateOnly(o.scheduled_date)}</td>
            <td>${statusBadge(o.status)}</td>
            <td>${orderActionButtons(o)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="9" class="empty-state">${t("orders.empty")}</td></tr>`;
}

async function renderCustomers() {
  const q = document.getElementById("customers-search").value.trim();
  const path = q ? `/customers?q=${encodeURIComponent(q)}` : "/customers";
  customers = await api(path);

  document.getElementById("customers-table").innerHTML = customers.length
    ? customers
        .map(
          (c) => `<tr class="clickable-row" onclick="openCustomerDetailModal(${c.id})" title="${t("common.showDetails")}">
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.phone)}</td>
            <td>${c.email ? escapeHtml(c.email) : "-"}</td>
            <td>${c.address ? escapeHtml(c.address) : "-"}</td>
            <td onclick="event.stopPropagation()"><button class="btn btn-secondary btn-sm" onclick="openEditCustomerModal(${c.id})">${t("common.edit")}</button></td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="empty-state">${t("customers.empty")}</td></tr>`;
}

async function scanProductBySku(sku) {
  return api(`/products/scan?sku=${encodeURIComponent(sku.trim())}`);
}

async function lookupProductBySku(sku) {
  return api(`/products/lookup?sku=${encodeURIComponent(sku.trim())}`);
}

function servicesPickerHtml(prefix, selected = ["toimitus"]) {
  const sel = new Set(Array.isArray(selected) ? selected : normalizeOrderServices(selected));
  return `<div class="form-group"><label>${t("common.services")}</label>
    <div class="service-checkboxes">
      <label class="checkbox-label"><input type="checkbox" name="${prefix}-service" value="toimitus" ${sel.has("toimitus") ? "checked" : ""}> ${serviceLabel("toimitus")}</label>
      <label class="checkbox-label"><input type="checkbox" name="${prefix}-service" value="asennus" ${sel.has("asennus") ? "checked" : ""}> ${serviceLabel("asennus")}</label>
      <label class="checkbox-label"><input type="checkbox" name="${prefix}-service" value="nouto" ${sel.has("nouto") ? "checked" : ""}> ${serviceLabel("nouto")}</label>
    </div></div>`;
}

function getSelectedServices(prefix) {
  return [...document.querySelectorAll(`input[name="${prefix}-service"]:checked`)].map((cb) => cb.value);
}

function renderScanResult(product) {
  document.getElementById("scan-result").innerHTML = `
    <div class="scan-product-card">
      <h4>${escapeHtml(product.name)}</h4>
      <p class="order-meta">${t("common.sku")}: <strong>${escapeHtml(product.sku)}</strong></p>
      <p>${t("common.manufacturer")}: <strong>${product.manufacturer ? escapeHtml(product.manufacturer) : t("common.empty")}</strong> · ${t("common.wholesaler")}: <strong>${product.wholesaler ? escapeHtml(product.wholesaler) : t("common.empty")}</strong></p>
      <p>${t("common.onHand")}: <strong>${product.quantity_on_hand}</strong> · ${t("common.available")}: <strong>${product.quantity_available}</strong></p>
      <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem" onclick="openProductDetailModal(${product.id})">${t("common.details")}</button>
      <button class="btn btn-primary btn-sm" style="margin-top:0.5rem" onclick="openNewSalesModalWithProduct(${product.id})">${t("modal.addToOrderBtn")}</button>
    </div>`;
}

function renderUnknownScanResult(sku) {
  document.getElementById("scan-result").innerHTML = `
    <div class="scan-product-card scan-unknown">
      <h4>${t("scan.notFound")}</h4>
      <p class="order-meta">${t("scan.scannedCodeLabel")}: <strong>${sku}</strong></p>
      <p class="hint">${t("scan.notFoundHint")}</p>
      <button class="btn btn-primary btn-sm" style="margin-top:0.5rem" onclick="openUnknownProductModal('${sku.replace(/'/g, "\\'")}', 'scan')">${t("scan.saveToStock")}</button>
      <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem" onclick="openNewSalesModalWithSku('${sku.replace(/'/g, "\\'")}')">${t("scan.addToOrder")}</button>
    </div>`;
}

function openUnknownProductModal(sku, context, onSaved) {
  openModal(
    t("modal.saveNewProduct"),
    `<p>${t("scan.scannedCodeLabel")}: <strong>${sku}</strong></p>
     <div class="form-group"><label>${t("modal.productName")}</label><input id="uq-name"></div>
     <div class="form-group"><label>${t("modal.initialStock")}</label><input type="number" id="uq-qty" min="0" value="0"></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="saveUnknownProduct('${sku.replace(/'/g, "\\'")}', '${context}')">${t("common.save")}</button>`
  );
  window._unknownProductOnSaved = onSaved;
}

async function saveUnknownProduct(sku, context) {
  const name = document.getElementById("uq-name").value.trim();
  const qty = parseInt(document.getElementById("uq-qty").value, 10) || 0;
  if (!name) {
    showToast(t("toast.productNameRequired"), "error");
    return;
  }
  try {
    const product = await api("/products/quick", {
      method: "POST",
      body: JSON.stringify({ sku, name, quantity_on_hand: qty }),
    });
    products = await api("/products");
    closeModal();
    showToast(t("toast.productSaved", { name: product.name }));
    if (context === "scan") {
      openProductDetailModal(product.id);
    } else if (typeof window._unknownProductOnSaved === "function") {
      window._unknownProductOnSaved(product);
      window._unknownProductOnSaved = null;
    }
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleProductScan(sku, onFound, onNotFound) {
  const code = sku.trim();
  if (!code) return;
  const result = await scanProductBySku(code);
  if (result.found) {
    onFound(result.product);
  } else if (onNotFound) {
    onNotFound(result.sku);
  } else {
    openUnknownProductModal(result.sku, "order", (product) => onFound(product));
  }
}

function addProductToOrderLine(productId) {
  addLineRow("so-lines");
  const rows = document.querySelectorAll("#so-lines .line-row");
  const last = rows[rows.length - 1];
  last.querySelector(".line-product").value = productId;
}

async function handleScanSearch() {
  const input = document.getElementById("scan-input");
  const sku = input?.value.trim();
  if (!sku || scanProcessing) return;
  scanProcessing = true;
  clearTimeout(scanDebounceTimer);
  try {
    await handleProductScan(
      sku,
      (product) => {
        if (input) input.value = "";
        showToast(t("scan.found", { name: product.name }));
        openProductDetailModal(product.id);
      },
      (code) => {
        if (input) input.value = "";
        openUnknownProductModal(code, "scan");
      }
    );
  } catch (err) {
    const result = document.getElementById("scan-result");
    if (result) result.innerHTML = `<p class="login-error">${err.message}</p>`;
  } finally {
    scanProcessing = false;
    input?.focus();
  }
}

async function renderScan() {
  resetScanView();
  setupAutoScanInput(document.getElementById("scan-input"), handleScanSearch);
}

let customerSearchTimer = null;

function customerFieldHtml(prefix = "so") {
  return `<div class="form-group">
    <label>${t("common.customer")} *</label>
    <div class="autocomplete-wrap">
      <input type="text" id="${prefix}-customer" autocomplete="off" placeholder="${t("orders.customerSearch")}">
      <div id="${prefix}-customer-suggestions" class="autocomplete-list hidden"></div>
    </div>
    <input type="hidden" id="${prefix}-customer-id">
  </div>`;
}

function setupCustomerAutocomplete(prefix = "so") {
  const input = document.getElementById(`${prefix}-customer`);
  const list = document.getElementById(`${prefix}-customer-suggestions`);
  const idField = document.getElementById(`${prefix}-customer-id`);
  const phoneField = document.getElementById(`${prefix}-phone`);
  if (!input || !list) return;

  const hide = () => list.classList.add("hidden");
  const show = () => list.classList.remove("hidden");

  const selectCustomer = (c) => {
    input.value = c.name;
    if (phoneField) phoneField.value = c.phone;
    if (idField) idField.value = c.id;
    hide();
  };

  const renderSuggestions = (results) => {
    if (!results.length) {
      list.innerHTML = `<div class="autocomplete-empty">${t("orders.noCustomerMatches")}</div>`;
      show();
      return;
    }
    list.innerHTML = results
      .map(
        (c) =>
          `<button type="button" class="autocomplete-item" data-id="${c.id}">
            <strong>${escapeHtml(c.name)}</strong>
            <span>${escapeHtml(c.phone)}</span>
          </button>`
      )
      .join("");
    list.querySelectorAll(".autocomplete-item").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const c = results.find((x) => x.id === parseInt(btn.dataset.id, 10));
        if (c) selectCustomer(c);
      });
    });
    show();
  };

  const searchCustomers = async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      hide();
      return;
    }
    try {
      const results = await api(`/customers?q=${encodeURIComponent(q)}`);
      renderSuggestions(results);
    } catch (_) {
      hide();
    }
  };

  input.addEventListener("input", () => {
    if (idField) idField.value = "";
    clearTimeout(customerSearchTimer);
    customerSearchTimer = setTimeout(searchCustomers, 250);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 2) searchCustomers();
  });

  input.addEventListener("blur", () => {
    setTimeout(hide, 150);
  });
}

async function openOrderTimeline(orderId) {
  try {
    const events = await api(`/sales-orders/${orderId}/timeline`);
    const order = ordersList.find((o) => o.id === orderId) || salesOrders.find((o) => o.id === orderId);
    const html = events.length
      ? `<div class="timeline">${events
          .map(
            (e, i) => `<div class="timeline-item ${i < events.length - 1 ? "done" : ""}">
              <div class="label">${e.label}</div>
              <div class="time">${formatDate(e.created_at)}${e.employee_name ? " · " + e.employee_name : ""}</div>
            </div>`
          )
          .join("")}</div>`
      : `<p class="hint">${t("movements.empty")}</p>`;

    openModal(
      t("modal.timeline", { number: order?.order_number || orderId }),
      html,
      `<button class="btn btn-secondary" onclick="closeModal()">${t("common.close")}</button>`
    );
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openNewCustomerModal() {
  openModal(
    t("modal.newCustomer"),
    `<div class="form-group"><label>${t("common.name")} *</label><input id="cu-name"></div>
     <div class="form-group"><label>${t("common.phone")} *</label><input id="cu-phone" placeholder="0401234567"></div>
     <div class="form-group"><label>${t("common.email")}</label><input id="cu-email"></div>
     <div class="form-group"><label>${t("common.address")}</label><input id="cu-address"></div>
     <div class="form-group"><label>${t("common.notes")}</label><textarea id="cu-notes" rows="2"></textarea></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="saveCustomer()">${t("common.save")}</button>`
  );
}

async function saveCustomer() {
  try {
    await api("/customers", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("cu-name").value.trim(),
        phone: document.getElementById("cu-phone").value.trim(),
        email: document.getElementById("cu-email").value.trim() || null,
        address: document.getElementById("cu-address").value.trim() || null,
        notes: document.getElementById("cu-notes").value.trim() || null,
      }),
    });
    closeModal();
    showToast(t("toast.customerAdded"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openEditCustomerModal(id) {
  const c = customers.find((x) => x.id === id);
  if (!c) return;
  openModal(
    t("modal.editCustomer", { name: c.name }),
    `<div class="form-group"><label>${t("common.name")} *</label><input id="cu-name" value="${escapeHtml(c.name)}"></div>
     <div class="form-group"><label>${t("common.phone")} *</label><input id="cu-phone" value="${escapeHtml(c.phone)}"></div>
     <div class="form-group"><label>${t("common.email")}</label><input id="cu-email" value="${escapeHtml(c.email || "")}"></div>
     <div class="form-group"><label>${t("common.address")}</label><input id="cu-address" value="${escapeHtml(c.address || "")}"></div>
     <div class="form-group"><label>${t("common.notes")}</label><textarea id="cu-notes" rows="2">${escapeHtml(c.notes || "")}</textarea></div>`,
    `<button class="btn btn-secondary" onclick="openCustomerDetailModal(${id})">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="saveCustomerEdit(${id})">${t("common.save")}</button>`
  );
}

async function openCustomerDetailModal(customerId) {
  try {
    const data = await api(`/customers/${customerId}`);
    const ordersHtml = data.orders.length
      ? `<div class="customer-orders">${data.orders
          .map((o) => {
            const servicesMeta = orderServicesMeta(o);
            return `<div class="customer-order-item">
              <div class="customer-order-header">
                <span class="order-number">${escapeHtml(o.order_number)}</span>
                ${statusBadge(o.status)}
              </div>
              <div class="order-meta">${formatDate(o.created_at)}${servicesMeta ? ` · ${servicesMeta}` : ""}</div>
              <p class="customer-order-products">${escapeHtml(o.product_summary || "-")}</p>
              <button type="button" class="btn btn-secondary btn-sm" onclick="openOrderTimeline(${o.id})">${t("orders.timeline")}</button>
            </div>`;
          })
          .join("")}</div>`
      : `<p class="hint">${t("customers.noOrders")}</p>`;

    openModal(
      escapeHtml(data.name),
      `<div class="customer-detail">
        <dl class="detail-list">
          <dt>${t("common.phone")}</dt><dd>${escapeHtml(data.phone)}</dd>
          <dt>${t("common.email")}</dt><dd>${productDisplay(data.email)}</dd>
          <dt>${t("common.address")}</dt><dd>${productDisplay(data.address)}</dd>
          <dt>${t("common.notes")}</dt><dd>${productDisplay(data.notes)}</dd>
          <dt>${t("customers.memberSince")}</dt><dd>${formatDate(data.created_at)}</dd>
        </dl>
        <hr style="border-color:var(--border);margin:1rem 0">
        <h4 class="customer-history-title">${t("customers.history")}</h4>
        ${ordersHtml}
      </div>`,
      `<button class="btn btn-secondary" onclick="closeModal()">${t("common.close")}</button>
       <button class="btn btn-primary" onclick="openEditCustomerModal(${customerId})">${t("common.edit")}</button>
       <button class="btn btn-secondary" onclick="openNewSalesModal(null, null, ${customerId}); closeModal();">${t("orders.new")}</button>`
    );
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function saveCustomerEdit(id) {
  try {
    await api(`/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: document.getElementById("cu-name").value.trim(),
        phone: document.getElementById("cu-phone").value.trim(),
        email: document.getElementById("cu-email").value.trim() || null,
        address: document.getElementById("cu-address").value.trim() || null,
        notes: document.getElementById("cu-notes").value.trim() || null,
      }),
    });
    closeModal();
    showToast(t("toast.customerUpdated"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderOrderLines(lines, showDelivered = false) {
  return lines
    .map((line) => {
      const extra = showDelivered
        ? ` <span class="order-meta">(${t("orders.delivered")} ${line.quantity_delivered}/${line.quantity})</span>`
        : "";
      return `<div class="order-line"><span>${line.product_name} (${line.product_sku}) × ${line.quantity}${extra}</span></div>`;
    })
    .join("");
}

async function renderPurchases() {
  purchaseOrders = await api("/purchase-orders");
  const container = document.getElementById("purchases-list");

  if (!purchaseOrders.length) {
    container.innerHTML = `<div class="empty-state">${t("purchases.empty")}</div>`;
    return;
  }

  container.innerHTML = purchaseOrders
    .map((order) => {
      const canReceive = ["tilattu", "osittain_vastaanotettu"].includes(order.status);
      return `<div class="order-card">
        <div class="order-card-header">
          <div>
            <h4>${order.order_number}</h4>
            <div class="order-meta">${order.supplier} · ${formatDate(order.created_at)}</div>
          </div>
          ${statusBadge(order.status)}
        </div>
        <div class="order-lines">${order.lines
          .map(
            (line) =>
              `<div class="order-line"><span>${line.product_name} (${line.product_sku}) × ${line.quantity}</span><span class="order-meta">${t("orders.received")} ${line.quantity_received}/${line.quantity}</span></div>`
          )
          .join("")}</div>
        ${canReceive ? `<div class="order-actions"><button class="btn btn-success btn-sm" onclick="openReceiveModal(${order.id})">${t("purchases.receive")}</button></div>` : ""}
      </div>`;
    })
    .join("");
}

async function renderMovements() {
  const movements = await api("/movements");
  document.getElementById("movements-table").innerHTML = movements.length
    ? movements
        .map(
          (m) => `<tr>
            <td>${formatDate(m.created_at)}</td>
            <td>${m.product_name} (${m.product_sku})</td>
            <td>${movementLabel(m.movement_type)}</td>
            <td>${m.quantity > 0 ? "+" : ""}${m.quantity}</td>
            <td>${m.reference || "-"}</td>
            <td>${m.notes || "-"}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="empty-state">${t("movements.empty")}</td></tr>`;
}

function openModal(title, bodyHtml, footerHtml) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  document.getElementById("modal-footer").innerHTML = footerHtml;
  document.getElementById("modal").classList.remove("hidden");
}

function closeModal() {
  stopCamera();
  document.getElementById("modal").classList.add("hidden");
}

async function loadSeedData() {
  await api("/seed", { method: "POST" });
  showToast(t("toast.seedLoaded"));
  await refreshAll();
}

function openSettingsModal() {
  const canInstall = Boolean(deferredInstallPrompt);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const installHint = !canInstall && isMobile && !isStandaloneApp();
  const lang = getLang();
  const theme = getTheme();

  openModal(
    t("settings.title"),
    `<div class="settings-list">
      <div class="settings-section">
        <span class="settings-label">${t("settings.language")}</span>
        <div class="option-group" id="settings-lang-group">
          <button type="button" class="option-btn ${lang === "fi" ? "active" : ""}" data-lang="fi">${t("settings.langFi")}</button>
          <button type="button" class="option-btn ${lang === "sv" ? "active" : ""}" data-lang="sv">${t("settings.langSv")}</button>
          <button type="button" class="option-btn ${lang === "en" ? "active" : ""}" data-lang="en">${t("settings.langEn")}</button>
        </div>
      </div>
      <div class="settings-section">
        <span class="settings-label">${t("settings.theme")}</span>
        <div class="option-group" id="settings-theme-group">
          <button type="button" class="option-btn ${theme === "light" ? "active" : ""}" data-theme="light">${t("settings.themeLight")}</button>
          <button type="button" class="option-btn ${theme === "dark" ? "active" : ""}" data-theme="dark">${t("settings.themeDark")}</button>
        </div>
      </div>
      <div class="settings-section">
        <button type="button" class="btn btn-secondary btn-block" id="settings-seed-btn">${t("settings.seed")}</button>
      </div>
      ${
        canInstall
          ? `<div class="settings-section"><button type="button" class="btn btn-primary btn-block" id="settings-install-btn">${t("settings.install")}</button></div>`
          : ""
      }
      ${installHint ? `<p class="hint">${t("settings.installHint")}</p>` : ""}
    </div>`,
    `<button type="button" class="btn btn-secondary" onclick="closeModal()">${t("common.close")}</button>`
  );

  document.querySelectorAll("#settings-lang-group .option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLang(btn.dataset.lang);
      applyLanguageChange();
      openSettingsModal();
    });
  });

  document.querySelectorAll("#settings-theme-group .option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setTheme(btn.dataset.theme);
      document.querySelectorAll("#settings-theme-group .option-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.theme === btn.dataset.theme);
      });
    });
  });

  document.getElementById("settings-seed-btn")?.addEventListener("click", async () => {
    try {
      await loadSeedData();
      closeModal();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("settings-install-btn")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    closeModal();
    showToast(t("toast.appInstalled"));
  });
}

function formatProductLabel(p) {
  const mfr = p.manufacturer ? ` · ${p.manufacturer}` : "";
  return `${p.name} (${p.sku})${mfr} – ${t("product.labelFree")} ${p.quantity_available}`;
}

function productOptions() {
  return products
    .map((p) => `<option value="${p.id}">${escapeHtml(formatProductLabel(p))}</option>`)
    .join("");
}

function addLineRow(containerId) {
  const container = document.getElementById(containerId);
  const row = document.createElement("div");
  row.className = "line-row";
  row.innerHTML = `
    <select class="line-product">${productOptions()}</select>
    <input type="number" class="line-qty" min="1" value="1">
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(row);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function productDisplay(value) {
  return value && String(value).trim() ? escapeHtml(value) : '<span class="text-muted">–</span>';
}

function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "–";
  try {
    return new Intl.NumberFormat(getLocale(), { style: "currency", currency: "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} €`;
  }
}

function parsePriceInput(id) {
  const raw = document.getElementById(id)?.value.trim();
  if (!raw) return null;
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function openProductDetailModal(productId) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  const low = p.quantity_available <= p.min_stock_level;
  openModal(
    escapeHtml(p.name),
    `<div class="product-detail">
      <dl class="detail-list">
        <dt>${t("common.sku")}</dt><dd><code>${escapeHtml(p.sku)}</code></dd>
        <dt>${t("common.shelfLocation")}</dt><dd>${productDisplay(p.shelf_location)}</dd>
        <dt>${t("common.manufacturer")}</dt><dd>${productDisplay(p.manufacturer)}</dd>
        <dt>${t("common.wholesaler")}</dt><dd>${productDisplay(p.wholesaler)}</dd>
        <dt>${t("common.purchasePrice")}</dt><dd>${formatPrice(p.purchase_price)}</dd>
        <dt>${t("common.salePrice")}</dt><dd>${formatPrice(p.sale_price)}</dd>
        <dt>${t("common.description")}</dt><dd>${productDisplay(p.description)}</dd>
        <dt>${t("common.unit")}</dt><dd>${escapeHtml(p.unit)}</dd>
      </dl>
      <hr style="border-color:var(--border);margin:1rem 0">
      <dl class="detail-list">
        <dt>${t("common.onHand")}</dt><dd><strong>${p.quantity_on_hand}</strong></dd>
        <dt>${t("common.ordered")}</dt><dd>${p.quantity_ordered}</dd>
        <dt>${t("common.reserved")}</dt><dd>${p.quantity_reserved}</dd>
        <dt>${t("common.available")}</dt><dd><strong>${p.quantity_available}</strong></dd>
        <dt>${t("common.minStock")}</dt><dd>${p.min_stock_level}</dd>
        <dt>${t("common.status")}</dt><dd><span class="badge ${low ? "low" : "ok"}">${stockBadgeLabel(low)}</span></dd>
      </dl>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.close")}</button>
     <button class="btn btn-primary" onclick="openEditProductModal(${p.id})">${t("common.edit")}</button>
     <button class="btn btn-secondary" onclick="openNewSalesModalWithProduct(${p.id}); closeModal();">${t("modal.addToOrderBtn")}</button>`
  );
}

function openEditProductModal(productId) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  openModal(
    t("modal.editProduct", { name: escapeHtml(p.name) }),
    `<div class="form-group"><label>${t("common.sku")}</label><input value="${escapeHtml(p.sku)}" disabled></div>
     <div class="form-group"><label>${t("common.name")} *</label><input id="ep-name" value="${escapeHtml(p.name)}"></div>
     <div class="form-group"><label>${t("common.shelfLocation")}</label><input id="ep-shelf" value="${escapeHtml(p.shelf_location || "")}" placeholder="esim. A-01"></div>
     <div class="form-group"><label>${t("common.manufacturer")}</label><input id="ep-manufacturer" value="${escapeHtml(p.manufacturer || "")}"></div>
     <div class="form-group"><label>${t("common.wholesaler")}</label><input id="ep-wholesaler" value="${escapeHtml(p.wholesaler || "")}"></div>
     <div class="form-row">
       <div class="form-group"><label>${t("common.purchasePrice")} (€)</label><input type="number" id="ep-purchase-price" min="0" step="0.01" value="${p.purchase_price ?? ""}" placeholder="0.00"></div>
       <div class="form-group"><label>${t("common.salePrice")} (€)</label><input type="number" id="ep-sale-price" min="0" step="0.01" value="${p.sale_price ?? ""}" placeholder="0.00"></div>
     </div>
     <div class="form-group"><label>${t("common.description")}</label><textarea id="ep-desc" rows="2">${escapeHtml(p.description || "")}</textarea></div>
     <div class="form-group"><label>${t("common.unit")}</label><input id="ep-unit" value="${escapeHtml(p.unit)}"></div>
     <div class="form-group"><label>${t("common.minStock")}</label><input type="number" id="ep-min" min="0" value="${p.min_stock_level}"></div>`,
    `<button class="btn btn-secondary" onclick="openProductDetailModal(${p.id})">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="saveProductEdit(${p.id})">${t("common.save")}</button>`
  );
}

async function saveProductEdit(productId) {
  const name = document.getElementById("ep-name").value.trim();
  if (!name) {
    showToast(t("toast.nameRequired"), "error");
    return;
  }
  try {
    await api(`/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        shelf_location: document.getElementById("ep-shelf").value.trim() || null,
        manufacturer: document.getElementById("ep-manufacturer").value.trim() || null,
        wholesaler: document.getElementById("ep-wholesaler").value.trim() || null,
        purchase_price: parsePriceInput("ep-purchase-price"),
        sale_price: parsePriceInput("ep-sale-price"),
        description: document.getElementById("ep-desc").value.trim() || null,
        unit: document.getElementById("ep-unit").value.trim() || "kpl",
        min_stock_level: parseInt(document.getElementById("ep-min").value, 10) || 0,
      }),
    });
    products = await api("/products");
    closeModal();
    showToast(t("toast.productUpdated"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openNewProductModal() {
  openModal(
    t("modal.newProduct"),
    `<div class="form-group"><label>${t("common.sku")} *</label><input id="np-sku"></div>
     <div class="form-group"><label>${t("common.name")} *</label><input id="np-name"></div>
     <div class="form-group"><label>${t("common.shelfLocation")}</label><input id="np-shelf" placeholder="esim. A-01"></div>
     <div class="form-group"><label>${t("common.manufacturer")}</label><input id="np-manufacturer"></div>
     <div class="form-group"><label>${t("common.wholesaler")}</label><input id="np-wholesaler"></div>
     <div class="form-row">
       <div class="form-group"><label>${t("common.purchasePrice")} (€)</label><input type="number" id="np-purchase-price" min="0" step="0.01" placeholder="0.00"></div>
       <div class="form-group"><label>${t("common.salePrice")} (€)</label><input type="number" id="np-sale-price" min="0" step="0.01" placeholder="0.00"></div>
     </div>
     <div class="form-group"><label>${t("common.description")}</label><textarea id="np-desc" rows="2"></textarea></div>
     <div class="form-group"><label>${t("modal.initialStock")}</label><input type="number" id="np-qty" min="0" value="0"></div>
     <div class="form-group"><label>${t("common.minStock")}</label><input type="number" id="np-min" min="0" value="0"></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="saveProduct()">${t("common.save")}</button>`
  );
}

async function saveProduct() {
  try {
    await api("/products", {
      method: "POST",
      body: JSON.stringify({
        sku: document.getElementById("np-sku").value.trim(),
        name: document.getElementById("np-name").value.trim(),
        shelf_location: document.getElementById("np-shelf").value.trim() || null,
        manufacturer: document.getElementById("np-manufacturer").value.trim() || null,
        wholesaler: document.getElementById("np-wholesaler").value.trim() || null,
        purchase_price: parsePriceInput("np-purchase-price"),
        sale_price: parsePriceInput("np-sale-price"),
        description: document.getElementById("np-desc").value.trim() || null,
        quantity_on_hand: parseInt(document.getElementById("np-qty").value, 10) || 0,
        min_stock_level: parseInt(document.getElementById("np-min").value, 10) || 0,
      }),
    });
    closeModal();
    showToast(t("toast.productCreated"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function openNewSalesModal(preselectedProductId, preselectedSku, preselectedCustomerId) {
  await stopCamera();
  if (!products.length) products = await api("/products");
  if (!customers.length) customers = await api("/customers");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  openModal(
    t("modal.newOrder"),
    `${customerFieldHtml("so")}
     <div class="form-group"><label>${t("modal.phoneRequired")}</label><input id="so-phone" type="tel" placeholder="0401234567" required></div>
     <div class="form-group"><label>${t("common.notes")}</label><textarea id="so-notes" rows="2"></textarea></div>
     ${servicesPickerHtml("new")}
     <div class="form-group">
       <label>${t("modal.scanProduct")}</label>
       <div class="scan-input-wrap scan-input-wrap-modal">
         <input type="text" id="so-scan" class="scan-input" placeholder="${t("scan.placeholder")}">
         <button type="button" class="btn btn-secondary btn-sm" id="so-scan-cancel">${t("common.cancel")}</button>
       </div>
       <div id="so-camera-reader" class="camera-reader camera-reader-modal hidden"></div>
       <button type="button" class="btn btn-secondary btn-sm" id="so-camera-toggle-btn">${t("scan.startCamera")}</button>
     </div>
     <div class="form-group"><label>${t("modal.orderLines")}</label><div id="so-lines"></div>
     <button type="button" class="btn btn-secondary btn-sm" onclick="addLineRow('so-lines')">${t("modal.addLine")}</button></div>
     <hr style="border-color:var(--border);margin:1rem 0">
     <div class="form-group">
       <label id="new-date-label">${t("orders.deliveryDate")}</label>
       <input type="date" id="so-scheduled-date" value="${tomorrow.toISOString().slice(0, 10)}" required>
     </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="saveSalesOrder()">${t("modal.saveOrder")}</button>`
  );
  setupServicePicker("new");
  setupCustomerAutocomplete("so");
  addLineRow("so-lines");
  if (preselectedCustomerId) {
    const c =
      customers.find((x) => x.id === preselectedCustomerId) ||
      (await api(`/customers/${preselectedCustomerId}`));
    if (c) {
      document.getElementById("so-customer").value = c.name;
      document.getElementById("so-phone").value = c.phone;
      document.getElementById("so-customer-id").value = c.id;
    }
  }
  if (preselectedProductId) {
    const row = document.querySelector("#so-lines .line-product");
    if (row) row.value = preselectedProductId;
  }
  const scanInput = document.getElementById("so-scan");
  if (preselectedSku) scanInput.value = preselectedSku;

  async function processOrderScanFromInput() {
    const sku = scanInput.value.trim();
    if (!sku || scanProcessing) return;
    scanProcessing = true;
    try {
      await handleProductScan(
        sku,
        (p) => {
          addProductToOrderLine(p.id);
          scanInput.value = "";
          showToast(`Lisätty: ${p.name}`);
        },
        (code) => {
          openUnknownProductModal(code, "order", (product) => {
            addProductToOrderLine(product.id);
            scanInput.value = "";
            showToast(`Lisätty: ${product.name}`);
          });
        }
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      scanProcessing = false;
      scanInput.focus();
    }
  }

  setupAutoScanInput(scanInput, processOrderScanFromInput);
  document.getElementById("so-scan-cancel").addEventListener("click", () => {
    scanInput.value = "";
    scanInput.focus();
    stopCamera();
  });
  document.getElementById("so-camera-toggle-btn").addEventListener("click", toggleOrderScanCamera);
  if (preselectedSku && !preselectedProductId) {
    processOrderScanFromInput();
  }
}

function openNewSalesModalWithProduct(productId) {
  openNewSalesModal(productId);
}

function openNewSalesModalWithSku(sku) {
  openNewSalesModal(null, sku);
}

async function saveSalesOrder() {
  const customer = document.getElementById("so-customer").value.trim();
  const phone = document.getElementById("so-phone").value.trim();
  if (!customer) {
    showToast(t("toast.customerRequired"), "error");
    return;
  }
  if (!phone || phone.length < 5) {
    showToast(t("toast.phoneRequired"), "error");
    return;
  }
  const customerIdRaw = document.getElementById("so-customer-id").value;
  const customerId = customerIdRaw ? parseInt(customerIdRaw, 10) : null;
  const lines = [...document.querySelectorAll("#so-lines .line-row")].map((row) => ({
    product_id: parseInt(row.querySelector(".line-product").value, 10),
    quantity: parseInt(row.querySelector(".line-qty").value, 10),
  }));
  if (!lines.length) {
    showToast(t("toast.orderLineRequired"), "error");
    return;
  }
  const services = getSelectedServices("new");
  const fulfillment = fulfillmentFromServices(services);
  const scheduledDate = document.getElementById("so-scheduled-date").value;
  if (!scheduledDate) {
    showToast(t("toast.dateRequired"), "error");
    return;
  }

  try {
    const order = await api("/sales-orders", {
      method: "POST",
      body: JSON.stringify({
        customer,
        customer_id: customerId,
        customer_phone: phone,
        notes: document.getElementById("so-notes").value.trim() || null,
        fulfillment_type: fulfillment,
        scheduled_date: scheduledDate,
        services: getSelectedServices("new"),
        lines,
      }),
    });
    closeModal();
    showToast(t("toast.orderCreated", { number: order.order_number }));
    switchView("orders");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openEditOrderModal(orderId) {
  const order = ordersList.find((o) => o.id === orderId) || salesOrders.find((o) => o.id === orderId);
  if (!order) return;

  openModal(
    `${t("common.edit")} ${order.order_number}`,
    `<div class="form-group"><label>${t("common.customer")} *</label><input id="edit-customer" value="${order.customer}"></div>
     <div class="form-group"><label>${t("modal.phoneRequired")}</label><input id="edit-phone" type="tel" value="${order.customer_phone || ""}"></div>
     <div class="form-group"><label>${t("common.notes")}</label><textarea id="edit-notes" rows="2">${order.notes || ""}</textarea></div>
     ${servicesPickerHtml("edit", normalizeOrderServices(order))}
     <p class="hint">${t("common.products")}: ${order.product_summary || "-"}</p>
     <div class="form-group">
       <label id="edit-date-label">${t("orders.deliveryDate")}</label>
       <input type="date" id="edit-scheduled-date" value="${toInputDate(order.scheduled_date)}" required>
     </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="saveOrderEdit(${orderId})">${t("modal.saveChanges")}</button>`
  );
  setupServicePicker("edit");
}

async function saveOrderEdit(orderId) {
  const customer = document.getElementById("edit-customer").value.trim();
  const phone = document.getElementById("edit-phone").value.trim();
  const scheduledDate = document.getElementById("edit-scheduled-date").value;
  if (!customer || !phone || !scheduledDate) {
    showToast(t("toast.orderFieldsRequired"), "error");
    return;
  }
  const services = getSelectedServices("edit");
  const fulfillment = fulfillmentFromServices(services);

  try {
    await api(`/sales-orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({
        customer,
        customer_phone: phone,
        notes: document.getElementById("edit-notes").value.trim() || null,
        fulfillment_type: fulfillment,
        scheduled_date: scheduledDate,
        services,
      }),
    });
    closeModal();
    showToast(t("toast.orderUpdated"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openNewPurchaseModal() {
  if (!products.length) {
    showToast(t("toast.createProductsFirst"), "error");
    return;
  }
  openModal(
    t("modal.newPurchase"),
    `<div class="form-group"><label>${t("modal.supplier")} *</label><input id="po-supplier"></div>
     <div class="form-group"><label>${t("common.notes")}</label><textarea id="po-notes" rows="2"></textarea></div>
     <div class="form-group"><label>${t("modal.lines")}</label><div id="po-lines"></div>
     <button type="button" class="btn btn-secondary btn-sm" onclick="addLineRow('po-lines')">${t("modal.addLine")}</button></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="savePurchaseOrder()">${t("modal.savePurchase")}</button>`
  );
  addLineRow("po-lines");
}

async function savePurchaseOrder() {
  const lines = [...document.querySelectorAll("#po-lines .line-row")].map((row) => ({
    product_id: parseInt(row.querySelector(".line-product").value, 10),
    quantity: parseInt(row.querySelector(".line-qty").value, 10),
  }));

  try {
    await api("/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplier: document.getElementById("po-supplier").value.trim(),
        notes: document.getElementById("po-notes").value.trim() || null,
        lines,
      }),
    });
    closeModal();
    showToast(t("toast.purchaseCreated"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function approveSalesOrder(id) {
  try {
    await api(`/sales-orders/${id}/approve`, { method: "POST" });
    showToast(t("toast.orderApproved"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function cancelSalesOrder(id) {
  if (!confirm(t("toast.confirmCancel"))) return;
  try {
    await api(`/sales-orders/${id}/cancel`, { method: "POST" });
    showToast(t("toast.orderCancelled"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openDeliverModal(orderId) {
  const order = salesOrders.find((o) => o.id === orderId);
  if (!order) {
    showToast(t("toast.reloadOrders"), "error");
    return;
  }

  const actionLabel = order.fulfillment_type === "nouto" ? t("orders.pickup") : t("orders.deliver");
  const linesHtml = order.lines
    .filter((l) => l.quantity_delivered < l.quantity)
    .map(
      (line) => `<div class="line-row">
        <span>${line.product_name} (${t("modal.remaining")} ${line.quantity - line.quantity_delivered})</span>
        <input type="number" class="deliver-qty" data-line-id="${line.id}" min="1" max="${line.quantity - line.quantity_delivered}" value="${line.quantity - line.quantity_delivered}">
      </div>`
    )
    .join("");

  openModal(
    t("modal.deliverTitle", { action: actionLabel, number: order.order_number }),
    `<p class="hint">${t("modal.deliverHint", { method: fulfillmentLabel(order.fulfillment_type), date: formatDateOnly(order.scheduled_date) })}</p>${linesHtml}`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
     <button class="btn btn-primary" onclick="deliverOrder(${orderId})">${t("modal.confirm")}</button>`
  );
}

async function deliverOrder(orderId) {
  const lines = [...document.querySelectorAll(".deliver-qty")].map((input) => ({
    line_id: parseInt(input.dataset.lineId, 10),
    quantity: parseInt(input.value, 10),
  }));

  try {
    await api(`/sales-orders/${orderId}/deliver`, {
      method: "POST",
      body: JSON.stringify({ lines }),
    });
    closeModal();
    showToast(t("toast.orderProcessed"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openReceiveModal(orderId) {
  const order = purchaseOrders.find((o) => o.id === orderId);
  if (!order) return;

  const linesHtml = order.lines
    .filter((l) => l.quantity_received < l.quantity)
    .map(
      (line) => `<div class="line-row">
        <span>${line.product_name} (${t("modal.remaining")} ${line.quantity - line.quantity_received})</span>
        <input type="number" class="receive-qty" data-line-id="${line.id}" min="1" max="${line.quantity - line.quantity_received}" value="${line.quantity - line.quantity_received}">
      </div>`
    )
    .join("");

  openModal(
    t("modal.receiveTitle", { number: order.order_number }),
    `<p class="hint">${t("modal.receiveHint")}</p>${linesHtml}`,
    `<button class="btn btn-secondary" onclick="closeModal()">${t("common.cancel")}</button>
     <button class="btn btn-success" onclick="receiveOrder(${orderId})">${t("modal.confirmReceive")}</button>`
  );
}

async function receiveOrder(orderId) {
  const lines = [...document.querySelectorAll(".receive-qty")].map((input) => ({
    line_id: parseInt(input.dataset.lineId, 10),
    quantity: parseInt(input.value, 10),
  }));

  try {
    await api(`/purchase-orders/${orderId}/receive`, {
      method: "POST",
      body: JSON.stringify({ lines }),
    });
    closeModal();
    showToast(t("toast.receiveLogged"));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleImport(file) {
  const formData = new FormData();
  formData.append("file", file);
  try {
    const result = await api("/import/products", { method: "POST", body: formData });
    const errors = result.errors.length
      ? `<ul>${result.errors.map((e) => `<li>${e}</li>`).join("")}</ul>`
      : "";
    document.getElementById("import-result").innerHTML = `
      <p><strong>${t("import.created")}:</strong> ${result.created} · <strong>${t("import.updated")}:</strong> ${result.updated}</p>
      ${errors}`;
    showToast(t("toast.importDone", { count: result.created + result.updated }));
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function downloadTemplate() {
  try {
    const res = await fetch(`${API}/import/template`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error(t("toast.templateFailed"));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tuotteet_malli.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, "error");
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const number = document.getElementById("employee-number").value.trim();
  try {
    await login(number);
  } catch (err) {
    showLogin(err.message);
  }
});

document.getElementById("logout-btn").addEventListener("click", () => logout(true));
document.querySelectorAll(".menu-item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("refresh-btn").addEventListener("click", refreshAll);
document.getElementById("inventory-search").addEventListener("input", renderInventory);
document.getElementById("orders-search").addEventListener("input", () => {
  clearTimeout(ordersSearchTimer);
  ordersSearchTimer = setTimeout(renderOrders, 300);
});
document.querySelectorAll("#orders-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#orders-tabs .tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    ordersFulfillmentFilter = tab.dataset.fulfillment;
    renderOrders();
  });
});
document.getElementById("new-product-btn").addEventListener("click", openNewProductModal);
document.getElementById("new-sales-btn").addEventListener("click", () => openNewSalesModal());
document.getElementById("new-customer-btn").addEventListener("click", openNewCustomerModal);
document.getElementById("new-purchase-btn").addEventListener("click", openNewPurchaseModal);
document.getElementById("scan-cancel-btn").addEventListener("click", resetScanView);
setupAutoScanInput(document.getElementById("scan-input"), handleScanSearch);
document.getElementById("camera-toggle-btn").addEventListener("click", toggleScanViewCamera);
document.getElementById("customers-search").addEventListener("input", () => {
  clearTimeout(customersSearchTimer);
  customersSearchTimer = setTimeout(renderCustomers, 300);
});
document.getElementById("download-template-btn").addEventListener("click", (e) => {
  e.preventDefault();
  downloadTemplate();
});
document.querySelector(".modal-close").addEventListener("click", closeModal);
document.querySelector(".modal-backdrop").addEventListener("click", closeModal);

document.getElementById("import-file").addEventListener("change", (e) => {
  if (e.target.files[0]) handleImport(e.target.files[0]);
  e.target.value = "";
});

document.getElementById("seed-btn").addEventListener("click", async () => {
  try {
    await loadSeedData();
  } catch (err) {
    showToast(err.message, "error");
  }
});

document.getElementById("settings-btn").addEventListener("click", openSettingsModal);

window.approveSalesOrder = approveSalesOrder;
window.cancelSalesOrder = cancelSalesOrder;
window.openDeliverModal = openDeliverModal;
window.deliverOrder = deliverOrder;
window.openReceiveModal = openReceiveModal;
window.receiveOrder = receiveOrder;
window.addLineRow = addLineRow;
window.closeModal = closeModal;
window.saveProduct = saveProduct;
window.openProductDetailModal = openProductDetailModal;
window.openEditProductModal = openEditProductModal;
window.saveProductEdit = saveProductEdit;
window.saveSalesOrder = saveSalesOrder;
window.openNewSalesModal = openNewSalesModal;
window.openNewSalesModalWithProduct = openNewSalesModalWithProduct;
window.openNewSalesModalWithSku = openNewSalesModalWithSku;
window.openUnknownProductModal = openUnknownProductModal;
window.saveUnknownProduct = saveUnknownProduct;
window.openEditOrderModal = openEditOrderModal;
window.saveOrderEdit = saveOrderEdit;
window.openOrderTimeline = openOrderTimeline;
window.openEditCustomerModal = openEditCustomerModal;
window.openCustomerDetailModal = openCustomerDetailModal;
window.saveCustomer = saveCustomer;
window.saveCustomerEdit = saveCustomerEdit;

initPreferences();

if (authToken && currentEmployee) {
  showApp();
  switchView("dashboard");
} else {
  showLogin();
}

initPwa();
