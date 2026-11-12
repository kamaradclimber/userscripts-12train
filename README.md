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
  will search. It searches using the default traveller's age and stored reduction cards (a fresh
  install defaults to one adult with FN30);
- after you tap a fare price, automatically clicks the revealed **"Sélectionner ce trajet"**
  button. This selects the train but does not purchase it; booking and payment remain native;
- **auto-fill of the booking form** (prénom, nom, date de naissance) as soon as the passenger
  form appears after you pick a train;
- a **⚙ traveller manager** to add, edit, remove, and choose a default traveller. Each profile
  can store its name, birth date, and reduction cards. The quick-search button still searches
  only for the default traveller; selecting additional family members for a search is a later step.

Nothing personal is hard-coded in the script; details are stored in that browser's
`localStorage` (no cloud, no sync — install and configure on each device). The data lives under
`t12.store` as a versioned JSON document (`schemaVersion`), ready for future traveller profiles.
Local storage is not encrypted and is accessible to scripts running on the 12train origin and to
anyone with access to that browser. The script migrates the existing flat `t12_*` keys and leaves
them in place for rollback. If the new document is corrupt, it backs up the raw value before
resetting; if it sees a newer schema, it preserves it read-only and asks you to update the
script.

## Install (Firefox)

**Desktop** and **Android** alike:

1. Install [Violentmonkey](https://violentmonkey.github.io/) (or Tampermonkey).
   - Desktop: from [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/).
   - Android: from the Add-ons menu in Firefox Nightly/Beta (or via the collections workaround).
2. Create a new script, paste the content of [`12train-next-train.user.js`](12train-next-train.user.js), save.
3. Open [12train.com](https://www.12train.com), tap the ⚙ button, complete your traveller
   profile, select your reduction card, and mark yourself as the default traveller. Existing
   details from earlier script versions migrate automatically.

## Tests

The `test-*.js` files are Playwright (Firefox) end-to-end checks, run against the real site.
They live-test the fragile parts (DOM selectors, POST payload, floating labels):

```
npm i playwright  # once
node test-intercept.js     # verifies the exact search POST payload (FN30 included)
node test-live-search.js   # full search, real results returned
node test-no-card.js       # baseline: same search without the card (price delta proof)
node test-booking-fill.js  # price tap → auto-select fare → booking form auto-filled
node test-direction.js          # verifies both directions and the button label around noon
node test-storage-migrations.js # legacy, corrupt, and future-schema migration checks
node test-traveller-manager.js  # add a traveller, store Rémi Liberté Jeune, search with default only
```

If 12train changes its DOM, one of these will fail and show what to fix.

## Maintenance notes

The script relies on 12train's internal page structure (element IDs and CSS classes): station
codes (`FRQTJ` Chartres, `FRPMO` Paris Montparnasse), the site's current card catalogue, and the
IDs of the search/booking form inputs. The card list is parsed from the site's catalogue bundle;
a fresh profile starts with card `FN30`. Searches use the site's own code: the script only
fills the form and clicks *Rechercher*, so the payment and booking flow stays 100% native.

## Licence

MIT — see [LICENSE](LICENSE).