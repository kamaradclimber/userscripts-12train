// ==UserScript==
// @name         12train — Next train Chartres ↔ Montparnasse
// @namespace    https://12train.com/
// @homepageURL  https://github.com/kamaradclimber/userscripts-12train/blob/main/12train-next-train.user.js
// @source       https://github.com/kamaradclimber/userscripts-12train/blob/main/12train-next-train.user.js
// @version      1.8
// @description  One-tap 12train search with family traveller selection, noon-based direction, stored reduction cards, auto fare selection, and row-specific booking autofill.
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
        cards: [{ code: CARD_CODE, label: CARD_LABEL, cardNumber: '' }],
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
    const familyCard = me.cards.find((card) => card.cardNumber) || me.cards[0];
    return {
      firstName: me.firstName,
      lastName: me.lastName,
      birthDate: me.birthDate,
      cardNumber: familyCard ? familyCard.cardNumber : '',
    };
  }

  // Snapshot the roster used for currently displayed results. Booking details
  // must match the ages/cards that produced those fares, even if a profile is
  // edited in another tab while the result list is open.
  let activeSearchTravellers = [JSON.parse(JSON.stringify(getDefaultTraveller()))];
  let activeSearchTravellerIds = activeSearchTravellers.map((traveller) => traveller.id);

  function saveTravellerList(travellers, originalStoreRaw) {
    if (storeReadOnly || !storageAvailable) return false;

    let latestRaw;
    try {
      latestRaw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      storageNoticeMessage = '12train: impossible de relire les données locales. Rechargez la page avant de réessayer.';
      return false;
    }
    if (latestRaw !== originalStoreRaw) {
      storageNoticeMessage = '12train: les profils ont changé dans un autre onglet. Fermez puis rouvrez le gestionnaire avant d’enregistrer.';
      return false;
    }

    const latest = JSON.parse(latestRaw);
    if (latest.schemaVersion > STORE_SCHEMA_VERSION) {
      storeReadOnly = true;
      storageNoticeMessage = '12train: les données ont été créées par une version plus récente du script. Mettez le script à jour avant de modifier vos profils.';
      return false;
    }
    const updated = {
      ...latest,
      schemaVersion: STORE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      travellers,
    };
    if (!isValidStore(updated)) {
      storageNoticeMessage = 'Vérifiez les profils : il faut exactement un voyageur par défaut, et chaque personne doit avoir un prénom, un nom et une date de naissance valide.';
      return false;
    }
    if (!persistStore(updated)) return false;
    travellerStore = updated;
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

  function getAgeOnDate(birthDate, onDate = new Date()) {
    const parts = parseBirthDate(birthDate);
    if (!parts) return null;
    const birth = new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    if (birth.getFullYear() !== Number(parts.year)
        || birth.getMonth() !== Number(parts.month) - 1
        || birth.getDate() !== Number(parts.day)) return null;
    let age = onDate.getFullYear() - birth.getFullYear();
    if (onDate.getMonth() < birth.getMonth()
        || (onDate.getMonth() === birth.getMonth() && onDate.getDate() < birth.getDate())) age--;
    return age >= 0 ? age : null;
  }

  function passengerTypeForAge(age) {
    if (age === null) return { code: 'AD', label: 'Adulte', ageGroupCode: '59' };
    if (age <= 3) return { code: 'BB', label: 'Bébé', ageGroupCode: '3' };
    if (age <= 11) return { code: 'KD', label: 'Enfant', ageGroupCode: '11' };
    if (age <= 25) return { code: 'YG', label: 'Jeune', ageGroupCode: '25' };
    if (age <= 59) return { code: 'AD', label: 'Adulte', ageGroupCode: '59' };
    return { code: 'SR', label: 'Senior', ageGroupCode: '60' };
  }

  function getDepartureDate() {
    const dateInput = document.getElementById('departure_date');
    const parts = dateInput && parseBirthDate(dateInput.value);
    if (parts) {
      const date = new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
      if (date.getFullYear() === Number(parts.year)
          && date.getMonth() === Number(parts.month) - 1
          && date.getDate() === Number(parts.day)) return date;
    }
    return new Date();
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
  function buildCardRow(card) {
    const row = document.createElement('div');
    row.className = 'j-p-form-passenger-card-row';

    const nameAndDelete = document.createElement('div');
    nameAndDelete.className = 'j-p-form-passenger-card-row-card-name-delete-button';

    const name = document.createElement('div');
    name.className = 'select j-p-form-passenger-card-selected';
    name.dataset.card_code = card.code;
    name.dataset.card_type = card.type || '';
    name.textContent = card.label || card.code;

    const del = document.createElement('img');
    del.src = 'img/app/journey-planner-form-card-delete.png';
    del.className = 'j-p-f-delete-card';
    del.alt = 'Supprimer';
    del.onclick = () => row.remove();

    nameAndDelete.append(name, del);
    row.append(nameAndDelete);

    const props = document.createElement('div');
    row.append(props);

    const cardNumber = card.cardNumber || '';
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

  function buildPassengerBox(traveller, rank, departureDate) {
    const box = document.createElement('div');
    box.className = 'j-p-form-passenger-control-box rail-search-passenger-anchor';
    box.dataset.pax_menu_action = 'update';
    box.dataset.travellerId = traveller.id;

    const front = document.createElement('div');
    front.className = 'j-p-form-passenger-control-front';

    const age = getAgeOnDate(traveller.birthDate, departureDate);
    const passengerType = passengerTypeForAge(age);
    const type = document.createElement('button');
    type.className = 'select j-p-form-passenger-input-height rail-search-passenger-type j-p-form-toggle-passenger-type-options';
    type.dataset.rank = String(rank);
    type.dataset.sncf_age_group_code = passengerType.ageGroupCode;
    type.dataset.passenger_type_udt_code = passengerType.code;
    type.textContent = passengerType.label;

    const ageInput = document.createElement('input');
    ageInput.className = 'j-p-form-passenger-age input-text j-p-form-passenger-input-height';
    ageInput.placeholder = 'Age';
    ageInput.type = 'number';
    ageInput.value = age === null ? '' : String(age);

    const cardBtn = document.createElement('button');
    cardBtn.className = 'j-p-form-passenger-input-height j-p-form-passenger-show-card-menu-level-one j-p-form-button-orange-border';
    cardBtn.textContent = 'Carte';

    front.append(type, ageInput, cardBtn);

    const cardControl = document.createElement('div');
    cardControl.className = 'j-p-form-passenger-card-control';
    const receiver = document.createElement('div');
    receiver.className = 'j-p-form-passenger-cards-receiver';
    traveller.cards.forEach((card) => receiver.appendChild(buildCardRow(card)));
    cardControl.append(receiver);

    box.append(front, cardControl);
    return box;
  }

  function applyPassengerRoster(travellers) {
    const container = document.getElementById('journey_planner_form_query_passengers');
    if (!container || !travellers.length || travellers.length > 9) return false;

    const departureDate = getDepartureDate();
    container.replaceChildren(...travellers.map((traveller, index) =>
      buildPassengerBox(traveller, index + 1, departureDate)
    ));
    activeSearchTravellers = JSON.parse(JSON.stringify(travellers));
    activeSearchTravellerIds = activeSearchTravellers.map((traveller) => traveller.id);
    return true;
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
    if (!applyPassengerRoster([getDefaultTraveller()])) {
      alert('12train: impossible de configurer le voyageur par défaut.');
      return;
    }

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
  // Change the party for the currently displayed results. The search is rerun
  // because 12train fares and card eligibility are passenger-dependent.
  // ---------------------------------------------------------------------------
  function openTravellerSelection() {
    if (document.getElementById('t12-traveller-selection')) return;
    const activeIds = new Set(activeSearchTravellerIds);
    const overlay = document.createElement('div');
    overlay.id = 't12-traveller-selection';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Voyageurs pour ce trajet');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.55);font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#212529';

    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(560px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:12px;padding:18px;box-shadow:0 8px 36px rgba(0,0,0,.35)';
    const title = document.createElement('h2');
    title.textContent = 'Voyageurs pour ce trajet';
    title.style.cssText = 'margin:0 0 6px;font-size:21px';
    const intro = document.createElement('p');
    intro.textContent = 'Choisissez les personnes qui voyagent. Les résultats et tarifs seront actualisés pour ce groupe.';
    intro.style.cssText = 'margin:0 0 12px;font-size:13px;color:#495057';
    const list = document.createElement('div');
    const status = document.createElement('div');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'margin-top:8px;color:#b02a37;font-size:13px';
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-top:16px';
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.textContent = 'Gérer les voyageurs';
    manage.className = 't12-secondary-button';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-left:auto';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Annuler';
    cancel.className = 't12-secondary-button';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 't12-primary-button';

    const style = document.createElement('style');
    style.textContent = `
      #t12-traveller-selection * { box-sizing: border-box; }
      #t12-traveller-selection button { min-height: 40px; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; font: inherit; }
      #t12-traveller-selection .t12-secondary-button { background: #e9ecef; color: #212529; }
      #t12-traveller-selection .t12-primary-button { background: #e8590c; color: #fff; font-weight: 600; }
      #t12-traveller-selection .t12-party-member { display: flex; align-items: flex-start; gap: 10px; padding: 12px 4px; border-bottom: 1px solid #dee2e6; cursor: pointer; }
      #t12-traveller-selection .t12-party-member input { display: block !important; position: static; visibility: visible; opacity: 1; appearance: auto; clip: auto; width: 20px; height: 20px; margin: 2px 0 0; flex: 0 0 auto; }
      #t12-traveller-selection .t12-party-details { display: grid; gap: 2px; }
      #t12-traveller-selection .t12-party-summary { color: #6c757d; font-size: 13px; }
      #t12-traveller-selection button:disabled { opacity: .5; cursor: not-allowed; }
    `;
    document.head.appendChild(style);

    const profileLabel = (traveller) => {
      const age = getAgeOnDate(traveller.birthDate, getDepartureDate());
      const type = passengerTypeForAge(age).label;
      const cards = traveller.cards.map((card) => card.label || card.code).join(', ') || 'Sans carte';
      return { type, cards };
    };

    travellerStore.travellers.forEach((traveller) => {
      const row = document.createElement('label');
      row.className = 't12-party-member';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = traveller.id;
      checkbox.checked = activeIds.has(traveller.id);
      checkbox.dataset.travellerId = traveller.id;
      const details = document.createElement('span');
      details.className = 't12-party-details';
      const name = document.createElement('strong');
      name.textContent = `${traveller.firstName} ${traveller.lastName}${traveller.isDefault ? ' · par défaut' : ''}`;
      const summary = document.createElement('span');
      summary.className = 't12-party-summary';
      const info = profileLabel(traveller);
      summary.textContent = `${info.type} · ${info.cards}`;
      details.append(name, summary);
      row.append(checkbox, details);
      list.appendChild(row);
    });

    const close = () => {
      overlay.remove();
      style.remove();
      document.removeEventListener('keydown', escapeHandler);
    };
    const refreshApplyButton = () => {
      const count = list.querySelectorAll('input[type="checkbox"]:checked').length;
      apply.textContent = count ? `Actualiser les résultats (${count})` : 'Sélectionnez au moins une personne';
      apply.disabled = count === 0 || count > 9;
      if (count > 9) status.textContent = '12train accepte au maximum 9 voyageurs par recherche.';
      else status.textContent = '';
    };
    list.addEventListener('change', refreshApplyButton);
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    let escapeHandler;
    escapeHandler = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', escapeHandler);

    manage.addEventListener('click', () => {
      close();
      openSettings();
    });
    apply.addEventListener('click', () => {
      const selected = Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
        .map((checkbox) => travellerStore.travellers.find((traveller) => traveller.id === checkbox.value))
        .filter(Boolean);
      if (!selected.length || selected.length > 9) return;
      const unchanged = selected.length === activeSearchTravellerIds.length
        && selected.every((traveller, index) => traveller.id === activeSearchTravellerIds[index]
          && JSON.stringify(traveller) === JSON.stringify(activeSearchTravellers[index]));
      close();
      if (unchanged) return;

      const submit = document.getElementById('journeyplanner-form-submit');
      if (!submit || !applyPassengerRoster(selected)) {
        storageNoticeMessage = '12train: impossible de préparer la recherche avec ces voyageurs.';
        showStorageNotice();
        return;
      }
      updateResultsTravellerButton();
      submit.click();
    });

    actions.append(cancel, apply);
    footer.append(manage, actions);
    panel.append(title, intro, list, status, footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    refreshApplyButton();
  }

  function updateResultsTravellerButton() {
    const results = document.getElementById('r-s-r-results');
    const response = document.getElementById('r-s-response');
    if (!results || !response) return;

    let toolbar = document.getElementById('t12-results-travellers-toolbar');
    if (!results.querySelector('.r-s-r')) {
      if (toolbar) toolbar.style.display = 'none';
      return;
    }

    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 't12-results-travellers-toolbar';
      toolbar.style.cssText = 'display:flex;justify-content:flex-end;margin:8px 0';
      const button = document.createElement('button');
      button.id = 't12-results-travellers-btn';
      button.type = 'button';
      button.className = 't12-results-travellers-button';
      button.style.cssText = 'min-height:40px;padding:8px 14px;border:1px solid #adb5bd;border-radius:20px;background:#fff;color:#212529;font:600 14px system-ui,sans-serif;cursor:pointer';
      button.addEventListener('click', openTravellerSelection);
      toolbar.appendChild(button);
      const title = document.getElementById('r-s-r-title');
      if (title) title.insertAdjacentElement('afterend', toolbar);
      else response.insertBefore(toolbar, results);
    }
    toolbar.style.display = 'flex';
    const button = document.getElementById('t12-results-travellers-btn');
    if (button) button.textContent = `Travellers · ${activeSearchTravellerIds.length}`;
  }

  // ---------------------------------------------------------------------------
  // Booking form: auto-fill identity when it appears
  // (first_name_N / last_name_N / birth_date_{day,month,year}_N / card_number_N)
  // ---------------------------------------------------------------------------
  function fillBookingForm() {
    const container = document.getElementById('booking-form-passengers-forms');
    if (!container || !container.childElementCount) return;

    Array.prototype.forEach.call(
      container.getElementsByClassName('passenger-c'),
      (box, index) => {
        const rank = Number(box.dataset.passenger_id) || index + 1;
        const traveller = activeSearchTravellers[rank - 1];
        if (!traveller) return;

        const birth = parseBirthDate(traveller.birthDate);
        setIfEmpty(box.querySelector('input.first-name'), traveller.firstName);
        setIfEmpty(box.querySelector('input.last-name'), traveller.lastName);
        if (birth) {
          setIfEmpty(box.querySelector('input.passenger-birthdate-day'), pad2(parseInt(birth.day, 10)));
          setIfEmpty(box.querySelector('input.passenger-birthdate-month'), pad2(parseInt(birth.month, 10)));
          setIfEmpty(box.querySelector('input.passenger-birthdate-year'), birth.year);
        }
        const cardNumber = traveller.cards.find((card) => card.cardNumber)?.cardNumber || '';
        setIfEmpty(box.querySelector('input.passenger-card-number'), cardNumber);
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
      updateResultsTravellerButton();
    }, 150);
  }

  new MutationObserver(scheduleFill).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  let cardCatalogPromise;

  function parseCardCatalog(source) {
    const marker = 'const JP_FORM_CARDS_LEVEL_3 = ';
    const markerIndex = source.indexOf(marker);
    const start = markerIndex < 0 ? -1 : source.indexOf('[', markerIndex + marker.length);
    if (start < 0) throw new Error('12train card catalogue not found');

    // The site minifies/reformats the code after this JSON between releases, so
    // find the array's matching bracket rather than depending on a function name.
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < source.length; index++) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '[') depth++;
      else if (character === ']' && --depth === 0) {
        end = index + 1;
        break;
      }
    }
    if (end < 0) throw new Error('12train card catalogue is incomplete');

    const groups = JSON.parse(source.slice(start, end));
    const seen = new Set();
    return groups.flatMap((group) => group.labels.map((card) => ({
      code: card.code,
      label: card.label,
      type: card.type || '',
      group: group.level_two_id.replace(/_/g, ' '),
    }))).filter((card) => {
      if (!card.code || seen.has(card.code)) return false;
      seen.add(card.code);
      return true;
    });
  }

  function loadCardCatalog() {
    if (cardCatalogPromise) return cardCatalogPromise;
    cardCatalogPromise = (async () => {
      const script = Array.from(document.scripts).find((element) => /\/js\/index\.[^/]+\.js(?:\?|$)/.test(element.src));
      if (!script) throw new Error('12train card catalogue script not found');
      const response = await fetch(script.src, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('12train card catalogue fetch failed');
      return parseCardCatalog(await response.text());
    })().catch((error) => {
      console.warn('12train userscript: using reduced card catalogue', error);
      return [
        { code: CARD_CODE, label: CARD_LABEL, type: '', group: 'Réductions' },
        { code: 'ODS_CARTE_RÉMI_LIBERTÉ_JEUNE', label: 'Carte Rémi Liberté Jeune', type: '', group: 'Centre-Val de Loire' },
      ];
    });
    return cardCatalogPromise;
  }

  function makeTravellerId() {
    return `traveller-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addField(parent, labelText, input, className) {
    const wrapper = document.createElement('label');
    wrapper.className = className || 't12-field';
    wrapper.append(document.createTextNode(labelText), input);
    parent.appendChild(wrapper);
    return input;
  }

  function makeCardEditor(card, catalog) {
    const row = document.createElement('div');
    row.className = 't12-card-editor';

    const select = document.createElement('select');
    select.dataset.field = 'card-code';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Aucune carte';
    select.appendChild(none);

    const groups = new Map();
    for (const item of catalog) {
      if (!groups.has(item.group)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = item.group;
        groups.set(item.group, optgroup);
        select.appendChild(optgroup);
      }
      const option = document.createElement('option');
      option.value = item.code;
      option.textContent = item.label;
      groups.get(item.group).appendChild(option);
    }

    const selected = card && catalog.find((item) => item.code === card.code);
    if (card && card.code && !selected) {
      const option = document.createElement('option');
      option.value = card.code;
      option.textContent = card.label || card.code;
      select.appendChild(option);
    }
    select.value = card ? card.code : '';

    const number = document.createElement('input');
    number.type = 'text';
    number.autocomplete = 'off';
    number.placeholder = 'N° de carte (si demandé)';
    number.value = card ? card.cardNumber || '' : '';
    number.dataset.field = 'card-number';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Retirer';
    remove.className = 't12-secondary-button';
    remove.addEventListener('click', () => row.remove());

    row.append(select, number, remove);
    return row;
  }

  function makeTravellerEditor(traveller, index, catalog) {
    const card = document.createElement('section');
    card.className = 't12-traveller-editor';
    card.dataset.travellerId = traveller.id;

    const heading = document.createElement('div');
    heading.className = 't12-traveller-heading';
    const title = document.createElement('strong');
    title.textContent = `Voyageur ${index + 1}`;
    heading.appendChild(title);

    const defaultLabel = document.createElement('label');
    defaultLabel.className = 't12-default-choice';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 't12-default-traveller';
    radio.value = traveller.id;
    radio.checked = traveller.isDefault;
    radio.dataset.field = 'default';
    defaultLabel.append(radio, document.createTextNode(' Voyageur par défaut'));
    heading.appendChild(defaultLabel);
    card.appendChild(heading);

    const fields = document.createElement('div');
    fields.className = 't12-traveller-fields';
    const firstName = document.createElement('input');
    firstName.type = 'text';
    firstName.autocomplete = 'given-name';
    firstName.value = traveller.firstName;
    firstName.dataset.field = 'first-name';
    firstName.required = true;
    addField(fields, 'Prénom', firstName);

    const lastName = document.createElement('input');
    lastName.type = 'text';
    lastName.autocomplete = 'family-name';
    lastName.value = traveller.lastName;
    lastName.dataset.field = 'last-name';
    lastName.required = true;
    addField(fields, 'Nom', lastName);

    const birthDate = document.createElement('input');
    birthDate.type = 'date';
    const parsedBirthDate = parseBirthDate(traveller.birthDate);
    birthDate.value = parsedBirthDate
      ? `${parsedBirthDate.year}-${pad2(parsedBirthDate.month)}-${pad2(parsedBirthDate.day)}`
      : '';
    birthDate.dataset.field = 'birth-date';
    birthDate.required = true;
    addField(fields, 'Date de naissance', birthDate);
    card.appendChild(fields);

    const cardsTitle = document.createElement('div');
    cardsTitle.className = 't12-cards-title';
    cardsTitle.textContent = 'Cartes de réduction';
    card.appendChild(cardsTitle);
    const cards = document.createElement('div');
    cards.className = 't12-cards-editor';
    (traveller.cards || []).forEach((item) => cards.appendChild(makeCardEditor(item, catalog)));
    card.appendChild(cards);

    const actions = document.createElement('div');
    actions.className = 't12-traveller-actions';
    const addCard = document.createElement('button');
    addCard.type = 'button';
    addCard.textContent = '+ Ajouter une carte';
    addCard.className = 't12-secondary-button';
    addCard.addEventListener('click', () => cards.appendChild(makeCardEditor(null, catalog)));
    actions.appendChild(addCard);

    const removeTraveller = document.createElement('button');
    removeTraveller.type = 'button';
    removeTraveller.textContent = 'Supprimer ce voyageur';
    removeTraveller.className = 't12-secondary-button t12-delete-traveller';
    removeTraveller.addEventListener('click', () => {
      card.remove();
      const remaining = Array.from(document.querySelectorAll('#t12-traveller-list .t12-traveller-editor'));
      if (!remaining.some((entry) => entry.querySelector('[data-field="default"]').checked) && remaining.length) {
        remaining[0].querySelector('[data-field="default"]').checked = true;
      }
      renumberTravellerEditors();
    });
    actions.appendChild(removeTraveller);
    card.appendChild(actions);
    return card;
  }

  function renumberTravellerEditors() {
    document.querySelectorAll('#t12-traveller-list .t12-traveller-editor').forEach((card, index) => {
      card.querySelector('strong').textContent = `Voyageur ${index + 1}`;
    });
  }

  async function openSettings() {
    if (storeReadOnly || !storageAvailable) {
      showStorageNotice();
      return;
    }
    if (document.getElementById('t12-traveller-manager')) return;

    let originalStoreRaw;
    try { originalStoreRaw = localStorage.getItem(STORE_KEY); } catch (e) {
      storageNoticeMessage = '12train: stockage local indisponible; impossible de modifier les voyageurs.';
      showStorageNotice();
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 't12-traveller-manager';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Gestion des voyageurs');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.55);font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#212529';

    const style = document.createElement('style');
    style.textContent = `
      #t12-traveller-manager * { box-sizing: border-box; }
      #t12-traveller-manager input, #t12-traveller-manager select { font: inherit; }
      #t12-traveller-manager input[type="text"], #t12-traveller-manager input[type="date"], #t12-traveller-manager select { width: 100%; min-height: 42px; border: 1px solid #adb5bd; border-radius: 6px; padding: 8px; background: #fff; color: #212529; }
      #t12-traveller-manager .t12-traveller-editor { border: 1px solid #dee2e6; border-radius: 8px; padding: 12px; margin: 0 0 12px; }
      #t12-traveller-manager .t12-traveller-heading, #t12-traveller-manager .t12-traveller-actions, #t12-traveller-manager .t12-card-editor { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      #t12-traveller-manager .t12-traveller-heading { justify-content: space-between; margin-bottom: 10px; }
      #t12-traveller-manager .t12-default-choice { display: flex; align-items: center; gap: 5px; font-size: 13px; }
      #t12-traveller-manager .t12-traveller-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
      #t12-traveller-manager .t12-field { display: grid; gap: 4px; font-size: 13px; }
      #t12-traveller-manager .t12-cards-title { margin-top: 12px; font-weight: 600; }
      #t12-traveller-manager .t12-card-editor { margin-top: 6px; }
      #t12-traveller-manager .t12-card-editor select { flex: 2 1 220px; }
      #t12-traveller-manager .t12-card-editor input { flex: 1 1 150px; }
      #t12-traveller-manager button { min-height: 40px; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; font: inherit; }
      #t12-traveller-manager .t12-secondary-button { background: #e9ecef; color: #212529; }
      #t12-traveller-manager .t12-primary-button { background: #e8590c; color: #fff; font-weight: 600; }
      #t12-traveller-manager .t12-delete-traveller { color: #a61e2b; }
      #t12-traveller-manager .t12-traveller-actions { justify-content: space-between; margin-top: 10px; }
      #t12-traveller-manager .t12-manager-status { white-space: pre-wrap; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(680px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:12px;padding:18px;box-shadow:0 8px 36px rgba(0,0,0,.35)';
    const heading = document.createElement('h2');
    heading.textContent = 'Voyageurs';
    heading.style.cssText = 'margin:0 0 8px;font-size:21px';
    const intro = document.createElement('p');
    intro.textContent = 'Les profils restent dans ce navigateur. Le voyageur par défaut est utilisé par le bouton « Next train ». Les noms et dates de naissance sont enregistrés localement.';
    intro.style.cssText = 'margin:0 0 14px;font-size:13px;color:#495057';
    const list = document.createElement('div');
    list.id = 't12-traveller-list';
    const status = document.createElement('div');
    status.className = 't12-manager-status';
    status.setAttribute('aria-live', 'polite');
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:16px';
    const addTraveller = document.createElement('button');
    addTraveller.type = 'button';
    addTraveller.textContent = '+ Ajouter un voyageur';
    addTraveller.className = 't12-secondary-button';
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;margin-left:auto';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Annuler';
    cancel.className = 't12-secondary-button';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Enregistrer';
    save.className = 't12-primary-button';

    const catalogMessage = document.createElement('p');
    catalogMessage.textContent = 'Chargement des cartes de réduction…';
    catalogMessage.style.cssText = 'margin:0 0 12px;color:#6c757d;font-size:13px';
    panel.append(heading, intro, catalogMessage, list, status);
    buttons.append(cancel, save);
    footer.append(addTraveller, buttons);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let escapeHandler;
    const close = () => {
      overlay.remove();
      style.remove();
      if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
    };
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    escapeHandler = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', escapeHandler);

    const catalog = await loadCardCatalog();
    if (!overlay.isConnected) return;
    catalogMessage.remove();
    const draft = JSON.parse(JSON.stringify(travellerStore.travellers));
    const render = () => {
      list.replaceChildren();
      draft.forEach((traveller, index) => list.appendChild(makeTravellerEditor(traveller, index, catalog)));
      renumberTravellerEditors();
    };
    render();

    addTraveller.addEventListener('click', () => {
      const person = {
        id: makeTravellerId(),
        isDefault: !list.querySelector('[data-field="default"]:checked'),
        firstName: '',
        lastName: '',
        birthDate: '',
        cards: [],
      };
      draft.push(person);
      list.appendChild(makeTravellerEditor(person, draft.length - 1, catalog));
      renumberTravellerEditors();
    });

    save.addEventListener('click', () => {
      const editors = Array.from(list.querySelectorAll('.t12-traveller-editor'));
      const travellers = editors.map((editor) => {
        const birthDate = editor.querySelector('[data-field="birth-date"]').value;
        const age = getAgeOnDate(birthDate);
        const cards = Array.from(editor.querySelectorAll('.t12-card-editor')).map((row) => {
          const code = row.querySelector('[data-field="card-code"]').value;
          if (!code) return null;
          const detail = catalog.find((item) => item.code === code);
          return {
            code,
            label: detail ? detail.label : code,
            type: detail ? detail.type : '',
            cardNumber: row.querySelector('[data-field="card-number"]').value.trim(),
          };
        }).filter(Boolean);
        return {
          id: editor.dataset.travellerId,
          isDefault: !!editor.querySelector('[data-field="default"]').checked,
          firstName: editor.querySelector('[data-field="first-name"]').value.trim(),
          lastName: editor.querySelector('[data-field="last-name"]').value.trim(),
          birthDate,
          cards,
          _validBirthDate: age !== null,
        };
      });

      const invalid = travellers.find((traveller) => !traveller.firstName || !traveller.lastName || !traveller._validBirthDate);
      const duplicateCard = travellers.find((traveller) => new Set(traveller.cards.map((card) => card.code)).size !== traveller.cards.length);
      const multipleCardNumbers = travellers.find((traveller) => traveller.cards.filter((card) => card.cardNumber).length > 1);
      if (!travellers.length || invalid || duplicateCard || multipleCardNumbers
          || travellers.filter((traveller) => traveller.isDefault).length !== 1) {
        status.textContent = duplicateCard
          ? 'Une même carte ne peut être ajoutée qu’une fois par voyageur.'
          : multipleCardNumbers
            ? '12train ne prend en charge qu’un numéro de carte par voyageur.'
            : 'Chaque voyageur doit avoir un prénom, un nom et une date de naissance valide. Choisissez exactement un voyageur par défaut.';
        status.style.cssText = 'margin-top:10px;color:#b02a37;font-size:13px';
        return;
      }
      travellers.forEach((traveller) => delete traveller._validBirthDate);
      if (!saveTravellerList(travellers, originalStoreRaw)) {
        status.textContent = storageNoticeMessage || 'Impossible d’enregistrer les voyageurs.';
        status.style.cssText = 'margin-top:10px;color:#b02a37;font-size:13px';
        return;
      }
      close();
      document.removeEventListener('keydown', escapeHandler);
      fillBookingForm();
    });
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

  function addTravellerManagerButton() {
    if (document.getElementById('t12-traveller-manager-btn')) return;
    const headerRight = document.getElementById('header-right');
    if (!headerRight) return;

    const gear = document.createElement('button');
    gear.id = 't12-traveller-manager-btn';
    gear.type = 'button';
    gear.title = 'Gérer les voyageurs';
    gear.setAttribute('aria-label', 'Gérer les voyageurs');
    gear.textContent = '⚙';
    gear.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;margin-left:8px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:18px/1 system-ui,sans-serif;cursor:pointer;vertical-align:middle';
    gear.addEventListener('click', openSettings);

    const accountLink = Array.from(headerRight.querySelectorAll('a')).find((link) =>
      /mon compte/i.test(link.textContent) || /\/account(?:[/?#]|$)/i.test(link.getAttribute('href') || '')
    );
    if (accountLink) accountLink.insertAdjacentElement('afterend', gear);
    else headerRight.appendChild(gear);
  }

  function addButton() {
    addTravellerManagerButton();
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

    document.body.appendChild(btn);
    updateResultsTravellerButton();
  }

  addButton();
  if (storageNoticeMessage) showStorageNotice();
})();