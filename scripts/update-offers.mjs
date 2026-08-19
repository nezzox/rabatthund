import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ALL_SWEDEN = "Hela Sverige";
const databasePath = path.join(process.cwd(), "public", "data", "offers.json");

const providers = [
  { chain: "ICA", sourceUrl: "https://www.ica.se/erbjudanden/", status: "live" },
  { chain: "Coop", sourceUrl: "https://www.coop.se/butiker-erbjudanden/", status: "live" },
  { chain: "Willys", sourceUrl: "https://www.willys.se/erbjudanden", status: "live" },
  { chain: "Hemköp", sourceUrl: "https://www.hemkop.se/erbjudanden", status: "live" },
  { chain: "Lidl", sourceUrl: "https://www.lidl.se/c/reklamblad/s10018018", status: "live" },
  { chain: "City Gross", sourceUrl: "https://www.citygross.se/erbjudanden", status: "live" },
];

const axfoodChains = [
  {
    chain: "Willys",
    baseUrl: "https://www.willys.se",
    apiPrefix: "/axfood/rest/v1",
  },
  {
    chain: "Hemköp",
    baseUrl: "https://www.hemkop.se",
    apiPrefix: "/axfood/rest/v1",
  },
];

const icaApi = {
  chain: "ICA",
  tokenUrl: "https://www.ica.se/e11/public-access-token",
  baseUrl: "https://apim-pub.gw.ica.se/sverige/digx",
};

const coopApi = {
  chain: "Coop",
  storeMapUrl: "https://proxy.api.coop.se/external/store/stores/map?conceptIds=12,6,95&invertFilter=true&api-version=v2",
  promotionsUrl: "https://external.api.coop.se/personalization/search/products/promotions",
  storeSubscriptionKey: "990520e65cc44eef89e9e9045b57f4e9",
  promotionsSubscriptionKey: "3becf0ce306f41a1ae94077c16798187",
};

const cityGrossApi = {
  chain: "City Gross",
  baseUrl: "https://www.citygross.se",
  sitesPath: "/api/v1/sites?siteTypeId=3",
  offersPath: "/api/v1/Loop54/category/2930/products",
};

const lidlApi = {
  chain: "Lidl",
  overviewUrl: "https://www.lidl.se/c/reklamblad/s10018018",
  flyerUrl: "https://endpoints.leaflets.schwarz/v4/flyer",
};

const citiesToSample = [
  "Stockholm",
  "Göteborg",
  "Malmö",
  "Uppsala",
  "Västerås",
  "Norrköping",
  "Linköping",
  "Örebro",
  "Helsingborg",
  "Jönköping",
  "Umeå",
  "Lund",
  "Borås",
  "Eskilstuna",
  "Gävle",
  "Halmstad",
  "Karlstad",
  "Kalmar",
  "Växjö",
  "Luleå",
  "Sundsvall",
  "Skövde",
];

const requestHeaders = {
  "accept": "application/json",
  "accept-language": "sv-SE,sv;q=0.9,en;q=0.6",
  "user-agent": "RabattHund/0.2 (+https://nezzox.github.io/rabatthund/)",
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...requestHeaders,
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} från ${url}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      ...requestHeaders,
      "accept": "text/html,application/xhtml+xml",
    },
  });

  return {
    ok: response.ok,
    status: response.status,
    sourceUrl: url,
  };
}

async function fetchTextContent(url) {
  const response = await fetch(url, {
    headers: {
      ...requestHeaders,
      "accept": "text/html,application/xhtml+xml,text/plain",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} från ${url}`);
  }

  return response.text();
}

async function getFirstStoreForCity(chain, city) {
  const url = new URL(`${chain.baseUrl}${chain.apiPrefix}/search/store`);
  url.searchParams.set("q", city);
  url.searchParams.set("size", "12");

  const data = await fetchJson(url);
  const stores = data.results ?? [];
  const selected =
    stores.find((store) => normalizeCity(store.address?.town) === normalizeCity(city) && !store.externalPickupLocation) ??
    stores.find((store) => !store.externalPickupLocation) ??
    stores[0];

  if (!selected?.storeId) return null;

  return {
    id: selected.storeId,
    city: selected.address?.town || city,
    name: selected.displayName || selected.name || `${chain.chain} ${city}`,
  };
}

async function fetchAxfoodOffersForStore(chain, store, size = 40) {
  const url = new URL(`${chain.baseUrl}${chain.apiPrefix}/search/campaigns/offline`);
  url.searchParams.set("q", store.id);
  url.searchParams.set("size", String(size));

  const data = await fetchJson(url);
  return (data.results ?? [])
    .map((product) => mapAxfoodProduct(chain.chain, store, product))
    .filter(Boolean);
}

function mapAxfoodProduct(chain, store, product) {
  const promotion = product.potentialPromotions?.[0];
  if (!promotion) return null;

  let originalPrice = parseMoney(product.priceValue ?? product.priceNoUnit ?? product.price);
  const currentPrice = parseMoney(promotion.price?.value ?? promotion.price ?? promotion.rewardLabel ?? promotion.cartLabel);
  const savedAmount = parseMoney(promotion.savePrice);
  if (currentPrice && savedAmount && (!originalPrice || currentPrice >= originalPrice)) {
    originalPrice = roundMoney(currentPrice + savedAmount);
  }

  const dealText = currentPrice ? null : cleanLabel(promotion.rewardLabel || promotion.cartLabel || promotion.conditionLabel);
  const discountPercent =
    originalPrice && currentPrice && currentPrice < originalPrice
      ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
      : parseDiscountPercent(savedAmount, originalPrice);

  if (!discountPercent || discountPercent <= 0) return null;

  const validTo = parseSwedishCampaignDate(promotion.endDate) ?? parseTimestamp(promotion.validUntil);
  const brand = cleanBrand(product.manufacturer ?? product.brandName ?? product.brand ?? promotion.brands?.[0]);
  const article = formatArticleWithBrand(promotion.name || product.name, brand);
  const id = `${slug(chain)}-${promotion.code || product.code}-${slug(store.city)}`;

  return {
    id,
    article,
    brand,
    chain,
    cities: [store.city],
    originalPrice,
    currentPrice,
    dealText,
    unit: cleanUnit(product.priceUnit || promotion.weightVolume || product.displayVolume || "per styck"),
    discountPercent,
    validTo,
    source: "Axfood live",
    storeId: store.id,
    storeName: store.name,
  };
}

function mergeOffersByPromotion(offers) {
  const merged = new Map();

  for (const offer of offers) {
    const key = [
      offer.chain,
      offer.article.toLowerCase(),
      offer.originalPrice ?? "",
      offer.currentPrice ?? offer.dealText ?? "",
      offer.validTo ?? "",
    ].join("|");

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...offer, cities: [...offer.cities] });
      continue;
    }

    if (existing.cities.includes(ALL_SWEDEN)) {
      continue;
    }

    existing.cities = Array.from(new Set([...existing.cities, ...offer.cities])).sort((a, b) => a.localeCompare(b, "sv-SE"));
    if (existing.cities.length >= Math.max(8, citiesToSample.length * 0.7)) {
      existing.cities = [ALL_SWEDEN];
    }
  }

  return [...merged.values()].sort((a, b) => b.discountPercent - a.discountPercent || a.article.localeCompare(b.article, "sv-SE"));
}

async function fetchAxfoodChain(chain) {
  const offers = [];
  const stores = [];
  const errors = [];

  for (const city of citiesToSample) {
    try {
      const store = await getFirstStoreForCity(chain, city);
      if (!store) {
        errors.push({ city, error: "Ingen butik hittades" });
        continue;
      }

      stores.push(store);
      offers.push(...(await fetchAxfoodOffersForStore(chain, store)));
    } catch (error) {
      errors.push({ city, error: error.message });
    }
  }

  return {
    chain: chain.chain,
    ok: offers.length > 0,
    stores: stores.length,
    offers: offers.length,
    errors,
    data: mergeOffersByPromotion(offers),
  };
}

async function fetchIcaAccessToken() {
  const data = await fetchJson(icaApi.tokenUrl);
  if (!data.publicAccessToken) {
    throw new Error("ICA svarade utan publicAccessToken");
  }
  return data.publicAccessToken;
}

async function getIcaStoreForCity(token, city) {
  const url = new URL(`${icaApi.baseUrl}/storesearch/v1/searchbyquery`);
  url.searchParams.set("query", city);
  url.searchParams.set("take", "12");
  url.searchParams.set("offset", "0");

  const data = await fetchJson(url, { headers: icaAuthHeaders(token) });
  const stores = data.documents ?? [];
  const selected = stores
    .filter((store) => normalizeCity(store.visitingCity) === normalizeCity(city) || normalizeCity(store.name).includes(normalizeCity(city)))
    .sort((a, b) => scoreIcaStoreCandidate(b, city) - scoreIcaStoreCandidate(a, city))[0] ?? stores[0];

  if (!selected?.id) return null;

  return {
    id: selected.id,
    city: selected.visitingCity || city,
    name: selected.marketingName || selected.name || `ICA ${city}`,
  };
}

function scoreIcaStoreCandidate(store, city) {
  const profileScore = {
    maxi: 35,
    kvantum: 30,
    supermarket: 20,
    nara: 10,
    nära: 10,
  };
  const profile = normalizeCity(store.shortProfileName);
  let score = profileScore[profile] ?? 0;
  if (normalizeCity(store.visitingCity) === normalizeCity(city)) score += 100;
  if (normalizeCity(store.name).includes(normalizeCity(city))) score += 10;
  return score;
}

async function fetchIcaOffersForStore(token, store) {
  const url = `${icaApi.baseUrl}/offerreader/v1/offers/store/${store.id}`;
  const data = await fetchJson(url, { headers: icaAuthHeaders(token) });
  return (Array.isArray(data) ? data : [])
    .map((offer) => mapIcaOffer(store, offer))
    .filter(Boolean);
}

function mapIcaOffer(store, offer) {
  if (offer.discountType !== "FIXED") return null;

  const storeOffer = offer.stores?.find((item) => Number(item.BMSStoreId) === Number(store.id)) ?? offer.stores?.[0];
  const originalPrice = parseMoney(storeOffer?.regularPriceFrom ?? storeOffer?.regularPrice ?? offer.details?.regularPriceFrom);
  const requirementValue = Number(offer.requirementValue);
  const quantity =
    offer.requirementType === "QUANTITY" && Number.isInteger(requirementValue) && requirementValue > 1
      ? requirementValue
      : 1;
  const promotionTotal = parseMoney(offer.discountValue ?? offer.parsedMechanics?.value2);
  const currentPrice = promotionTotal && quantity > 1 ? roundMoney(promotionTotal / quantity) : promotionTotal;
  const discountPercent =
    originalPrice && currentPrice && currentPrice < originalPrice
      ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
      : null;

  if (!discountPercent || discountPercent <= 0) return null;

  const brand = cleanBrand(offer.details?.brand);
  const article = formatArticleWithBrand(formatArticleWithSize(offer.details?.name, offer.details?.packageInformation), brand);
  const dealText = quantity > 1 && promotionTotal ? `${quantity} för ${formatPrice(promotionTotal)} kr` : null;

  return {
    id: `ica-${offer.id}-${slug(store.city)}`,
    article,
    brand,
    chain: "ICA",
    cities: [store.city],
    originalPrice,
    currentPrice,
    dealText,
    unit: cleanUnit(offer.details?.unitOfMeasure || offer.comparisonPrice || "per styck"),
    discountPercent,
    validTo: parseIsoDate(offer.validTo),
    source: "ICA live",
    storeId: store.id,
    storeName: store.name,
  };
}

function icaAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function fetchIcaChain() {
  const offers = [];
  const stores = [];
  const errors = [];
  let token = "";

  try {
    token = await fetchIcaAccessToken();
  } catch (error) {
    return {
      chain: "ICA",
      ok: false,
      stores: 0,
      offers: 0,
      errors: [{ city: ALL_SWEDEN, error: error.message }],
      data: [],
    };
  }

  for (const city of citiesToSample) {
    try {
      const store = await getIcaStoreForCity(token, city);
      if (!store) {
        errors.push({ city, error: "Ingen ICA-butik hittades" });
        continue;
      }

      stores.push(store);
      offers.push(...(await fetchIcaOffersForStore(token, store)));
    } catch (error) {
      errors.push({ city, error: error.message });
    }
  }

  return {
    chain: "ICA",
    ok: offers.length > 0,
    stores: stores.length,
    offers: offers.length,
    errors,
    data: mergeOffersByPromotion(offers),
  };
}

async function fetchCoopStoreMap() {
  return fetchJson(coopApi.storeMapUrl, {
    headers: {
      "Ocp-Apim-Subscription-Key": coopApi.storeSubscriptionKey,
    },
  });
}

async function getCoopStoreForCity(stores, city) {
  const candidates = stores
    .filter((store) => normalizeCity(store.city) === normalizeCity(city) || normalizeCity(store.name).includes(normalizeCity(city)))
    .sort((a, b) => scoreCoopStoreCandidate(b, city) - scoreCoopStoreCandidate(a, city));

  for (const candidate of candidates) {
    const store = {
      id: candidate.ledgerAccountNumber,
      city: candidate.city || city,
      name: candidate.name || `Coop ${city}`,
    };
    const count = await fetchCoopOfferCount(store);
    if (count > 0) return { ...store, count };
  }

  return null;
}

function scoreCoopStoreCandidate(store, city) {
  let score = 0;
  if (normalizeCity(store.city) === normalizeCity(city)) score += 100;
  if (normalizeCity(store.name).includes("stora coop")) score += 25;
  if (normalizeCity(store.name).includes(normalizeCity(city))) score += 10;
  return score;
}

async function fetchCoopOfferCount(store) {
  const data = await fetchCoopPromotions(store, 1);
  return data.results?.count ?? 0;
}

async function fetchCoopOffersForStore(store, size = 120) {
  const data = await fetchCoopPromotions(store, size);
  return (data.results?.items ?? [])
    .map((product) => mapCoopProduct(store, product))
    .filter(Boolean);
}

async function fetchCoopPromotions(store, size) {
  const url = new URL(coopApi.promotionsUrl);
  url.searchParams.set("api-version", "v1");
  url.searchParams.set("store", store.id);
  url.searchParams.set("groups", "");
  url.searchParams.set("direct", "false");
  url.searchParams.set("only-primary", "true");

  return fetchJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Ocp-Apim-Subscription-Key": coopApi.promotionsSubscriptionKey,
    },
    body: JSON.stringify({
      resultsOptions: {
        skip: 0,
        take: size,
        sortBy: [],
        facets: [],
      },
      customData: {
        personalizeCampaigns: false,
        consent: {},
      },
    }),
  });
}

function mapCoopProduct(store, product) {
  const promotion = product.onlinePromotions?.[0];
  if (!promotion) return null;

  const quantity = Number(promotion.numberOfProductRequired) > 1 ? Number(promotion.numberOfProductRequired) : 1;
  const originalPrice = parseMoney(product.salesPriceData?.b2cPrice ?? product.piecePriceData?.b2cPrice);
  const promotionTotal = parseMoney(product.promotionPriceData?.b2cPrice ?? promotion.priceData?.b2cPrice);
  const currentPrice = promotionTotal && quantity > 1 ? roundMoney(promotionTotal / quantity) : promotionTotal;
  const discountPercent =
    originalPrice && currentPrice && currentPrice < originalPrice
      ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
      : null;

  if (!discountPercent || discountPercent <= 0) return null;

  const brand = cleanBrand(product.manufacturerName);
  const article = formatArticleWithBrand(formatArticleWithSize(product.name, product.packageSizeInformation), brand);
  const dealText = quantity > 1 && promotionTotal ? `${quantity} för ${formatPrice(promotionTotal)} kr` : null;
  const id = `coop-${product.id || product.ean || slug(article)}-${slug(store.city)}`;

  return {
    id,
    article,
    brand,
    chain: "Coop",
    cities: [store.city],
    originalPrice,
    currentPrice,
    dealText,
    unit: cleanUnit(product.comparativePriceText || product.salesUnit || product.packageSizeInformation || "per styck"),
    discountPercent,
    validTo: parseIsoDate(promotion.endDate),
    source: "Coop live",
    storeId: store.id,
    storeName: store.name,
  };
}

async function fetchCoopChain() {
  const offers = [];
  const stores = [];
  const errors = [];

  let storeMap = [];
  try {
    storeMap = await fetchCoopStoreMap();
  } catch (error) {
    return {
      chain: "Coop",
      ok: false,
      stores: 0,
      offers: 0,
      errors: [{ city: ALL_SWEDEN, error: error.message }],
      data: [],
    };
  }

  for (const city of citiesToSample) {
    try {
      const store = await getCoopStoreForCity(storeMap, city);
      if (!store) {
        errors.push({ city, error: "Ingen Coop-butik med livekampanjer hittades" });
        continue;
      }

      stores.push(store);
      offers.push(...(await fetchCoopOffersForStore(store)));
    } catch (error) {
      errors.push({ city, error: error.message });
    }
  }

  return {
    chain: "Coop",
    ok: offers.length > 0,
    stores: stores.length,
    offers: offers.length,
    errors,
    data: mergeOffersByPromotion(offers),
  };
}

async function fetchCityGrossStores() {
  const data = await fetchJson(`${cityGrossApi.baseUrl}${cityGrossApi.sitesPath}`);
  return data.sites ?? [];
}

function getCityGrossStoreForCity(stores, city) {
  const normalizedCity = normalizeCity(city);
  return stores
    .filter((store) => normalizeCity(store.city) === normalizedCity || normalizeCity(store.name).includes(normalizedCity))
    .sort((a, b) => scoreCityGrossStoreCandidate(b, city) - scoreCityGrossStoreCandidate(a, city))[0] ?? null;
}

function scoreCityGrossStoreCandidate(store, city) {
  let score = 0;
  if (normalizeCity(store.city) === normalizeCity(city)) score += 100;
  if (normalizeCity(store.name).includes(normalizeCity(city))) score += 20;
  return score;
}

async function fetchCityGrossOffersForStore(store) {
  const url = new URL(`${cityGrossApi.baseUrl}${cityGrossApi.offersPath}`);
  url.searchParams.set("currentWeekDiscountOnly", "true");
  url.searchParams.set("discountonly", "true");
  url.searchParams.set("skip", "0");
  url.searchParams.set("store", store.storeNumber);
  url.searchParams.set("take", "300");

  const data = await fetchJson(url);
  return (data.items ?? [])
    .map((product) => mapCityGrossProduct(store, product))
    .filter(Boolean);
}

function mapCityGrossProduct(store, product) {
  const prices = product.productStoreDetails?.prices;
  const promotion = prices?.activePromotion ?? prices?.promotions?.[0];
  if (!promotion) return null;

  const originalPrice = parseMoney(prices?.ordinaryPrice?.price);
  const currentPrice = parseMoney(promotion.priceDetails?.price ?? prices?.currentPrice?.price);
  const quantity = Number(promotion.minQuantity) > 1 ? Number(promotion.minQuantity) : 1;
  const promotionTotal = parseMoney(promotion.value);
  const discountPercent =
    originalPrice && currentPrice && currentPrice < originalPrice
      ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
      : null;

  if (!discountPercent || discountPercent <= 0) return null;

  const brand = cleanBrand(product.brand);
  const article = formatArticleWithBrand(formatArticleWithSize(product.name, product.descriptiveSize), brand);
  const dealText = quantity > 1 && promotionTotal ? `${quantity} för ${formatPrice(promotionTotal)} kr` : null;
  const id = `city-gross-${product.id || product.gtin || slug(article)}-${slug(store.city)}`;

  return {
    id,
    article,
    brand,
    chain: "City Gross",
    cities: [store.city],
    originalPrice,
    currentPrice,
    dealText,
    unit: cleanUnit(mapCityGrossUnit(promotion.priceDetails?.unit ?? prices?.ordinaryPrice?.unit)),
    discountPercent,
    validTo: parseIsoDate(promotion.to),
    source: "City Gross live",
    storeId: store.storeNumber,
    storeName: store.name,
  };
}

function mapCityGrossUnit(unit) {
  const normalized = String(unit || "").toUpperCase();
  if (normalized === "PCE") return "per st";
  if (normalized === "KGM") return "per kg";
  if (normalized === "LTR") return "per liter";
  return unit || "per styck";
}

async function fetchCityGrossChain() {
  const offers = [];
  const stores = [];
  const errors = [];

  let storeMap = [];
  try {
    storeMap = await fetchCityGrossStores();
  } catch (error) {
    return {
      chain: "City Gross",
      ok: false,
      stores: 0,
      offers: 0,
      errors: [{ city: ALL_SWEDEN, error: error.message }],
      data: [],
    };
  }

  for (const city of citiesToSample) {
    try {
      const store = getCityGrossStoreForCity(storeMap, city);
      if (!store) {
        errors.push({ city, error: "Ingen City Gross-butik hittades" });
        continue;
      }

      stores.push(store);
      offers.push(...(await fetchCityGrossOffersForStore(store)));
    } catch (error) {
      errors.push({ city, error: error.message });
    }
  }

  return {
    chain: "City Gross",
    ok: offers.length > 0,
    stores: stores.length,
    offers: offers.length,
    errors,
    data: mergeOffersByPromotion(offers),
  };
}

async function fetchLidlFlyerIdentifiers() {
  const html = await fetchTextContent(lidlApi.overviewUrl);
  return [...html.matchAll(/\/l\/sv\/reklamblad\/([^/"?#]+)\/ar\/0/g)]
    .map((match) => match[1])
    .filter((identifier, index, list) => list.indexOf(identifier) === index);
}

async function fetchLidlFlyer(identifier) {
  const url = new URL(lidlApi.flyerUrl);
  url.searchParams.set("flyer_identifier", identifier);
  const data = await fetchJson(url);
  return data.flyer;
}

function selectCurrentLidlFlyers(flyers) {
  const today = new Date().toISOString().slice(0, 10);
  return flyers
    .filter(Boolean)
    .filter((flyer) => !flyer.offerStartDate || !flyer.offerEndDate || (flyer.offerStartDate <= today && today <= flyer.offerEndDate))
    .filter((flyer) => normalizeCity(flyer.name).includes("alla-butiker") || normalizeCity(flyer.title).includes("erbjudanden"))
    .sort((a, b) => Number(normalizeCity(b.name).includes("alla-butiker")) - Number(normalizeCity(a.name).includes("alla-butiker")));
}

function parseLidlFlyerOffers(flyer) {
  const offers = [];
  for (const page of flyer.pages ?? []) {
    offers.push(...parseLidlPageOffers(flyer, page));
  }
  return offers;
}

function parseLidlPageOffers(flyer, page) {
  const tokens = normalizeLidlKeywords(page.keyWords).split(" ").filter(Boolean);
  const offers = [];

  for (let index = 0; index < tokens.length; index++) {
    const discount = parseLidlDiscountToken(tokens[index], tokens[index + 1]);
    if (!discount) continue;

    const discountEndIndex = discount.consumesNext ? index + 1 : index;
    const priceIndex = findLidlPriceTokenIndex(tokens, index);
    if (priceIndex === -1) continue;

    const currentPrice = parseLidlPriceToken(tokens[priceIndex]);
    if (!currentPrice || currentPrice < 1 || currentPrice > 1000) continue;

    const article = pickLidlArticle(tokens, priceIndex, index, discountEndIndex);
    if (!article || !isUsableLidlArticle(article)) continue;

    const originalPrice = roundMoney(currentPrice / (1 - discount.percent / 100));
    if (!originalPrice || originalPrice <= currentPrice) continue;

    offers.push({
      id: `lidl-${slug(article)}-${page.number}-${discount.percent}-${Math.round(currentPrice * 100)}`,
      article,
      brand: inferLidlBrand(article),
      chain: "Lidl",
      cities: [ALL_SWEDEN],
      originalPrice,
      currentPrice,
      dealText: null,
      unit: "per styck",
      discountPercent: discount.percent,
      validTo: flyer.offerEndDate ?? flyer.endDate ?? null,
      source: "Lidl reklamblad",
      storeId: "all",
      storeName: "Lidl alla butiker",
    });
  }

  return offers;
}

function normalizeLidlKeywords(value) {
  return String(value || "")
    .replace(/&Amp/gi, "&")
    .replace(/[﹪％]/g, "%")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLidlDiscountToken(token, nextToken) {
  const compact = String(token || "").replace(/[−–—]/g, "-");
  const match = compact.match(/^-?(\d{1,2})%$/);
  if (match) return { percent: Number(match[1]), consumesNext: false };
  const splitMatch = compact.match(/^-?(\d{1,2})$/);
  if (splitMatch && nextToken === "%") return { percent: Number(splitMatch[1]), consumesNext: true };
  return null;
}

function findLidlPriceTokenIndex(tokens, discountIndex) {
  for (let index = discountIndex - 1; index >= Math.max(0, discountIndex - 12); index--) {
    if (parseLidlDiscountToken(tokens[index], tokens[index + 1])) break;
    if (isLidlPriceToken(tokens[index]) && !isLidlReferencePrice(tokens, index)) return index;
  }
  for (let index = discountIndex + 1; index <= Math.min(tokens.length - 1, discountIndex + 5); index++) {
    if (isLidlPriceToken(tokens[index]) && !isLidlReferencePrice(tokens, index)) return index;
  }
  return -1;
}

function isLidlPriceToken(token) {
  return /^(\d{1,4}|\d{1,3}-)$/.test(String(token || ""));
}

function isLidlReferencePrice(tokens, index) {
  return normalizeCity(tokens[index - 1]) === "jfr" || normalizeCity(tokens[index - 2]) === "jfr";
}

function parseLidlPriceToken(token) {
  const value = String(token || "");
  if (value.endsWith("-")) return parseMoney(value);
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length <= 2) return Number(digits);
  return roundMoney(Number(digits) / 100);
}

function pickLidlArticle(tokens, priceIndex, discountIndex, discountEndIndex) {
  const between = cleanLidlArticleTokens(tokens.slice(priceIndex + 1, discountIndex));
  if (between.length >= 2 || (between.length === 1 && between[0].length >= 6)) {
    return between.slice(0, 8).join(" ");
  }

  const after = [];
  for (let index = discountEndIndex + 1; index < tokens.length && after.length < 8; index++) {
    const token = tokens[index];
    if (parseLidlDiscountToken(token, tokens[index + 1]) || isLidlPriceToken(token) || isLidlArticleStopToken(token)) break;
    if (!isLidlNoiseToken(token) && !isLidlNumericNoiseToken(token)) after.push(token);
  }

  if (after.length >= 2 || (after.length === 1 && after[0].length >= 6)) {
    return after.join(" ");
  }

  return null;
}

function cleanLidlArticleTokens(tokens) {
  return tokens
    .filter((token, index) => !parseLidlDiscountToken(token, tokens[index + 1]))
    .filter((token) => token !== "%")
    .filter((token) => !isLidlNumericNoiseToken(token))
    .filter((token) => !isLidlNoiseToken(token))
    .filter((token) => !isLidlArticleStopToken(token))
    .filter((token) => !isLidlPriceToken(token));
}

function isLidlNumericNoiseToken(token) {
  return /^\d{3,}$/.test(String(token || ""));
}

function isUsableLidlArticle(article) {
  const normalized = normalizeCity(article);
  if (/%|reservation|slutfor|avvikelse|www|jfr/.test(normalized)) return false;
  if (/\b\d{3,}\b/.test(article)) return false;
  return article.split(" ").length <= 6;
}

function isLidlNoiseToken(token) {
  return [
    "lidl",
    "plus",
    "superpris",
    "kampanj",
    "favoriter",
    "mega",
    "mega-",
    "max",
    "lag",
    "lagt",
    "pris",
    "pris!",
    "valj",
    "sorter",
    "ursprung",
    "jfr",
    "lagsta",
    "30-dgrs",
    "wwwww",
  ].includes(normalizeCity(token));
}

function isLidlArticleStopToken(token) {
  return ["region", "vecka", "man", "kampanjvaror", "tillfalligt", "besok", "butiker", "denna", "lagret"].includes(normalizeCity(token));
}

function inferLidlBrand(article) {
  const first = cleanLabel(article)?.split(" ")[0];
  if (!first || first.length < 3) return null;
  return cleanBrand(first);
}

async function fetchLidlChain() {
  const errors = [];
  let offers = [];

  try {
    const identifiers = await fetchLidlFlyerIdentifiers();
    const flyers = await Promise.all(
      identifiers.map(async (identifier) => {
        try {
          return await fetchLidlFlyer(identifier);
        } catch (error) {
          errors.push({ city: ALL_SWEDEN, error: `${identifier}: ${error.message}` });
          return null;
        }
      }),
    );

    const currentFlyers = selectCurrentLidlFlyers(flyers);
    for (const flyer of currentFlyers.slice(0, 1)) {
      offers.push(...parseLidlFlyerOffers(flyer));
    }
  } catch (error) {
    errors.push({ city: ALL_SWEDEN, error: error.message });
  }

  offers = mergeOffersByPromotion(offers);

  return {
    chain: "Lidl",
    ok: offers.length > 0,
    stores: offers.length > 0 ? 1 : 0,
    offers: offers.length,
    errors,
    data: offers,
  };
}

async function probeProvider(provider) {
  try {
    return {
      chain: provider.chain,
      status: provider.status,
      ...(await fetchText(provider.sourceUrl)),
    };
  } catch (error) {
    return {
      chain: provider.chain,
      status: provider.status,
      ok: false,
      error: error.message,
      sourceUrl: provider.sourceUrl,
    };
  }
}

async function main() {
  const live = process.argv.includes("--live");
  const probes = live ? await Promise.all(providers.map(probeProvider)) : [];
  const chainResults = live
    ? await Promise.all([
        fetchIcaChain(),
        ...axfoodChains.map(fetchAxfoodChain),
        fetchCoopChain(),
        fetchCityGrossChain(),
        fetchLidlChain(),
      ])
    : [];
  const liveOffers = chainResults.flatMap((result) => result.data);

  const database = {
    updatedAt: new Date().toISOString(),
    providers,
    probes,
    sourceStatus: chainResults.map(({ data, ...status }) => status),
    offers: liveOffers,
  };

  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, `${JSON.stringify(database, null, 2)}\n`, "utf8");
  console.log(`RabattHund skrev ${database.offers.length} live-erbjudanden till ${databasePath}`);
}

function parseMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
  if (!value) return null;

  const match = String(value)
    .replace(/\s/g, "")
    .replace(",", ".")
    .match(/(\d+(?:\.\d+)?)/);

  if (!match) return null;
  return roundMoney(Number(match[1]));
}

function parseDiscountPercent(saved, originalPrice) {
  if (!saved || !originalPrice) return null;
  return Math.round((saved / originalPrice) * 100);
}

function parseSwedishCampaignDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})-(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function cleanLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim() || null;
}

function cleanUnit(value) {
  const unit = cleanLabel(value)?.replace(/^kr\//i, "per ").replace(/^\/(.+)/, "per $1");
  if (!unit) return "per styck";
  if (/^(kg|g|st|l|liter|ml|cl|pack)$/i.test(unit)) return `per ${unit}`;
  return unit;
}

function cleanBrand(value) {
  const brand = cleanLabel(value)?.split("•")[0]?.replace(/\.\s*Sverige$/i, "").trim();
  if (!brand || brand === "-" || !/[\p{L}\p{N}]/u.test(brand)) return null;
  return brand;
}

function formatArticleWithBrand(article, brand) {
  const cleanArticle = cleanLabel(article);
  if (!brand || !cleanArticle) return cleanArticle ?? brand ?? "Okänd vara";

  const normalizedArticle = normalizeCity(cleanArticle);
  const normalizedBrand = normalizeCity(brand);
  if (normalizedArticle === normalizedBrand || normalizedArticle.startsWith(normalizedBrand) || normalizedArticle.includes(normalizedBrand)) {
    return cleanArticle;
  }

  return `${brand} ${cleanArticle}`;
}

function formatArticleWithSize(article, size) {
  const cleanArticle = cleanLabel(article);
  const cleanSize = cleanLabel(size);
  if (!cleanArticle || !cleanSize) return cleanArticle ?? cleanSize ?? "Okänd vara";

  if (normalizeCity(cleanArticle).includes(normalizeCity(cleanSize))) {
    return cleanArticle;
  }

  return `${cleanArticle} ${cleanSize}`;
}

function formatPrice(value) {
  return new Intl.NumberFormat("sv-SE", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function normalizeCity(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function slug(value) {
  return normalizeCity(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
