import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ALL_SWEDEN = "Hela Sverige";
const databasePath = path.join(process.cwd(), "public", "data", "offers.json");

const providers = [
  { chain: "ICA", sourceUrl: "https://www.ica.se/erbjudanden/" },
  { chain: "Coop", sourceUrl: "https://www.coop.se/handla/erbjudanden/" },
  { chain: "Willys", sourceUrl: "https://www.willys.se/erbjudanden" },
  { chain: "Hemköp", sourceUrl: "https://www.hemkop.se/erbjudanden" },
  { chain: "Lidl", sourceUrl: "https://www.lidl.se/c/erbjudanden/s10025573" },
  { chain: "City Gross", sourceUrl: "https://www.citygross.se/erbjudanden" },
];

const seedOffers = [
  offer("ica-001", "ICA", "Kaffe mellanrost 450 g", [ALL_SWEDEN], 69.95, 39.95, null, "per paket", "2026-08-11"),
  offer("coop-001", "Coop", "Färsk kycklingfilé", ["Stockholm", "Uppsala", "Västerås"], 129, 79, null, "per kg", "2026-08-11"),
  offer("willys-001", "Willys", "Pasta 500 g", [ALL_SWEDEN], 16.95, 9.95, null, "per förpackning", "2026-08-10"),
  offer("hemkop-001", "Hemköp", "Ekologiska bananer", ["Göteborg", "Malmö", "Lund", "Helsingborg"], 29.95, 19.95, null, "per kg", "2026-08-11"),
  offer("lidl-001", "Lidl", "Grekisk yoghurt 1 kg", [ALL_SWEDEN], 34.95, 19.95, null, "per hink", "2026-08-09"),
  offer("citygross-001", "City Gross", "Nötfärs 12%", ["Linköping", "Norrköping", "Jönköping", "Växjö"], 119, 79.95, null, "per kg", "2026-08-11"),
  offer("ica-002", "ICA", "Frukostflingor", ["Stockholm", "Göteborg", "Malmö"], 39.95, null, "3 för 2", "utvalda sorter", "2026-08-11", 33),
  offer("coop-002", "Coop", "Lagrad ost 700 g", [ALL_SWEDEN], 89.95, 59.95, null, "per bit", "2026-08-12"),
  offer("willys-002", "Willys", "Tvättmedel storpack", ["Örebro", "Karlstad", "Eskilstuna", "Västerås"], 99.95, 49.95, null, "per förpackning", "2026-08-10"),
  offer("hemkop-002", "Hemköp", "Färska räkor", ["Göteborg", "Halmstad", "Malmö"], 249, 149, null, "per kg", "2026-08-08"),
  offer("lidl-002", "Lidl", "Glasspinnar multipack", [ALL_SWEDEN], 44.95, 24.95, null, "per paket", "2026-08-09"),
  offer("citygross-002", "City Gross", "Laxfilé portionsbitar", ["Umeå", "Luleå", "Sundsvall", "Gävle"], 179, 99, null, "per kg", "2026-08-11"),
  offer("ica-003", "ICA", "Tomater i ask", ["Kalmar", "Växjö", "Skövde", "Borås"], 34.95, 19.95, null, "500 g", "2026-08-11"),
  offer("coop-003", "Coop", "Mineralvatten 1,5 l", [ALL_SWEDEN], 18, null, "5 för 45 kr", "exkl. pant", "2026-08-12", 50),
  offer("willys-003", "Willys", "Falukorv 800 g", [ALL_SWEDEN], 49.95, 29.95, null, "per ring", "2026-08-10"),
  offer("hemkop-003", "Hemköp", "Bröd från bageriet", ["Stockholm", "Uppsala", "Gävle"], 35, null, "2 för 45 kr", "utvalda sorter", "2026-08-11", 36),
  offer("lidl-003", "Lidl", "Mozzarella 125 g", [ALL_SWEDEN], 16.95, 9.95, null, "per styck", "2026-08-09"),
  offer("citygross-003", "City Gross", "Grillkorv 900 g", [ALL_SWEDEN], 59.95, 34.95, null, "per paket", "2026-08-11"),
];

function offer(id, chain, article, cities, originalPrice, currentPrice, dealText, unit, validTo, explicitDiscount) {
  const discountPercent =
    explicitDiscount ?? Math.round(((Number(originalPrice) - Number(currentPrice)) / Number(originalPrice)) * 100);

  return {
    id,
    article,
    chain,
    cities,
    originalPrice,
    currentPrice,
    dealText,
    unit,
    discountPercent,
    validTo,
  };
}

async function probeProvider(provider) {
  const response = await fetch(provider.sourceUrl, {
    headers: {
      "accept-language": "sv-SE,sv;q=0.9,en;q=0.6",
      "user-agent": "RabattHund/0.1 (+https://github.com/nezzox/rabatthund)",
    },
  });

  return {
    chain: provider.chain,
    ok: response.ok,
    status: response.status,
    sourceUrl: provider.sourceUrl,
  };
}

async function main() {
  const live = process.argv.includes("--live");
  const probes = live ? await Promise.allSettled(providers.map(probeProvider)) : [];
  const database = {
    updatedAt: new Date().toISOString(),
    providers,
    probes: probes.map((result) => (result.status === "fulfilled" ? result.value : { ok: false, error: result.reason?.message })),
    offers: seedOffers,
  };

  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, `${JSON.stringify(database, null, 2)}\n`, "utf8");
  console.log(`RabattHund skrev ${database.offers.length} erbjudanden till ${databasePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
