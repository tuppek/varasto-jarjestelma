const API = "/api";

const VIEW_META = {
  dashboard: { title: "Etusivu", subtitle: "Yhteenveto varastosta ja avoimista tilauksista" },
  inventory: { title: "Saldo", subtitle: "Varastossa, tilattu, varattu ja vapaa saldo" },
  products: { title: "Tuotteet", subtitle: "Tuoterekisteri" },
  scan: { title: "Skannaus", subtitle: "Hae tuotteita viivakoodilla tai SKU:lla" },
  customers: { title: "Asiakkaat", subtitle: "Asiakasrekisteri – haku ja lisäys" },
  orders: { title: "Tilaukset", subtitle: "Toimitukset, noudot, haku ja muokkaus" },
  purchases: { title: "Ostotilaukset", subtitle: "Tilaa ja vastaanota tuotteita" },
  movements: { title: "Varastotapahtumat", subtitle: "Historia kaikista saldomuutoksista" },
  import: { title: "Tuonti", subtitle: "Tuo data Excelistä tai vanhasta järjestelmästä" },
};

const STATUS_LABELS = {
  luonnos: "Luonnos",
  tilattu: "Tilattu",
  osittain_vastaanotettu: "Osittain vastaanotettu",
  vastaanotettu: "Vastaanotettu",
  peruttu: "Peruttu",
  hyvaksytty: "Hyväksytty",
  osittain_toimitettu: "Osittain toimitettu",
  toimitettu: "Toimitettu",
};

const FULFILLMENT_LABELS = {
  toimitus: "Toimitus",
  nouto: "Nouto",
};

const SERVICE_LABELS = {
  kuljetus: "Kuljetus",
  asennus: "Asennus",
};

const MOVEMENT_LABELS = {
  alkusaldo: "Alkusaldo",
  ostotilaus: "Ostotilaus",
  vastaanotto: "Vastaanotto",
  varaus: "Varaus",
  toimitus: "Toimitus",
  varaus_peru: "Varauksen peruutus",
};

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

async function stopCamera() {
  if (!activeCamera) return;
  try {
    await activeCamera.html5QrCode.stop();
    activeCamera.html5QrCode.clear();
  } catch (_) {
    /* already stopped */
  }
  if (activeCamera.btn) activeCamera.btn.textContent = "Käynnistä kamera";
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
    showToast("Kamerakirjasto ei latautunut", "error");
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
    btn.textContent = "Pysäytä kamera";
  } catch (err) {
    if (readerEl.classList.contains("camera-reader-modal")) {
      readerEl.classList.add("hidden");
    }
    showToast("Kamera ei käynnisty: " + err.message, "error");
  }
}

async function toggleScanViewCamera() {
  await toggleCameraFor("camera-reader", "camera-toggle-btn", async (decoded) => {
    document.getElementById("scan-input").value = decoded;
    await handleScanSearch();
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
    throw new Error(data.detail || "Istunto vanhentunut – kirjaudu uudelleen");
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
  return new Date(iso).toLocaleString("fi-FI");
}

function formatDateOnly(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("fi-FI");
}

function statusBadge(status) {
  const cls = ["toimitettu", "vastaanotettu"].includes(status)
    ? "done"
    : status === "peruttu"
      ? "cancel"
      : "status";
  return `<span class="badge ${cls}">${STATUS_LABELS[status] || status}</span>`;
}

function fulfillmentBadge(type) {
  return `<span class="badge status">${FULFILLMENT_LABELS[type] || type}</span>`;
}

function orderMeta(order) {
  const parts = [];
  if (order.fulfillment_type) {
    parts.push(`${FULFILLMENT_LABELS[order.fulfillment_type]}: ${formatDateOnly(order.scheduled_date)}`);
  }
  if (order.created_by_name) parts.push(`Luonut: ${order.created_by_name}`);
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
      bannerText.innerHTML = "Asenna sovellus puhelimen aloitusnäytölle – toimii kuin tavallinen sovellus.";
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
  if (notify) showToast("Uloskirjattu");
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
  const meta = VIEW_META[view];
  document.getElementById("view-title").textContent = meta.title;
  document.getElementById("view-subtitle").textContent = meta.subtitle;
  loadView(view);
}

async function loadView(view) {
  try {
    if (view === "dashboard") await renderDashboard();
    if (view === "inventory") await renderInventory();
    if (view === "products") await renderProducts();
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
  if (currentView !== "orders" && currentView !== "customers") showToast("Data päivitetty");
}

async function renderDashboard() {
  const stats = await api("/dashboard");
  document.getElementById("stats-grid").innerHTML = `
    <div class="stat-card"><div class="label">Tuotteita</div><div class="value">${stats.product_count}</div></div>
    <div class="stat-card info"><div class="label">Varastossa</div><div class="value">${stats.total_on_hand}</div></div>
    <div class="stat-card"><div class="label">Tilattu</div><div class="value">${stats.total_ordered}</div></div>
    <div class="stat-card warning"><div class="label">Varattu</div><div class="value">${stats.total_reserved}</div></div>
    <div class="stat-card warning"><div class="label">Vähissä</div><div class="value">${stats.low_stock_count}</div></div>
    <div class="stat-card"><div class="label">Avoimet tilaukset</div><div class="value">${stats.pending_sales_orders}</div></div>
  `;

  document.getElementById("dashboard-summary").innerHTML = `
    <div class="summary-row"><span>Varastossa yhteensä</span><strong>${stats.total_on_hand} kpl</strong></div>
    <div class="summary-row"><span>Tilattu (tulossa)</span><strong>${stats.total_ordered} kpl</strong></div>
    <div class="summary-row"><span>Varattu myynneille</span><strong>${stats.total_reserved} kpl</strong></div>
    <div class="summary-row"><span>Vapaa käytettävissä</span><strong>${stats.total_on_hand - stats.total_reserved} kpl</strong></div>
    <div class="summary-row"><span>Avoimet ostotilaukset</span><strong>${stats.pending_purchase_orders}</strong></div>
  `;

  if (stats.low_stock_count === 0) {
    document.getElementById("dashboard-alerts").innerHTML =
      '<p class="hint">Kaikki tuotteet minimivaraston yläpuolella.</p>';
  } else {
    products = await api("/products");
    const low = products.filter((p) => p.quantity_available <= p.min_stock_level);
    document.getElementById("dashboard-alerts").innerHTML = low
      .map(
        (p) =>
          `<div class="alert-item"><strong>${p.name}</strong> (${p.sku}): vapaa ${p.quantity_available}, minimi ${p.min_stock_level}</div>`
      )
      .join("");
  }
}

async function renderInventory() {
  products = await api("/products");
  const query = document.getElementById("inventory-search").value.toLowerCase();
  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query)
  );

  document.getElementById("inventory-table").innerHTML = filtered.length
    ? filtered
        .map((p) => {
          const low = p.quantity_available <= p.min_stock_level;
          return `<tr class="clickable-row" onclick="openProductDetailModal(${p.id})" title="Näytä lisätiedot">
            <td>${p.sku}</td>
            <td>${p.name}</td>
            <td><strong>${p.quantity_on_hand}</strong></td>
            <td>${p.quantity_ordered}</td>
            <td>${p.quantity_reserved}</td>
            <td>${p.quantity_available}</td>
            <td>${p.min_stock_level}</td>
            <td><span class="badge ${low ? "low" : "ok"}">${low ? "Vähissä" : "OK"}</span></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="empty-state">Ei tuotteita</td></tr>`;
}

async function renderProducts() {
  products = await api("/products");
  document.getElementById("products-table").innerHTML = products.length
    ? products
        .map(
          (p) => `<tr class="clickable-row" onclick="openProductDetailModal(${p.id})" title="Näytä lisätiedot">
            <td>${p.sku}</td>
            <td>${p.name}</td>
            <td>${p.unit}</td>
            <td>${p.quantity_on_hand}</td>
            <td>${p.min_stock_level}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="empty-state">Ei tuotteita. Luo uusi tai tuo Excelistä.</td></tr>`;
}

function toInputDate(iso) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

function setupFulfillmentPicker(selected, prefix) {
  document.querySelectorAll(`#${prefix}-fulfillment-options .fulfillment-option`).forEach((el) => {
    el.addEventListener("click", () => {
      document.querySelectorAll(`#${prefix}-fulfillment-options .fulfillment-option`).forEach((o) => o.classList.remove("selected"));
      el.classList.add("selected");
      el.querySelector("input").checked = true;
      const isPickup = el.querySelector("input").value === "nouto";
      document.getElementById(`${prefix}-date-label`).textContent = isPickup ? "Noutopäivä *" : "Toimituspäivä *";
    });
  });
  const val = selected || "toimitus";
  document.querySelectorAll(`#${prefix}-fulfillment-options .fulfillment-option`).forEach((el) => {
    const match = el.querySelector("input").value === val;
    el.classList.toggle("selected", match);
    if (match) el.querySelector("input").checked = true;
  });
  document.getElementById(`${prefix}-date-label`).textContent = val === "nouto" ? "Noutopäivä *" : "Toimituspäivä *";
}

function fulfillmentPickerHtml(prefix, selected = "toimitus") {
  return `<div class="fulfillment-options" id="${prefix}-fulfillment-options">
    <label class="fulfillment-option ${selected === "toimitus" ? "selected" : ""}">
      <input type="radio" name="${prefix}-fulfillment" value="toimitus" ${selected === "toimitus" ? "checked" : ""}>
      <strong>Toimitus</strong><span>Asiakkaalle</span>
    </label>
    <label class="fulfillment-option ${selected === "nouto" ? "selected" : ""}">
      <input type="radio" name="${prefix}-fulfillment" value="nouto" ${selected === "nouto" ? "checked" : ""}>
      <strong>Nouto</strong><span>Varastolta</span>
    </label>
  </div>`;
}

function orderActionButtons(order) {
  const btns = [];
  btns.push(`<button class="btn btn-secondary btn-sm" onclick="openOrderTimeline(${order.id})">Aikajana</button>`);
  if (!["toimitettu", "peruttu"].includes(order.status)) {
    btns.push(`<button class="btn btn-secondary btn-sm" onclick="openEditOrderModal(${order.id})">Muokkaa</button>`);
  }
  if (order.status === "vastaanotettu") {
    btns.push(`<button class="btn btn-success btn-sm" onclick="approveSalesOrder(${order.id})">Hyväksy</button>`);
    btns.push(`<button class="btn btn-danger btn-sm" onclick="cancelSalesOrder(${order.id})">Peru</button>`);
  }
  if (["hyvaksytty", "osittain_toimitettu"].includes(order.status)) {
    const label = order.fulfillment_type === "nouto" ? "Nouda" : "Toimita";
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
    : `<tr><td colspan="9" class="empty-state">Ei tilauksia</td></tr>`;
}

async function renderCustomers() {
  const q = document.getElementById("customers-search").value.trim();
  const path = q ? `/customers?q=${encodeURIComponent(q)}` : "/customers";
  customers = await api(path);

  document.getElementById("customers-table").innerHTML = customers.length
    ? customers
        .map(
          (c) => `<tr>
            <td>${c.name}</td>
            <td>${c.phone}</td>
            <td>${c.email || "-"}</td>
            <td>${c.address || "-"}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="openEditCustomerModal(${c.id})">Muokkaa</button></td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="empty-state">Ei asiakkaita</td></tr>`;
}

async function scanProductBySku(sku) {
  return api(`/products/scan?sku=${encodeURIComponent(sku.trim())}`);
}

async function lookupProductBySku(sku) {
  return api(`/products/lookup?sku=${encodeURIComponent(sku.trim())}`);
}

function servicesPickerHtml(prefix, selected = []) {
  const sel = new Set(selected);
  return `<div class="form-group"><label>Palvelut</label>
    <div class="service-checkboxes">
      <label class="checkbox-label"><input type="checkbox" name="${prefix}-service" value="kuljetus" ${sel.has("kuljetus") ? "checked" : ""}> ${SERVICE_LABELS.kuljetus}</label>
      <label class="checkbox-label"><input type="checkbox" name="${prefix}-service" value="asennus" ${sel.has("asennus") ? "checked" : ""}> ${SERVICE_LABELS.asennus}</label>
    </div></div>`;
}

function getSelectedServices(prefix) {
  return [...document.querySelectorAll(`input[name="${prefix}-service"]:checked`)].map((cb) => cb.value);
}

function renderScanResult(product) {
  document.getElementById("scan-result").innerHTML = `
    <div class="scan-product-card">
      <h4>${escapeHtml(product.name)}</h4>
      <p class="order-meta">SKU: <strong>${escapeHtml(product.sku)}</strong></p>
      <p>Valmistaja: <strong>${product.manufacturer ? escapeHtml(product.manufacturer) : "–"}</strong> · Tukkuri: <strong>${product.wholesaler ? escapeHtml(product.wholesaler) : "–"}</strong></p>
      <p>Varastossa: <strong>${product.quantity_on_hand}</strong> · Vapaa: <strong>${product.quantity_available}</strong></p>
      <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem" onclick="openProductDetailModal(${product.id})">Lisätiedot</button>
      <button class="btn btn-primary btn-sm" style="margin-top:0.5rem" onclick="openNewSalesModalWithProduct(${product.id})">Lisää tilaukseen</button>
    </div>`;
}

function renderUnknownScanResult(sku) {
  document.getElementById("scan-result").innerHTML = `
    <div class="scan-product-card scan-unknown">
      <h4>Tuotetta ei löydy</h4>
      <p class="order-meta">Skannattu koodi: <strong>${sku}</strong></p>
      <p class="hint">Tuotetta ei ole vielä järjestelmässä. Voit tallentaa sen varastoon.</p>
      <button class="btn btn-primary btn-sm" style="margin-top:0.5rem" onclick="openUnknownProductModal('${sku.replace(/'/g, "\\'")}', 'scan')">Tallenna varastoon</button>
      <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem" onclick="openNewSalesModalWithSku('${sku.replace(/'/g, "\\'")}')">Lisää tilaukseen</button>
    </div>`;
}

function openUnknownProductModal(sku, context, onSaved) {
  openModal(
    "Tallenna uusi tuote",
    `<p>Skannattu koodi: <strong>${sku}</strong></p>
     <div class="form-group"><label>Tuotenimi *</label><input id="uq-name" placeholder="Tuotteen nimi"></div>
     <div class="form-group"><label>Alkusaldo</label><input type="number" id="uq-qty" min="0" value="0"></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-primary" onclick="saveUnknownProduct('${sku.replace(/'/g, "\\'")}', '${context}')">Tallenna</button>`
  );
  window._unknownProductOnSaved = onSaved;
}

async function saveUnknownProduct(sku, context) {
  const name = document.getElementById("uq-name").value.trim();
  const qty = parseInt(document.getElementById("uq-qty").value, 10) || 0;
  if (!name) {
    showToast("Tuotenimi on pakollinen", "error");
    return;
  }
  try {
    const product = await api("/products/quick", {
      method: "POST",
      body: JSON.stringify({ sku, name, quantity_on_hand: qty }),
    });
    products = await api("/products");
    closeModal();
    showToast(`Tuote ${product.name} tallennettu`);
    if (context === "scan") {
      renderScanResult(product);
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
  const sku = document.getElementById("scan-input").value.trim();
  if (!sku) return;
  try {
    await handleProductScan(
      sku,
      (product) => {
        renderScanResult(product);
        showToast(`Löytyi: ${product.name}`);
      },
      (code) => {
        renderUnknownScanResult(code);
        showToast("Tuotetta ei löydy – voit tallentaa sen", "error");
      }
    );
  } catch (err) {
    document.getElementById("scan-result").innerHTML = `<p class="login-error">${err.message}</p>`;
  }
}

async function renderScan() {
  document.getElementById("scan-input").focus();
}

function customerOptionsHtml(selectedId) {
  if (!customers.length) return "";
  return `<div class="form-group"><label>Valitse asiakasrekisteristä</label>
    <select id="so-customer-select" onchange="fillCustomerFromSelect()">
      <option value="">– Valitse tai kirjoita uusi –</option>
      ${customers.map((c) => `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${c.name} (${c.phone})</option>`).join("")}
    </select></div>`;
}

function fillCustomerFromSelect() {
  const id = parseInt(document.getElementById("so-customer-select")?.value, 10);
  if (!id) return;
  const c = customers.find((x) => x.id === id);
  if (!c) return;
  document.getElementById("so-customer").value = c.name;
  document.getElementById("so-phone").value = c.phone;
  document.getElementById("so-customer-id").value = c.id;
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
      : '<p class="hint">Ei tapahtumia</p>';

    openModal(
      `Aikajana: ${order?.order_number || orderId}`,
      html,
      `<button class="btn btn-secondary" onclick="closeModal()">Sulje</button>`
    );
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openNewCustomerModal() {
  openModal(
    "Uusi asiakas",
    `<div class="form-group"><label>Nimi *</label><input id="cu-name"></div>
     <div class="form-group"><label>Puhelin *</label><input id="cu-phone" placeholder="0401234567"></div>
     <div class="form-group"><label>Sähköposti</label><input id="cu-email"></div>
     <div class="form-group"><label>Osoite</label><input id="cu-address"></div>
     <div class="form-group"><label>Huomiot</label><textarea id="cu-notes" rows="2"></textarea></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-primary" onclick="saveCustomer()">Tallenna</button>`
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
    showToast("Asiakas lisätty");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openEditCustomerModal(id) {
  const c = customers.find((x) => x.id === id);
  if (!c) return;
  openModal(
    `Muokkaa: ${c.name}`,
    `<div class="form-group"><label>Nimi *</label><input id="cu-name" value="${c.name}"></div>
     <div class="form-group"><label>Puhelin *</label><input id="cu-phone" value="${c.phone}"></div>
     <div class="form-group"><label>Sähköposti</label><input id="cu-email" value="${c.email || ""}"></div>
     <div class="form-group"><label>Osoite</label><input id="cu-address" value="${c.address || ""}"></div>
     <div class="form-group"><label>Huomiot</label><textarea id="cu-notes" rows="2">${c.notes || ""}</textarea></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-primary" onclick="saveCustomerEdit(${id})">Tallenna</button>`
  );
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
    showToast("Asiakas päivitetty");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderOrderLines(lines, showDelivered = false) {
  return lines
    .map((line) => {
      const extra = showDelivered
        ? ` <span class="order-meta">(toimitettu ${line.quantity_delivered}/${line.quantity})</span>`
        : "";
      return `<div class="order-line"><span>${line.product_name} (${line.product_sku}) × ${line.quantity}${extra}</span></div>`;
    })
    .join("");
}

async function renderPurchases() {
  purchaseOrders = await api("/purchase-orders");
  const container = document.getElementById("purchases-list");

  if (!purchaseOrders.length) {
    container.innerHTML = '<div class="empty-state">Ei ostotilauksia</div>';
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
              `<div class="order-line"><span>${line.product_name} (${line.product_sku}) × ${line.quantity}</span><span class="order-meta">vastaanotettu ${line.quantity_received}/${line.quantity}</span></div>`
          )
          .join("")}</div>
        ${canReceive ? `<div class="order-actions"><button class="btn btn-success btn-sm" onclick="openReceiveModal(${order.id})">Vastaanota</button></div>` : ""}
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
            <td>${MOVEMENT_LABELS[m.movement_type] || m.movement_type}</td>
            <td>${m.quantity > 0 ? "+" : ""}${m.quantity}</td>
            <td>${m.reference || "-"}</td>
            <td>${m.notes || "-"}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="empty-state">Ei tapahtumia</td></tr>`;
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

function formatProductLabel(p) {
  const mfr = p.manufacturer ? ` · ${p.manufacturer}` : "";
  return `${p.name} (${p.sku})${mfr} – vapaa ${p.quantity_available}`;
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

function openProductDetailModal(productId) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  const low = p.quantity_available <= p.min_stock_level;
  openModal(
    escapeHtml(p.name),
    `<div class="product-detail">
      <dl class="detail-list">
        <dt>SKU</dt><dd><code>${escapeHtml(p.sku)}</code></dd>
        <dt>Valmistaja</dt><dd>${productDisplay(p.manufacturer)}</dd>
        <dt>Tukkuri</dt><dd>${productDisplay(p.wholesaler)}</dd>
        <dt>Kuvaus</dt><dd>${productDisplay(p.description)}</dd>
        <dt>Yksikkö</dt><dd>${escapeHtml(p.unit)}</dd>
      </dl>
      <hr style="border-color:var(--border);margin:1rem 0">
      <dl class="detail-list">
        <dt>Varastossa</dt><dd><strong>${p.quantity_on_hand}</strong></dd>
        <dt>Tilattu</dt><dd>${p.quantity_ordered}</dd>
        <dt>Varattu</dt><dd>${p.quantity_reserved}</dd>
        <dt>Vapaa</dt><dd><strong>${p.quantity_available}</strong></dd>
        <dt>Minimivarasto</dt><dd>${p.min_stock_level}</dd>
        <dt>Tila</dt><dd><span class="badge ${low ? "low" : "ok"}">${low ? "Vähissä" : "OK"}</span></dd>
      </dl>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Sulje</button>
     <button class="btn btn-primary" onclick="openEditProductModal(${p.id})">Muokkaa</button>
     <button class="btn btn-secondary" onclick="openNewSalesModalWithProduct(${p.id}); closeModal();">Lisää tilaukseen</button>`
  );
}

function openEditProductModal(productId) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  openModal(
    `Muokkaa: ${escapeHtml(p.name)}`,
    `<div class="form-group"><label>SKU</label><input value="${escapeHtml(p.sku)}" disabled></div>
     <div class="form-group"><label>Nimi *</label><input id="ep-name" value="${escapeHtml(p.name)}"></div>
     <div class="form-group"><label>Valmistaja</label><input id="ep-manufacturer" value="${escapeHtml(p.manufacturer || "")}" placeholder="Esim. FixPlus"></div>
     <div class="form-group"><label>Tukkuri</label><input id="ep-wholesaler" value="${escapeHtml(p.wholesaler || "")}" placeholder="Esim. Rautakauppa Oy"></div>
     <div class="form-group"><label>Kuvaus</label><textarea id="ep-desc" rows="2">${escapeHtml(p.description || "")}</textarea></div>
     <div class="form-group"><label>Yksikkö</label><input id="ep-unit" value="${escapeHtml(p.unit)}"></div>
     <div class="form-group"><label>Minimivarasto</label><input type="number" id="ep-min" min="0" value="${p.min_stock_level}"></div>`,
    `<button class="btn btn-secondary" onclick="openProductDetailModal(${p.id})">Peruuta</button>
     <button class="btn btn-primary" onclick="saveProductEdit(${p.id})">Tallenna</button>`
  );
}

async function saveProductEdit(productId) {
  const name = document.getElementById("ep-name").value.trim();
  if (!name) {
    showToast("Nimi on pakollinen", "error");
    return;
  }
  try {
    await api(`/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        manufacturer: document.getElementById("ep-manufacturer").value.trim() || null,
        wholesaler: document.getElementById("ep-wholesaler").value.trim() || null,
        description: document.getElementById("ep-desc").value.trim() || null,
        unit: document.getElementById("ep-unit").value.trim() || "kpl",
        min_stock_level: parseInt(document.getElementById("ep-min").value, 10) || 0,
      }),
    });
    products = await api("/products");
    closeModal();
    showToast("Tuote päivitetty");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openNewProductModal() {
  openModal(
    "Uusi tuote",
    `<div class="form-group"><label>SKU *</label><input id="np-sku"></div>
     <div class="form-group"><label>Nimi *</label><input id="np-name"></div>
     <div class="form-group"><label>Valmistaja</label><input id="np-manufacturer" placeholder="Esim. FixPlus"></div>
     <div class="form-group"><label>Tukkuri</label><input id="np-wholesaler" placeholder="Esim. Rautakauppa Oy"></div>
     <div class="form-group"><label>Kuvaus</label><textarea id="np-desc" rows="2"></textarea></div>
     <div class="form-group"><label>Alkusaldo</label><input type="number" id="np-qty" min="0" value="0"></div>
     <div class="form-group"><label>Minimivarasto</label><input type="number" id="np-min" min="0" value="0"></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-primary" onclick="saveProduct()">Tallenna</button>`
  );
}

async function saveProduct() {
  try {
    await api("/products", {
      method: "POST",
      body: JSON.stringify({
        sku: document.getElementById("np-sku").value.trim(),
        name: document.getElementById("np-name").value.trim(),
        manufacturer: document.getElementById("np-manufacturer").value.trim() || null,
        wholesaler: document.getElementById("np-wholesaler").value.trim() || null,
        description: document.getElementById("np-desc").value.trim() || null,
        quantity_on_hand: parseInt(document.getElementById("np-qty").value, 10) || 0,
        min_stock_level: parseInt(document.getElementById("np-min").value, 10) || 0,
      }),
    });
    closeModal();
    showToast("Tuote luotu");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function openNewSalesModal(preselectedProductId, preselectedSku) {
  await stopCamera();
  if (!products.length) products = await api("/products");
  if (!customers.length) customers = await api("/customers");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  openModal(
    "Uusi tilaus",
    `${customerOptionsHtml()}
     <div class="form-group"><label>Asiakas *</label><input id="so-customer"></div>
     <div class="form-group"><label>Puhelinnumero *</label><input id="so-phone" type="tel" placeholder="0401234567" required></div>
     <input type="hidden" id="so-customer-id">
     <div class="form-group"><label>Huomiot</label><textarea id="so-notes" rows="2"></textarea></div>
     ${servicesPickerHtml("new")}
     <div class="form-group">
       <label>Skannaa tuote (SKU)</label>
       <div class="scan-input-wrap scan-input-wrap-modal">
         <input type="text" id="so-scan" class="scan-input" placeholder="Skannaa viivakoodi...">
       </div>
       <div id="so-camera-reader" class="camera-reader camera-reader-modal hidden"></div>
       <button type="button" class="btn btn-secondary btn-sm" id="so-camera-toggle-btn">Käynnistä kamera</button>
     </div>
     <div class="form-group"><label>Tilausrivit</label><div id="so-lines"></div>
     <button type="button" class="btn btn-secondary btn-sm" onclick="addLineRow('so-lines')">+ Lisää rivi</button></div>
     <hr style="border-color:var(--border);margin:1rem 0">
     ${fulfillmentPickerHtml("new", "toimitus")}
     <div class="form-group">
       <label id="new-date-label">Toimituspäivä *</label>
       <input type="date" id="so-scheduled-date" value="${tomorrow.toISOString().slice(0, 10)}" required>
     </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-primary" onclick="saveSalesOrder()">Tallenna tilaus</button>`
  );
  setupFulfillmentPicker("toimitus", "new");
  addLineRow("so-lines");
  if (preselectedProductId) {
    const row = document.querySelector("#so-lines .line-product");
    if (row) row.value = preselectedProductId;
  }
  const scanInput = document.getElementById("so-scan");
  if (preselectedSku) scanInput.value = preselectedSku;
  scanInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      try {
        await processOrderScan();
      } catch (err) {
        showToast(err.message, "error");
      }
    }
  });
  document.getElementById("so-camera-toggle-btn").addEventListener("click", toggleOrderScanCamera);
  if (preselectedSku && !preselectedProductId) {
    try {
      await processOrderScan(preselectedSku);
    } catch (err) {
      showToast(err.message, "error");
    }
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
    showToast("Asiakas on pakollinen", "error");
    return;
  }
  if (!phone || phone.length < 5) {
    showToast("Puhelinnumero on pakollinen", "error");
    return;
  }
  const customerIdRaw = document.getElementById("so-customer-id").value;
  const customerId = customerIdRaw ? parseInt(customerIdRaw, 10) : null;
  const lines = [...document.querySelectorAll("#so-lines .line-row")].map((row) => ({
    product_id: parseInt(row.querySelector(".line-product").value, 10),
    quantity: parseInt(row.querySelector(".line-qty").value, 10),
  }));
  if (!lines.length) {
    showToast("Lisää vähintään yksi tilausrivi", "error");
    return;
  }
  const fulfillment = document.querySelector('input[name="new-fulfillment"]:checked')?.value || "toimitus";
  const scheduledDate = document.getElementById("so-scheduled-date").value;
  if (!scheduledDate) {
    showToast("Valitse päivämäärä", "error");
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
    showToast(`Tilaus ${order.order_number} luotu`);
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
    `Muokkaa ${order.order_number}`,
    `<div class="form-group"><label>Asiakas *</label><input id="edit-customer" value="${order.customer}"></div>
     <div class="form-group"><label>Puhelinnumero *</label><input id="edit-phone" type="tel" value="${order.customer_phone || ""}"></div>
     <div class="form-group"><label>Huomiot</label><textarea id="edit-notes" rows="2">${order.notes || ""}</textarea></div>
     ${servicesPickerHtml("edit", order.services || [])}
     <p class="hint">Tuotteet: ${order.product_summary || "-"}</p>
     ${fulfillmentPickerHtml("edit", order.fulfillment_type || "toimitus")}
     <div class="form-group">
       <label id="edit-date-label">Toimituspäivä *</label>
       <input type="date" id="edit-scheduled-date" value="${toInputDate(order.scheduled_date)}" required>
     </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-primary" onclick="saveOrderEdit(${orderId})">Tallenna muutokset</button>`
  );
  setupFulfillmentPicker(order.fulfillment_type || "toimitus", "edit");
}

async function saveOrderEdit(orderId) {
  const customer = document.getElementById("edit-customer").value.trim();
  const phone = document.getElementById("edit-phone").value.trim();
  const scheduledDate = document.getElementById("edit-scheduled-date").value;
  if (!customer || !phone || !scheduledDate) {
    showToast("Asiakas, puhelin ja päivämäärä ovat pakollisia", "error");
    return;
  }
  const fulfillment = document.querySelector('input[name="edit-fulfillment"]:checked')?.value || "toimitus";

  try {
    await api(`/sales-orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({
        customer,
        customer_phone: phone,
        notes: document.getElementById("edit-notes").value.trim() || null,
        fulfillment_type: fulfillment,
        scheduled_date: scheduledDate,
        services: getSelectedServices("edit"),
      }),
    });
    closeModal();
    showToast("Tilaus päivitetty");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openNewPurchaseModal() {
  if (!products.length) {
    showToast("Luo ensin tuotteita", "error");
    return;
  }
  openModal(
    "Uusi ostotilaus",
    `<div class="form-group"><label>Toimittaja *</label><input id="po-supplier"></div>
     <div class="form-group"><label>Huomiot</label><textarea id="po-notes" rows="2"></textarea></div>
     <div class="form-group"><label>Rivit</label><div id="po-lines"></div>
     <button type="button" class="btn btn-secondary btn-sm" onclick="addLineRow('po-lines')">+ Lisää rivi</button></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-primary" onclick="savePurchaseOrder()">Tallenna ostotilaus</button>`
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
    showToast("Ostotilaus luotu – tilattu saldo päivitetty");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function approveSalesOrder(id) {
  try {
    await api(`/sales-orders/${id}/approve`, { method: "POST" });
    showToast("Tilaus hyväksytty – tuotteet varattu");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function cancelSalesOrder(id) {
  if (!confirm("Perutaanko tilaus?")) return;
  try {
    await api(`/sales-orders/${id}/cancel`, { method: "POST" });
    showToast("Tilaus peruttu");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openDeliverModal(orderId) {
  const order = salesOrders.find((o) => o.id === orderId);
  if (!order) {
    showToast("Lataa tilaukset uudelleen", "error");
    return;
  }

  const actionLabel = order.fulfillment_type === "nouto" ? "Nouda" : "Toimita";
  const linesHtml = order.lines
    .filter((l) => l.quantity_delivered < l.quantity)
    .map(
      (line) => `<div class="line-row">
        <span>${line.product_name} (jäljellä ${line.quantity - line.quantity_delivered})</span>
        <input type="number" class="deliver-qty" data-line-id="${line.id}" min="1" max="${line.quantity - line.quantity_delivered}" value="${line.quantity - line.quantity_delivered}">
      </div>`
    )
    .join("");

  openModal(
    `${actionLabel} ${order.order_number}`,
    `<p class="hint">${FULFILLMENT_LABELS[order.fulfillment_type]} ${formatDateOnly(order.scheduled_date)}. Poistaa tuotteet varastosaldosta.</p>${linesHtml}`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-primary" onclick="deliverOrder(${orderId})">Vahvista</button>`
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
    showToast("Tilaus käsitelty – saldo päivitetty");
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
        <span>${line.product_name} (jäljellä ${line.quantity - line.quantity_received})</span>
        <input type="number" class="receive-qty" data-line-id="${line.id}" min="1" max="${line.quantity - line.quantity_received}" value="${line.quantity - line.quantity_received}">
      </div>`
    )
    .join("");

  openModal(
    `Vastaanota ${order.order_number}`,
    `<p class="hint">Vastaanotto siirtää määrän tilatusta varastosaldoon.</p>${linesHtml}`,
    `<button class="btn btn-secondary" onclick="closeModal()">Peruuta</button>
     <button class="btn btn-success" onclick="receiveOrder(${orderId})">Vahvista vastaanotto</button>`
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
    showToast("Vastaanotto kirjattu – saldo päivitetty");
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
      <p><strong>Luotu:</strong> ${result.created} · <strong>Päivitetty:</strong> ${result.updated}</p>
      ${errors}`;
    showToast(`Tuonti valmis: ${result.created + result.updated} tuotetta`);
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
    if (!res.ok) throw new Error("Mallin lataus epäonnistui");
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
document.getElementById("scan-search-btn").addEventListener("click", handleScanSearch);
document.getElementById("scan-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleScanSearch();
});
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
    await api("/seed", { method: "POST" });
    showToast("Esimerkkidata ladattu");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
});

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
window.fillCustomerFromSelect = fillCustomerFromSelect;
window.openEditCustomerModal = openEditCustomerModal;
window.saveCustomer = saveCustomer;
window.saveCustomerEdit = saveCustomerEdit;

if (authToken && currentEmployee) {
  showApp();
  switchView("dashboard");
} else {
  showLogin();
}

initPwa();
