// ==UserScript==
// @name         12train — Next train Chartres ↔ Montparnasse
// @namespace    https://12train.com/
// @homepageURL  https://github.com/kamaradclimber/userscripts-12train/blob/main/12train-next-train.user.js
// @source       https://github.com/kamaradclimber/userscripts-12train/blob/main/12train-next-train.user.js
// @version      1.5
// @description  One-tap search on 12train.com: direction switches at noon Europe/Paris. Pre-selects FN30, automatically selects a fare after its price is tapped, and auto-fills booking details.
// @match        https://www.12train.com/*
// @match        https://12train.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration: journey
  // ---------------------------------------------------------------------------
  const CHARTRES = { name: 'Chartres', code: 'FRQTJ' };
  const MONTPARNASSE = { name: 'Paris Montparnasse', code: 'FRPMO' };
  const TIME_ZONE = 'Europe/Paris';

  function getParisHour() {
    return Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()));
  }

  function getJourneyForCurrentTime() {
    if (getParisHour() < 12) {
      return {
        origin: CHARTRES,
        destination: MONTPARNASSE,
        label: 'Next train Chartres → Montparnasse',
      };
    }
    return {
      origin: MONTPARNASSE,
      destination: CHARTRES,
      label: 'Next train Montparnasse → Chartres',
    };
  }

  function refreshButtonLabel() {
    const button = document.getElementById('t12-next-train-btn');
    if (button) button.textContent = getJourneyForCurrentTime().label;
  }

  const CARD_CODE = 'FN30';
  const CARD_LABEL = 'Carte Famille Nombreuse 30%';

  // ---------------------------------------------------------------------------
  // Versioned local data. Personal data stays in this browser, never in source.
  // Legacy flat keys are migrated but deliberately left untouched for rollback.
  // ---------------------------------------------------------------------------
  const STORE_KEY = 't12.store';
  const STORE_SCHEMA_VERSION = 1;
  const STORE_BACKUP_PREFIX = `${STORE_KEY}.corrupt.`;
  let storeReadOnly = false;
  let storageAvailable = true;
  let storageNoticeMessage = '';

  function emptyStore() {
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      travellers: [{
        id: 'default-traveller',
        isDefault: true,
        firstName: '',
        lastName: '',
        birthDate: '',
        cards: [{ code: CARD_CODE, cardNumber: '' }],
      }],
    };
  }

  function migrateLegacyV0ToV1() {
    const readLegacy = (key) => {
      try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    };
    const cardNumber = readLegacy('t12_card_number') || readLegacy('t12_fn30_number');
    const migrated = emptyStore();
    const me = migrated.travellers[0];
    me.firstName = readLegacy('t12_first_name');
    me.lastName = readLegacy('t12_last_name');
    me.birthDate = readLegacy('t12_birth_date');
    me.cards[0].cardNumber = cardNumber;
    return migrated;
  }

  const STORE_MIGRATIONS = {
    0: migrateLegacyV0ToV1,
  };

  function isValidStore(data) {
    if (!data || !Number.isInteger(data.schemaVersion) || !Array.isArray(data.travellers)) return false;
    if (data.schemaVersion > STORE_SCHEMA_VERSION) return true; // preserve newer data read-only
    if (data.schemaVersion !== STORE_SCHEMA_VERSION || data.travellers.length === 0) return false;
    let defaultCount = 0;
    for (const traveller of data.travellers) {
      if (!traveller || typeof traveller.id !== 'string' || typeof traveller.isDefault !== 'boolean') return false;
      if (traveller.isDefault) defaultCount++;
      if (typeof traveller.firstName !== 'string' || typeof traveller.lastName !== 'string'
          || typeof traveller.birthDate !== 'string' || !Array.isArray(traveller.cards)) return false;
      if (!traveller.cards.every((card) => card && typeof card.code === 'string'
          && typeof card.cardNumber === 'string')) return false;
    }
    return defaultCount === 1;
  }

  function persistStore(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      storageAvailable = true;
      return true;
    } catch (e) {
      storageAvailable = false;
      storageNoticeMessage = '12train: impossible d’enregistrer les données dans le stockage local de ce navigateur.';
      return false;
    }
  }

  function backupCorruptStore(raw) {
    const backupKey = `${STORE_BACKUP_PREFIX}${Date.now()}`;
    try {
      localStorage.setItem(backupKey, raw);
      return true;
    } catch (e) {
      storeReadOnly = true;
      storageNoticeMessage = '12train: données locales illisibles. La sauvegarde de récupération a échoué; aucune donnée n’a été remplacée.';
      return false;
    }
  }

  function recoverCorruptStore(raw) {
    if (!backupCorruptStore(raw)) return emptyStore();
    storageNoticeMessage = '12train: les données locales étaient illisibles. Une copie a été sauvegardée; le profil a été réinitialisé.';
    const fresh = emptyStore();
    persistStore(fresh);
    return fresh;
  }

  function loadStore() {
    let raw;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      storageAvailable = false;
      storageNoticeMessage = '12train: stockage local indisponible; les informations ne seront pas conservées.';
      return emptyStore();
    }

    if (raw === null) {
      // Version 0 consisted of individual t12_* keys (including both historical
      // card-number keys). Migrate those once, and keep the old keys as backup.
      const migrated = migrateLegacyV0ToV1();
      persistStore(migrated);
      return migrated;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return recoverCorruptStore(raw);
    }

    if (!parsed || !Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 0) {
      return recoverCorruptStore(raw);
    }
    if (parsed.schemaVersion > STORE_SCHEMA_VERSION) {
      storeReadOnly = true;
      storageNoticeMessage = '12train: les données ont été créées par une version plus récente du script. Mettez le script à jour avant de modifier vos profils.';
      return emptyStore();
    }

    let migrated = parsed;
    while (migrated.schemaVersion < STORE_SCHEMA_VERSION) {
      const migration = STORE_MIGRATIONS[migrated.schemaVersion];
      if (!migration) return recoverCorruptStore(raw);
      migrated = migration(migrated);
    }
    if (!isValidStore(migrated)) return recoverCorruptStore(raw);
    if (migrated !== parsed) persistStore(migrated);
    return migrated;
  }

  let travellerStore = loadStore();

  window.addEventListener('storage', (event) => {
    if (event.key !== STORE_KEY && event.key !== null) return;
    if (event.newValue === null) {
      storeReadOnly = true;
      storageNoticeMessage = '12train: les données locales ont été supprimées ou modifiées dans un autre onglet. Rechargez la page avant de modifier vos profils.';
      showStorageNotice();
      return;
    }
    try {
      const latest = JSON.parse(event.newValue);
      if (latest.schemaVersion > STORE_SCHEMA_VERSION) {
        storeReadOnly = true;
        storageNoticeMessage = '12train: les données ont été créées par une version plus récente du script. Mettez le script à jour avant de modifier vos profils.';
      } else if (isValidStore(latest)) {
        travellerStore = latest;
      } else {
        storeReadOnly = true;
        storageNoticeMessage = '12train: les données locales ont changé dans un autre onglet. Rechargez la page avant de modifier vos profils.';
      }
    } catch (e) {
      storeReadOnly = true;
      storageNoticeMessage = '12train: les données locales sont illisibles dans un autre onglet. Rechargez la page avant de modifier vos profils.';
    }
    if (storageNoticeMessage) showStorageNotice();
  });

  function getDefaultTraveller(data = travellerStore) {
    return data.travellers.find((traveller) => traveller.isDefault) || data.travellers[0];
  }

  function getIdentity() {
    const me = getDefaultTraveller();
    const familyCard = me.cards.find((card) => card.code === CARD_CODE);
    return {
      firstName: me.firstName,
      lastName: me.lastName,
      birthDate: me.birthDate,
      cardNumber: familyCard ? familyCard.cardNumber : '',
    };
  }

  function saveDefaultIdentity(identity) {
    if (storeReadOnly || !storageAvailable) return false;

    // Re-read immediately before writing so a stale tab preserves any other
    // travellers added or edited by a newer tab.
    let latest = travellerStore;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion > STORE_SCHEMA_VERSION) {
          storeReadOnly = true;
          storageNoticeMessage = '12train: les données ont été créées par une version plus récente du script. Mettez le script à jour avant de modifier vos profils.';
          return false;
        }
        if (!isValidStore(parsed)) {
          storageNoticeMessage = '12train: le stockage a changé ou est invalide. Rechargez la page avant de réessayer.';
          return false;
        }
        latest = parsed;
      }
    } catch (e) {
      storageNoticeMessage = '12train: impossible de relire les données locales. Rechargez la page avant de réessayer.';
      return false;
    }

    const me = getDefaultTraveller(latest);
    me.firstName = identity.firstName;
    me.lastName = identity.lastName;
    me.birthDate = identity.birthDate;
    let familyCard = me.cards.find((card) => card.code === CARD_CODE);
    if (!familyCard) {
      familyCard = { code: CARD_CODE, cardNumber: '' };
      me.cards.push(familyCard);
    }
    familyCard.cardNumber = identity.cardNumber;
    latest.updatedAt = new Date().toISOString();

    if (!persistStore(latest)) return false;
    travellerStore = latest;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, '0');

  function parseBirthDate(raw) {
    if (!raw) return null;
    let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); // YYYY-MM-DD
    if (m) return { day: m[3], month: m[2], year: m[1] };
    m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);      // DD/MM/YYYY
    if (m) return { day: m[1], month: m[2], year: m[3] };
    return null;
  }

  // Set a value only if the field is empty, then fire an "input" event so the
  // site's floating-label behavior shrinks the label like a real keystroke.
  function setIfEmpty(input, value) {
    if (!input || !value || input.value) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setStation(input, station) {
    if (!input) return;
    input.value = station.name;
    input.dataset.stationCode = station.code;
    input.dataset.stationName = station.name;
  }

  function setToday(dateEl) {
    const now = new Date();
    if (dateEl._flatpickr) {
      // Properly updates flatpickr state + input value (d/m/Y) + dataset.
      dateEl._flatpickr.setDate(now, true);
    } else {
      dateEl.value = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;
    }
  }

  function setNextHour(hourEl) {
    const now = new Date();
    let h = now.getHours();
    if (h < 4) h = 4;      // first selectable hour on the site
    if (h > 23) h = 23;    // last selectable hour
    hourEl.value = pad2(h);
  }

  function clearReturn() {
    // Set the input values directly. Calling flatpickr.clear() triggers the
    // site's onChange handler with an empty selectedDates array, which throws
    // ("this._date is undefined") and aborts the search.
    const dateEl = document.getElementById('return_date');
    if (dateEl) dateEl.value = '';
    const hourEl = document.getElementById('return_hour');
    if (hourEl) hourEl.value = '';
  }

  // ---------------------------------------------------------------------------
  // Journey planner form: FN30 passenger
  // ---------------------------------------------------------------------------
  function buildCardRow() {
    const row = document.createElement('div');
    row.className = 'j-p-form-passenger-card-row';

    const nameAndDelete = document.createElement('div');
    nameAndDelete.className = 'j-p-form-passenger-card-row-card-name-delete-button';

    const name = document.createElement('div');
    name.className = 'select j-p-form-passenger-card-selected';
    name.dataset.card_code = CARD_CODE;
    name.dataset.card_type = '';
    name.textContent = CARD_LABEL;

    const del = document.createElement('img');
    del.src = 'img/app/journey-planner-form-card-delete.png';
    del.className = 'j-p-f-delete-card';
    del.alt = 'Supprimer';
    del.onclick = () => row.remove();

    nameAndDelete.append(name, del);
    row.append(nameAndDelete);

    const props = document.createElement('div');
    row.append(props);

    const cardNumber = getIdentity().cardNumber;
    if (cardNumber) {
      const input = document.createElement('input');
      input.className = 'input-text j-p-form-passenger-input j-p-form-passenger-card-number';
      input.placeholder = 'Numéro de carte';
      input.type = 'number';
      input.value = cardNumber;
      props.append(input);
    }

    return row;
  }

  function buildPassengerBox() {
    const box = document.createElement('div');
    box.className = 'j-p-form-passenger-control-box rail-search-passenger-anchor';
    box.dataset.pax_menu_action = 'update';

    const front = document.createElement('div');
    front.className = 'j-p-form-passenger-control-front';

    const type = document.createElement('button');
    type.className = 'select j-p-form-passenger-input-height rail-search-passenger-type j-p-form-toggle-passenger-type-options';
    type.dataset.rank = '1';
    type.dataset.sncf_age_group_code = '59';
    type.dataset.passenger_type_udt_code = 'AD';
    type.textContent = 'Adulte';

    const age = document.createElement('input');
    age.className = 'j-p-form-passenger-age input-text j-p-form-passenger-input-height';
    age.placeholder = 'Age';
    age.type = 'number';

    const cardBtn = document.createElement('button');
    cardBtn.className = 'j-p-form-passenger-input-height j-p-form-passenger-show-card-menu-level-one j-p-form-button-orange-border';
    cardBtn.textContent = 'Carte';

    front.append(type, age, cardBtn);

    const cardControl = document.createElement('div');
    cardControl.className = 'j-p-form-passenger-card-control';
    const receiver = document.createElement('div');
    receiver.className = 'j-p-form-passenger-cards-receiver';
    cardControl.append(receiver);

    box.append(front, cardControl);
    return box;
  }

  function ensurePassengerWithCard() {
    const container = document.getElementById('journey_planner_form_query_passengers');
    if (!container) return;

    let box = container.querySelector('.j-p-form-passenger-control-box');
    if (!box) {
      box = buildPassengerBox();
      container.appendChild(box);
    }

    // Make sure the passenger is an adult (rank 1).
    const type = box.querySelector('.rail-search-passenger-type');
    if (type) {
      type.dataset.rank = type.dataset.rank || '1';
      type.dataset.sncf_age_group_code = '59';
      type.dataset.passenger_type_udt_code = 'AD';
      type.textContent = 'Adulte';
    }

    // Replace any existing cards with FN30 so we never send conflicting cards.
    const receiver = box.querySelector('.j-p-form-passenger-cards-receiver');
    if (receiver) {
      receiver.innerHTML = '';
      receiver.appendChild(buildCardRow());
    }
  }

  // ---------------------------------------------------------------------------
  // Main action: next train search
  // ---------------------------------------------------------------------------
  function go() {
    const origin = document.getElementById('origin');
    const destination = document.getElementById('destination');
    const dateEl = document.getElementById('departure_date');
    const hourEl = document.getElementById('departure_hour');
    const submit = document.getElementById('journeyplanner-form-submit');

    if (!origin || !destination || !dateEl || !hourEl || !submit) {
      alert('12train: formulaire introuvable (la page a peut-être changé).');
      return;
    }

    const journey = getJourneyForCurrentTime();
    setStation(origin, journey.origin);
    setStation(destination, journey.destination);
    refreshButtonLabel();
    setToday(dateEl);
    setNextHour(hourEl);
    clearReturn();
    ensurePassengerWithCard();

    submit.click();
  }

  // ---------------------------------------------------------------------------
  // After a user picks a fare price, 12train expands the matching offer and
  // shows a second "Sélectionner ce trajet" button. Click that button as soon
  // as it becomes visible; this only selects the train and does not purchase it.
  // ---------------------------------------------------------------------------
  function autoSelectExpandedPrice(price, attempt = 0) {
    if (!price.isConnected || !price.classList.contains('r-s-r-o-price-selected')) return;

    const offer = document.getElementById(price.dataset.bo_key);
    const button = offer && Array.from(offer.querySelectorAll('.r-s-r-submit-sale'))
      .find((candidate) => candidate.getClientRects().length > 0 && !candidate.disabled);

    if (button) {
      button.click();
      return;
    }

    // Usually the offer is revealed synchronously. Retry briefly in case the
    // site renders it asynchronously, while ensuring the same price is selected.
    if (attempt < 20) window.setTimeout(() => autoSelectExpandedPrice(price, attempt + 1), 100);
  }

  function attachPriceSelectionAutoclick() {
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const price = target?.closest('div.r-s-r-o-price.r-s-r-o-price-with_offer');
      if (price) window.setTimeout(() => autoSelectExpandedPrice(price), 0);
    }, true);
  }

  // ---------------------------------------------------------------------------
  // Booking form: auto-fill identity when it appears
  // (first_name_N / last_name_N / birth_date_{day,month,year}_N / card_number_N)
  // ---------------------------------------------------------------------------
  function fillBookingForm() {
    const container = document.getElementById('booking-form-passengers-forms');
    if (!container || !container.childElementCount) return;

    const id = getIdentity();
    if (!id.firstName && !id.lastName && !id.birthDate && !id.cardNumber) return;
    const birth = parseBirthDate(id.birthDate);

    Array.prototype.forEach.call(
      container.getElementsByClassName('passenger-c'),
      (box) => {
        setIfEmpty(box.querySelector('input.first-name'), id.firstName);
        setIfEmpty(box.querySelector('input.last-name'), id.lastName);
        if (birth) {
          setIfEmpty(box.querySelector('input.passenger-birthdate-day'), pad2(parseInt(birth.day, 10)));
          setIfEmpty(box.querySelector('input.passenger-birthdate-month'), pad2(parseInt(birth.month, 10)));
          setIfEmpty(box.querySelector('input.passenger-birthdate-year'), birth.year);
        }
        setIfEmpty(box.querySelector('input.passenger-card-number'), id.cardNumber);
      }
    );
  }

  let identityPromptShown = false;

  function maybeAskForIdentity() {
    if (storeReadOnly || !storageAvailable) return;
    const container = document.getElementById('booking-form-passengers-forms');
    if (!container || !container.childElementCount) return;
    const id = getIdentity();
    if (id.firstName || id.lastName) return;
    if (identityPromptShown) return;
    identityPromptShown = true;
    if (confirm('12train: enregistrer vos informations (prénom, nom, date de naissance) pour les remplir automatiquement ?')) {
      openSettings();
    }
  }

  // Debounced: the site rebuilds the form in several DOM steps.
  let fillScheduled = false;
  function scheduleFill() {
    if (fillScheduled) return;
    fillScheduled = true;
    setTimeout(() => {
      fillScheduled = false;
      fillBookingForm();
      maybeAskForIdentity();
    }, 150);
  }

  new MutationObserver(scheduleFill).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  function openSettings() {
    if (storeReadOnly) {
      showStorageNotice();
      return;
    }
    const id = getIdentity();
    const firstName = prompt('Prénom :', id.firstName);
    if (firstName === null) return;
    const lastName = prompt('Nom :', id.lastName);
    if (lastName === null) return;
    const birthDate = prompt('Date de naissance (JJ/MM/AAAA) :', id.birthDate);
    if (birthDate === null) return;
    const cardNumber = prompt('Numéro de carte de réduction (laisser vide si non demandé) :', id.cardNumber);
    if (cardNumber === null) return;

    const saved = saveDefaultIdentity({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthDate: birthDate.trim(),
      cardNumber: cardNumber.trim(),
    });
    if (!saved) {
      showStorageNotice();
      return;
    }

    fillBookingForm(); // apply immediately if the form is on screen
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  function showStorageNotice() {
    if (!storageNoticeMessage || !document.body) return;
    let notice = document.getElementById('t12-storage-notice');
    if (notice) {
      notice.querySelector('.t12-storage-notice-message').textContent = storageNoticeMessage;
      notice.style.display = 'flex';
      return;
    }

    notice = document.createElement('div');
    notice.id = 't12-storage-notice';
    notice.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:2147483647;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:8px;background:#fff3cd;color:#664d03;box-shadow:0 3px 12px rgba(0,0,0,.2);font:14px/1.4 system-ui,sans-serif';
    const message = document.createElement('span');
    message.className = 't12-storage-notice-message';
    message.textContent = storageNoticeMessage;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Fermer');
    close.style.cssText = 'margin-left:auto;border:0;background:transparent;font:22px/1 system-ui,sans-serif;color:inherit;cursor:pointer';
    close.onclick = () => notice.remove();
    notice.append(message, close);
    document.body.appendChild(notice);
  }

  function addButton() {
    if (document.getElementById('t12-next-train-btn')) return;
    if (!document.getElementById('origin')) return; // only on the search page

    const btn = document.createElement('button');
    btn.id = 't12-next-train-btn';
    btn.type = 'button';
    btn.textContent = getJourneyForCurrentTime().label;
    btn.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'padding:14px 18px',
      'border:0',
      'border-radius:999px',
      'background:#e8590c',
      'color:#fff',
      'font:600 15px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 4px 14px rgba(0,0,0,.28)',
      'cursor:pointer',
      'max-width:calc(100vw - 32px)',
    ].join(';');
    btn.addEventListener('click', go);
    attachPriceSelectionAutoclick();

    // Keep the displayed direction current if this tab remains open across noon.
    window.setInterval(refreshButtonLabel, 30_000);
    document.addEventListener('visibilitychange', refreshButtonLabel);

    const gear = document.createElement('button');
    gear.type = 'button';
    gear.title = 'Prénom, nom, date de naissance, carte';
    gear.textContent = '⚙';
    gear.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:76px',
      'z-index:2147483647',
      'width:36px',
      'height:36px',
      'border:0',
      'border-radius:50%',
      'background:#343a40',
      'color:#fff',
      'font:16px/1 system-ui,sans-serif',
      'box-shadow:0 3px 10px rgba(0,0,0,.25)',
      'cursor:pointer',
    ].join(';');
    gear.addEventListener('click', openSettings);

    document.body.append(btn, gear);
  }

  addButton();
  if (storageNoticeMessage) showStorageNotice();
})();