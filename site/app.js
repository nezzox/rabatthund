const ALL_SWEDEN = "Hela Sverige";
const chains = ["ICA", "Coop", "Willys", "Hemköp", "Lidl", "City Gross"];
const root = document.getElementById("root");

const state = {
  view: "top",
  selectedCity: ALL_SWEDEN,
  selectedChain: "ICA",
  searchQuery: "",
  isCityPickerOpen: false,
  snapshot: { updatedAt: new Date().toISOString(), offers: [] },
};

fetch("./data/offers.json", { cache: "no-store" })
  .then((response) => response.json())
  .then((data) => {
    state.snapshot = data;
    render();
  })
  .catch(() => {
    root.innerHTML = "<main><h1>RabattHund</h1><p>Kunde inte läsa erbjudandedatan.</p></main>";
  });

function formatPrice(value) {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "okänt";
  return date.toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
}

function appliesToCity(offer, city) {
  return city === ALL_SWEDEN || offer.cities.includes(ALL_SWEDEN) || offer.cities.includes(city);
}

function sortedOffers(offers) {
  return [...offers].sort((a, b) => b.discountPercent - a.discountPercent);
}

function normalizedSearchTerm(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sv-SE")
    .trim();
}

function matchesSearch(offer, query) {
  const terms = normalizedSearchTerm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  const searchableText = normalizedSearchTerm([
    offer.article,
    offer.brand,
    offer.chain,
    offer.dealText,
  ].filter(Boolean).join(" "));

  return terms.every((term) => searchableText.includes(term));
}

function render() {
  const allOffers = state.snapshot.offers;
  const cities = Array.from(
    new Set(allOffers.flatMap((offer) => offer.cities).filter((city) => city !== ALL_SWEDEN)),
  ).sort((a, b) => a.localeCompare(b, "sv-SE"));

  const cityOffers = sortedOffers(allOffers.filter((offer) => appliesToCity(offer, state.selectedCity)));
  const searchOffers = cityOffers.filter((offer) => matchesSearch(offer, state.searchQuery));
  const visibleOffers =
    state.view === "top"
      ? sortedOffers(allOffers).slice(0, 10)
      : state.view === "store"
        ? cityOffers.filter((offer) => offer.chain === state.selectedChain)
        : state.view === "all"
          ? sortedOffers(allOffers)
          : state.view === "search"
            ? searchOffers
            : cityOffers;

  const heading =
    state.view === "top"
      ? "Top 10 kampanjer"
      : state.view === "store"
        ? `${state.selectedChain} i ${state.selectedCity}`
        : state.view === "all"
          ? "Alla butiker"
          : state.view === "search"
            ? state.searchQuery.trim()
              ? `Sökresultat: ${state.searchQuery.trim()}`
              : "Sök vara"
          : `Erbjudanden i ${state.selectedCity}`;

  root.innerHTML = `
    <main>
      <header class="app-header">
        <button class="brand" type="button" data-action="top" aria-label="Visa topplistan">
          <span class="dog-logo" aria-hidden="true">
            <span class="dog-ear dog-ear-left"></span><span class="dog-ear dog-ear-right"></span>
            <span class="dog-face"><span class="dog-eye dog-eye-left"></span><span class="dog-eye dog-eye-right"></span><span class="dog-nose"></span></span>
          </span>
          <span class="brand-copy"><span>RabattHund</span><small>nosar fram bästa priset</small></span>
        </button>
        <button class="location-pill" type="button" data-action="city">Ort: ${escapeHtml(state.selectedCity)}</button>
      </header>
      <nav class="menu-bar" aria-label="Huvudmeny">
        <button class="${state.view === "city" ? "active" : ""}" type="button" data-action="city">Min ort</button>
        <button class="${state.view === "store" ? "active" : ""}" type="button" data-action="store">Butik</button>
        <button class="${state.view === "all" ? "active" : ""}" type="button" data-action="all">Alla butiker</button>
        <button class="${state.view === "search" ? "active" : ""}" type="button" data-action="search">Sök vara</button>
      </nav>
      <section class="intro-band">
        <div><p class="eyebrow">Senast uppdaterad: ${escapeHtml(formatUpdatedAt(state.snapshot.updatedAt))}</p><h1>${escapeHtml(heading)}</h1></div>
        <div class="stat-strip" aria-label="Sammanfattning"><span>${visibleOffers.length} erbjudanden</span><span>${chains.length} kedjor</span></div>
      </section>
      ${state.view === "city" || state.view === "store" || state.view === "search" ? cityPicker(cities) : ""}
      ${state.view === "store" ? chainGrid() : ""}
      ${state.view === "search" ? searchControl() : ""}
      <section class="offer-list" aria-label="${escapeHtml(heading)}">${visibleOffers.map(renderOffer).join("")}</section>
    </main>
  `;

  if (state.view === "search") {
    const searchField = document.getElementById("product-search");
    searchField?.focus({ preventScroll: true });
    searchField?.setSelectionRange(searchField.value.length, searchField.value.length);
  }
}

function cityPicker(cities) {
  const options = [ALL_SWEDEN, ...cities]
    .map(
      (city) =>
        `<button aria-selected="${state.selectedCity === city}" class="${state.selectedCity === city ? "chosen" : ""}" role="option" type="button" data-city="${escapeHtml(city)}">${escapeHtml(city)}</button>`,
    )
    .join("");

  return `<section class="control-band" aria-label="Välj ort">
    <span class="control-label">Min ort</span>
    <div class="city-picker">
      <button aria-expanded="${state.isCityPickerOpen}" aria-haspopup="listbox" class="city-picker-button" type="button" data-action="toggle-city-picker">
        <span>${escapeHtml(state.selectedCity)}</span><span class="chevron" aria-hidden="true"></span>
      </button>
      ${state.isCityPickerOpen ? `<div class="city-picker-list" role="listbox" aria-label="Städer">${options}</div>` : ""}
    </div>
  </section>`;
}

function chainGrid() {
  return `<section class="chain-grid" aria-label="Välj butikskedja">${chains
    .map(
      (chain) =>
        `<button class="${state.selectedChain === chain ? "selected" : ""}" type="button" data-chain="${escapeHtml(chain)}">${escapeHtml(chain)}</button>`,
    )
    .join("")}</section>`;
}

function searchControl() {
  return `<section class="search-band" role="search">
    <label for="product-search">Sök vara</label>
    <input id="product-search" type="search" inputmode="search" autocomplete="off" placeholder="Till exempel ost" value="${escapeHtml(state.searchQuery)}" />
  </section>`;
}

function renderOffer(offer) {
  const original = formatPrice(offer.originalPrice);
  const current = formatPrice(offer.currentPrice);
  const price = offer.dealText
    ? `<span class="deal-text">${escapeHtml(offer.dealText)}</span>`
    : `${original ? `<span class="old-price">${escapeHtml(original)}</span>` : ""}${current ? `<span class="new-price">${escapeHtml(current)}</span>` : ""}`;

  return `<article class="offer-row">
    <div class="offer-main"><div><h3>${escapeHtml(offer.article)}</h3><p>${escapeHtml(offer.chain)}</p></div><strong>${Math.round(offer.discountPercent)}%</strong></div>
    <div class="price-line">${price}<span>${escapeHtml(offer.unit)}</span></div>
    <div class="offer-meta"><span>Gäller i ${escapeHtml(offer.cities.includes(ALL_SWEDEN) ? ALL_SWEDEN : offer.cities.join(", "))}</span><span>${offer.validTo ? `t.o.m. ${escapeHtml(offer.validTo)}` : "Aktuellt online"}</span></div>
  </article>`;
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  const action = target.dataset.action;
  if (action === "top") state.view = "top";
  if (action === "city") state.view = "city";
  if (action === "store") state.view = "store";
  if (action === "search") {
    state.view = "search";
    state.isCityPickerOpen = false;
  }
  if (action === "all") {
    state.selectedCity = ALL_SWEDEN;
    state.view = "all";
    state.isCityPickerOpen = false;
  }
  if (action === "toggle-city-picker") state.isCityPickerOpen = !state.isCityPickerOpen;
  if (target.dataset.city) {
    state.selectedCity = target.dataset.city;
    state.isCityPickerOpen = false;
    if (state.view !== "store" && state.view !== "search") state.view = "city";
  }
  if (target.dataset.chain) state.selectedChain = target.dataset.chain;
  render();
});

root.addEventListener("input", (event) => {
  if (event.target.id !== "product-search") return;
  state.searchQuery = event.target.value;
  render();
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

