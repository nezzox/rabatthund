import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ALL_SWEDEN = "Hela Sverige";
const databasePath = path.join(process.cwd(), "public", "data", "offers.json");

const providers = [
  { chain: "ICA", sourceUrl: "https://www.ica.se/erbjudanden/", status: "pending-fetcher" },
  { chain: "Coop", sourceUrl: "https://www.coop.se/butiker-erbjudanden/", status: "pending-fetcher" },
  { chain: "Willys", sourceUrl: "https://www.willys.se/erbjudanden", status: "live" },
  { chain: "Hemköp", sourceUrl: "https://www.hemkop.se/erbjudanden", status: "live" },
  { chain: "Lidl", sourceUrl: "https://www.lidl.se/c/reklamblad/s10018018", status: "pending-fetcher" },
  { chain: "City Gross", sourceUrl: "https://www.citygross.se/erbjudanden", status: "pending-fetcher" },
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

async function fetchJson(url) {
  const response = await fetch(url, { headers: requestHeaders });
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
  const article = promotion.name || product.name;
  const id = `${slug(chain)}-${promotion.code || product.code}-${slug(store.city)}`;

  return {
    id,
    article,
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
  const axfoodResults = live ? await Promise.all(axfoodChains.map(fetchAxfoodChain)) : [];
  const liveOffers = axfoodResults.flatMap((result) => result.data);

  const database = {
    updatedAt: new Date().toISOString(),
    providers,
    probes,
    sourceStatus: axfoodResults.map(({ data, ...status }) => status),
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

function cleanLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim() || null;
}

function cleanUnit(value) {
  return cleanLabel(value)?.replace(/^kr\//i, "per ") ?? "per styck";
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
