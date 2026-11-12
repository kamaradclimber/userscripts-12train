# 12train userscripts

[12train.com](https://www.12train.com) is an independent SNCF distributor: same prices and
exchange/refund conditions as SNCF, but with a much faster purchase flow. It's the quickest
way to buy a train ticket on the go.

It has a few gaps, though:

- no way to **store a reduction card** (it must be re-selected, per passenger, on every search),
- no way to **store passenger identity** (first name, last name, birth date are re-entered on
  every booking),
- **no deep-linkable search**: no URL to bookmark a frequent journey.

I asked the owner about this and it's been "on the roadmap" for 1.5 years now. Until 12train
implements these features natively, a userscript is a good way to fill the gaps: it runs in the
page, uses the real form and the real session, and adds the two things that are missing —
saved preferences and one-tap access to a frequent journey.

## What the script does

`12train-next-train.user.js` adds to [12train.com](https://www.12train.com):

- a floating **"Next train …"** button: one tap searches the next trains *today*, from the
  next valid hour — **Chartres → Montparnasse before noon in Europe/Paris**, then
  **Montparnasse → Chartres from noon**. The button's label updates to show the direction it
  will search. It searches for one adult with the **Carte Famille Nombreuse 30%** (FN30)
  pre-selected — no card re-selection needed;
- **auto-fill of the booking form** (prénom, nom, date de naissance) as soon as the passenger
  form appears after you pick a train;
- a **⚙ button** to store your identity + card number once, in `localStorage`, per browser.

Nothing personal is hard-coded in the script; everything is stored in your browser's
`localStorage` (no cloud, no sync — install and configure on each device).

## Install (Firefox)

**Desktop** and **Android** alike:

1. Install [Violentmonkey](https://violentmonkey.github.io/) (or Tampermonkey).
   - Desktop: from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/).
   - Android: from the Add-ons menu in Firefox Nightly/Beta (or via the collections workaround).
2. Create a new script, paste the content of [`12train-next-train.user.js`](12train-next-train.user.js), save.
3. Open [12train.com](https://www.12train.com), tap the ⚙ button, enter your
   prénom / nom / date de naissance (JJ/MM/AAAA) / card number (leave empty if the site
   doesn't ask for one). Done.

## Tests

The `test-*.js` files are Playwright (Firefox) end-to-end checks, run against the real site.
They live-test the fragile parts (DOM selectors, POST payload, floating labels):

```
npm i playwright  # once
node test-intercept.js     # verifies the exact search POST payload (FN30 included)
node test-live-search.js   # full search, real results returned
node test-no-card.js       # baseline: same search without the card (price delta proof)
node test-booking-fill.js  # search → pick train → booking form auto-filled
node test-direction.js     # verifies both directions and the button label around noon
```

If 12train changes its DOM, one of these will fail and show what to fix.

## Maintenance notes

The script relies on 12train's internal page structure (element IDs and CSS classes): station
codes (`FRQTJ` Chartres, `FRPMO` Paris Montparnasse), card code `FN30`, and the IDs of the
search/booking form inputs. The searches are performed by the site's own code (the script only
fills the form and clicks *Rechercher*), so the payment and booking flow stays 100% native.

## Licence

MIT — see [LICENSE](LICENSE).