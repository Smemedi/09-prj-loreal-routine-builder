// Cloudflare Worker endpoint; the OpenAI API key stays in the Worker secret.
const WORKER_URL = "https://patient-scene-b9ce.sokol-memedi.workers.dev/";

const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectionSummary = document.getElementById("selectionSummary");
const resultCount = document.getElementById("resultCount");
const clearSelectionButton = document.getElementById("clearSelection");
const generateButton = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendBtn");

const STORAGE_KEY = "loreal-routine-selected-products";
let products = [];
let selectedProductIds = new Set();
let conversation = [];
let isBusy = false;
let hasGeneratedRoutine = false;

// Escape catalog content before placing it in HTML attributes or text markup.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const characters = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return characters[character];
  });
}

// Restore only IDs that still exist in the product catalog.
function restoreSelection() {
  try {
    const savedIds = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(savedIds)) {
      selectedProductIds = new Set(
        savedIds.filter((id) => products.some((product) => product.id === id))
      );
    }
  } catch (error) {
    selectedProductIds = new Set();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (storageError) {
      // The app can still run with an in-memory selection if storage is unavailable.
    }
  }
}

function saveSelection() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selectedProductIds]));
  } catch (error) {
    // Keep product selection usable when browser storage is disabled or full.
  }
}

function getSelectedProducts() {
  return products.filter((product) => selectedProductIds.has(product.id));
}

function populateCategories() {
  const categories = [...new Set(products.map((product) => product.category))].sort();
  categoryFilter.innerHTML = '<option value="">All categories</option>' + categories
    .map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category.replace(/\b\w/g, (letter) => letter.toUpperCase()))}</option>`)
    .join("");
}

function getFilteredProducts() {
  const searchTerm = productSearch.value.trim().toLowerCase();
  const category = categoryFilter.value.toLowerCase();

  return products.filter((product) => {
    const matchesCategory = !category || product.category.toLowerCase() === category;
    const searchableText = `${product.name} ${product.brand} ${product.category} ${product.description}`.toLowerCase();
    return matchesCategory && (!searchTerm || searchableText.includes(searchTerm));
  });
}

function renderProducts() {
  const visibleProducts = getFilteredProducts();
  resultCount.textContent = `${visibleProducts.length} ${visibleProducts.length === 1 ? "product" : "products"}`;

  if (!visibleProducts.length) {
    productsContainer.innerHTML = '<p class="empty-state">No products match your search. Try another name or category.</p>';
    return;
  }

  productsContainer.innerHTML = visibleProducts.map((product) => {
    const selected = selectedProductIds.has(product.id);
    return `
      <article class="product-card${selected ? " is-selected" : ""}">
        <button class="product-select" type="button" data-product-id="${escapeHTML(product.id)}" aria-pressed="${selected}" aria-label="${selected ? "Remove" : "Add"} ${escapeHTML(product.name)}">
          <span class="product-image-wrap"><img src="${escapeHTML(product.image)}" alt="" loading="lazy" onerror="this.hidden=true" /></span>
          <span class="product-info">
            <span class="product-brand">${escapeHTML(product.brand)}</span>
            <span class="product-name">${escapeHTML(product.name)}</span>
            <span class="product-category">${escapeHTML(product.category)}</span>
          </span>
          <span class="selection-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
        </button>
        <details class="product-description">
          <summary>Product details</summary>
          <p>${escapeHTML(product.description)}</p>
        </details>
      </article>`;
  }).join("");
}

function renderSelection() {
  const selectedProducts = getSelectedProducts();
  selectionSummary.textContent = selectedProducts.length
    ? `${selectedProducts.length} ${selectedProducts.length === 1 ? "product" : "products"} in your edit`
    : "Choose products to begin building your routine.";
  clearSelectionButton.disabled = selectedProducts.length === 0;

  if (!selectedProducts.length) {
    selectedProductsList.innerHTML = '<p class="selected-empty">Your selected products will appear here.</p>';
  } else {
    selectedProductsList.innerHTML = selectedProducts.map((product) => `
      <div class="selected-item">
        <span><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.brand)}</small></span>
        <button class="remove-product" type="button" data-remove-id="${escapeHTML(product.id)}" aria-label="Remove ${escapeHTML(product.name)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>`).join("");
  }
  generateButton.disabled = isBusy;
}

function updateSelection() {
  saveSelection();
  renderProducts();
  renderSelection();
}

function appendChatMessage(role, text, isLoading = false) {
  const message = document.createElement("div");
  message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}${isLoading ? " loading-message" : ""}`;

  if (role !== "user") {
    const mark = document.createElement("span");
    mark.className = "advisor-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "L";
    message.append(mark);
  }

  const content = document.createElement("p");
  content.textContent = text;
  message.append(content);
  chatWindow.append(message);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return message;
}

function setBusy(busy) {
  isBusy = busy;
  sendButton.disabled = busy || !hasGeneratedRoutine || !userInput.value.trim();
  userInput.disabled = busy || !hasGeneratedRoutine;
  generateButton.disabled = busy;
  chatForm.setAttribute("aria-busy", String(busy));
}

async function askWorker(messages) {
  if (!WORKER_URL) {
    throw new Error("The Cloudflare Worker URL is not configured yet. Deploy the Worker and set WORKER_URL in script.js.");
  }

  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("The Worker returned an unreadable response. Please try again.");
  }
  if (!response.ok) {
    throw new Error(data.error || `The request failed (${response.status}). Please try again shortly.`);
  }
  const reply = data.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("The advisor returned an empty response. Please try again.");
  }
  return reply.trim();
}

async function generateRoutine() {
  const selectedProducts = getSelectedProducts();
  if (!selectedProducts.length) {
    appendChatMessage("assistant", "Select at least one product before generating your routine.");
    return;
  }

  const productDetails = selectedProducts.map(({ name, brand, category, description }) => ({
    name,
    brand,
    category,
    description,
  }));
  const initialMessage = {
    role: "user",
    content: `Create a personalized routine using only these selected products. Organize products in a sensible order, explain when and how to use each, include morning and evening steps when appropriate, explain how the products fit together, and note relevant conflicts or precautions. Do not invent ingredients or claims. Clearly say when the supplied information is insufficient.\n\nSelected product information:\n${JSON.stringify(productDetails, null, 2)}`,
  };

  conversation = [initialMessage];
  hasGeneratedRoutine = false;
  chatWindow.innerHTML = "";
  appendChatMessage("user", `Build a routine using my ${selectedProducts.length} selected ${selectedProducts.length === 1 ? "product" : "products"}.`);
  await sendConversation(true);
}

async function sendConversation(isInitialRoutine = false) {
  setBusy(true);
  const loadingMessage = appendChatMessage("assistant", "Preparing guidance", true);

  try {
    const reply = await askWorker(conversation);
    conversation.push({ role: "assistant", content: reply });
    if (isInitialRoutine) hasGeneratedRoutine = true;
    loadingMessage.remove();
    appendChatMessage("assistant", reply);
  } catch (error) {
    loadingMessage.remove();
    appendChatMessage("assistant", error.message || "Something went wrong. Please try again.");
  } finally {
    setBusy(false);
    userInput.focus();
  }
}

productsContainer.addEventListener("click", (event) => {
  const button = event.target.closest("[data-product-id]");
  if (!button) return;
  const productId = Number(button.dataset.productId);
  if (selectedProductIds.has(productId)) selectedProductIds.delete(productId);
  else selectedProductIds.add(productId);
  updateSelection();
});

selectedProductsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-id]");
  if (!button) return;
  selectedProductIds.delete(Number(button.dataset.removeId));
  updateSelection();
});

clearSelectionButton.addEventListener("click", () => {
  selectedProductIds.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // The in-memory selection is still cleared when browser storage is unavailable.
  }
  renderProducts();
  renderSelection();
});

productSearch.addEventListener("input", renderProducts);
categoryFilter.addEventListener("change", renderProducts);
generateButton.addEventListener("click", generateRoutine);
userInput.addEventListener("input", () => {
  sendButton.disabled = isBusy || !hasGeneratedRoutine || !userInput.value.trim();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = userInput.value.trim();
  if (!message || isBusy || !hasGeneratedRoutine) return;

  conversation.push({ role: "user", content: message });
  appendChatMessage("user", message);
  userInput.value = "";
  sendButton.disabled = true;
  await sendConversation();
});

async function initialize() {
  try {
    const response = await fetch("products.json");
    if (!response.ok) throw new Error("Product catalog could not be loaded.");
    const data = await response.json();
    if (!Array.isArray(data.products)) throw new Error("Product catalog has an invalid format.");
    products = data.products;
    restoreSelection();
    populateCategories();
    renderProducts();
    renderSelection();
  } catch (error) {
    productsContainer.innerHTML = '<p class="empty-state">The product catalog could not be loaded. Refresh the page to try again.</p>';
    appendChatMessage("assistant", "I couldn't load the product catalog. Please refresh the page and try again.");
  }
}

initialize();
