// ==UserScript==
// @name         12train — Next train Chartres → Montparnasse
// @namespace    https://12train.com/
// @version      1.1
// @description  One-tap search on 12train.com: Chartres → Paris Montparnasse, today, next hour, with Carte Famille Nombreuse 30% (FN30) pre-selected. Auto-fills the booking form (first name, last name, birth date, card number).
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
  const ORIGIN = { name: 'Chartres', code: 'FRQTJ' };
  const DESTINATION = { name: 'Paris Montparnasse', code: 'FRPMO' };

  const CARD_CODE = 'FN30';
  const CARD_LABEL = 'Carte Famille Nombreuse 30%';

  // ---------------------------------------------------------------------------
  // Stored data (localStorage) — nothing personal is hard-coded in this file.
  // ---------------------------------------------------------------------------
  const KEYS = {
    firstName: 't12_first_name',
    lastName: 't12_last_name',
    birthDate: 't12_birth_date', // JJ/MM/AAAA or YYYY-MM-DD
    cardNumber: 't12_card_number',
  };

  const store = {
    get(key) {
      try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    },
    set(key, value) {
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch (e) { /* private mode: ignore */ }
    },
  };

  function getIdentity() {
    return {
      firstName: store.get(KEYS.firstName),
      lastName: store.get(KEYS.lastName),
      birthDate: store.get(KEYS.birthDate),
      cardNumber: store.get(KEYS.cardNumber),
    };
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

    setStation(origin, ORIGIN);
    setStation(destination, DESTINATION);
    setToday(dateEl);
    setNextHour(hourEl);
    clearReturn();
    ensurePassengerWithCard();

    submit.click();
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
    const id = getIdentity();
    const firstName = prompt('Prénom :', id.firstName);
    if (firstName === null) return;
    const lastName = prompt('Nom :', id.lastName);
    if (lastName === null) return;
    const birthDate = prompt('Date de naissance (JJ/MM/AAAA) :', id.birthDate);
    if (birthDate === null) return;
    const cardNumber = prompt('Numéro de carte de réduction (laisser vide si non demandé) :', id.cardNumber);
    if (cardNumber === null) return;

    store.set(KEYS.firstName, firstName.trim());
    store.set(KEYS.lastName, lastName.trim());
    store.set(KEYS.birthDate, birthDate.trim());
    store.set(KEYS.cardNumber, cardNumber.trim());

    fillBookingForm(); // apply immediately if the form is on screen
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  function addButton() {
    if (document.getElementById('t12-next-train-btn')) return;
    if (!document.getElementById('origin')) return; // only on the search page

    const btn = document.createElement('button');
    btn.id = 't12-next-train-btn';
    btn.type = 'button';
    btn.textContent = 'Next train Chartres → Montparnasse';
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
})();