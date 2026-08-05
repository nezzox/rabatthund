# RabattHund

RabattHund ar en responsiv rabattjagare for svenska matkampanjer.
Sajten byggs for GitHub Pages och uppdaterar erbjudandedatan via GitHub Actions
kl. 08.00 och 15.00 svensk tid.

## Publicering

- GitHub Pages: https://nezzox.github.io/rabatthund/
- Repo: https://github.com/nezzox/rabatthund

## Uppdateringar

Workflowet `.github/workflows/pages.yml` kor `scripts/update-offers.mjs --live`,
bygger den statiska sajten till `pages-dist` och publicerar den till GitHub
Pages. Erbjudandedatabasen ligger i `public/data/offers.json`.
