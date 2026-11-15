/** Dependency-free customer UI. Catalog text is inserted as text, never HTML.
 * Every price/availability/payment remains validated by the existing partner API. */
export const partnerSalesClient = String.raw`
(() => {
  'use strict';
  const root = document.getElementById('partner-sales');
  const app = document.getElementById('app');
  const feedback = document.getElementById('feedback');
  const base = root.dataset.base;
  const presentation = JSON.parse(document.getElementById('page-presentation').textContent);
  let appearance = presentation.appearance;
  const draftPreview = new URLSearchParams(location.search).get('preview') === '1';
  let previewAppearance = null, loadedProducts = [], loadedOfferings = [], catalogReady = false;
  const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'PLN' }).format(Number(value) || 0);
  const foodMoney = value => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', currencyDisplay: 'code', minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2, maximumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2 }).format(Number(value) || 0);
  const foodTime = value => /^\d\d:\d\d$/.test(value || '') ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date('2000-01-01T' + value + ':00Z')) : value;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dateObject = value => new Date(value + 'T12:00:00Z');
  const dateLabel = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(dateObject(value)) : 'Choose a date';
  const selectedDateLabel = (value, product) => theme(product) === 'food' && value ? value.split('-').reverse().join('/') : dateLabel(value);
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const cleanText = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() : '';
  const state = { stage: 'catalog', products: [], offerings: [], items: [], offeringCode: '', customer: { firstName: '', lastName: '', email: '', phone: '' }, fullName: '', phoneCountry: '', phoneInput: '', discountCode: '', reference: crypto.randomUUID(), quoted: null, busy: false, attempt: null, adding: false, activeIndex: 0 };
  const phoneCountries = JSON.parse(document.getElementById('phone-countries').textContent);
  let activeSelect = null;
  let activeCalendar = null;
  const icons = {
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>', back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    ticket: '<path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V7Z"/><path d="M15 7v3m0 3v2m0 2v2"/>',
    check: '<path d="m5 12 4 4L20 5"/>', location: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    plate: '<circle cx="12" cy="12" r="5"/><path d="M2 3v7m3-7v7m-3-3h3m-2 3v11M21 3v18m0-18c-4 4-4 9 0 9"/>',
    drink: '<path d="M5 3h14l-7 9-7-9Zm7 9v9m-4 0h8"/>', venue: '<path d="m3 10 9-7 9 7M5 9v12h14V9m-10 12v-7h6v7"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    cart: '<path d="M3 3h2l3 13h10l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>'
  };
  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text != null) result.textContent = String(text);
    return result;
  }
  function icon(name) {
    const result = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    result.setAttribute('viewBox', '0 0 24 24'); result.setAttribute('fill', 'none'); result.setAttribute('stroke', 'currentColor');
    result.setAttribute('stroke-width', '1.6'); result.setAttribute('stroke-linecap', 'round'); result.setAttribute('stroke-linejoin', 'round'); result.setAttribute('aria-hidden', 'true');
    const aliases = { 'wine-glass': 'drink', bar: 'drink', glasses: 'drink', stops: 'venue', duration: 'clock' };
    const key = Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name;
    result.innerHTML = Object.prototype.hasOwnProperty.call(icons, key) ? icons[key] : icons.ticket;
    return result;
  }
  function button(text, action, className = 'button', glyph) {
    const result = node('button', className, text); result.type = 'button';
    if (glyph === 'back') { result.classList.add('back-link'); result.prepend(icon(glyph)); }
    else if (glyph) result.append(icon(glyph));
    result.addEventListener('click', action); return result;
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try { const url = new URL(value, location.origin); return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin) ? url.href : null; } catch { return null; }
  }
  function image(url, alt, className, lazy = true) {
    const source = safeUrl(url);
    if (!source) { const fallback = node('div', (className || '') + ' placeholder-media'); fallback.append(icon('ticket')); return fallback; }
    const result = node('img', className); result.src = source; result.alt = alt || ''; result.decoding = 'async'; if (lazy) result.loading = 'lazy';
    result.addEventListener('error', () => { result.replaceWith(image(null, '', className)); }, { once: true }); return result;
  }
  const photo = product => product.imageUrl || product.images?.[0]?.url || null;
  const productFor = line => state.products.find(product => product.id === line.productId);
  function theme(product) {
    const context = [product?.productType?.name, product?.name, product?.slug].filter(Boolean).join(' ');
    if (/food[ -]?tour|bites|tasting/i.test(context)) return 'food';
    return 'ktk';
  }
  function category(product) {
    const configured = cleanText(product.config?.content?.card?.category);
    return configured || (theme(product) === 'food' ? 'Food & culture' : /pub.?crawl|bar.?crawl/i.test(product.name) ? 'Nightlife' : 'Experiences');
  }
  function setMessage(text = '', kind = 'error') {
    feedback.replaceChildren(); feedback.hidden = !text; feedback.className = 'notice ' + kind;
    if (text) feedback.append(node('p', '', text));
  }
  function invalidate() { if (!state.attempt) { state.reference = crypto.randomUUID(); state.quoted = null; } updateTotal(); }
  async function api(path, body) {
    if (draftPreview && path === '/book') throw Error('This is a design preview. No booking or payment will be created.');
    const url = new URL(base + path, location.origin);
    if (root.dataset.link) url.searchParams.set('link', root.dataset.link);
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw Error(data.message || data.error?.message || (typeof data.error === 'string' ? data.error : '') || (Array.isArray(data) && data[0]?.message) || 'We could not complete this request. Please try again.');
    return data;
  }
  function makeLine(product, preset = {}) {
    const config = product.config || {};
    const gender = config.participantMode === 'gender_split';
    const fixed = config.availability?.fixedDate || '';
    return { uid: crypto.randomUUID(), productId: product.id, date: preset.experienceDate || fixed, time: preset.experienceTime || (config.timeMode === 'select' ? '' : config.defaultStartTime || config.startTimes?.[0] || ''), quantity: gender ? 0 : number(preset.quantity, Math.max(1, number(config.minParticipants, 1))), men: 0, women: 0, addons: {} };
  }
  function go(stage) { if (state.busy || state.attempt) return; state.stage = stage; setMessage(); render(); app.focus({ preventScroll: true }); app.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  function chooseProduct(product) {
    if (state.busy || state.attempt) return;
    const packageActive = state.offerings.some(offering => offering.code === state.offeringCode && offering.kind === 'package');
    const existing = state.items.findIndex(line => line.productId === product.id);
    if (packageActive) { state.offeringCode = ''; state.items = [makeLine(product)]; state.activeIndex = 0; }
    else if (state.adding || !state.items.length) { state.items.push(makeLine(product)); state.activeIndex = state.items.length - 1; }
    else if (existing >= 0) state.activeIndex = existing;
    else state.items[state.activeIndex] = makeLine(product);
    state.adding = false; invalidate(); go('configure');
  }
  function chooseOffering(offering) {
    if (offering.kind === 'package') {
      if (!offering.items.every(item => state.products.some(product => product.id === item.productId))) return;
      state.items = offering.items.map(item => makeLine(state.products.find(product => product.id === item.productId), item));
      state.activeIndex = 0;
    } else if (!state.items.length && offering.items.length === 1) {
      const product = state.products.find(product => product.id === offering.items[0].productId); if (product) state.items = [makeLine(product)];
    }
    state.offeringCode = offering.code; invalidate(); if (state.items.length) go('configure'); else render();
  }
  function catalog() {
    if (!appearance.showTitle || !appearance.title) app.append(node('h1', 'sr-only', 'Choose an experience'));
    const intro = node('section', 'intro');
    if (appearance.showEyebrow && appearance.eyebrow) intro.append(node('p', 'eyebrow', appearance.eyebrow));
    if (appearance.showTitle && appearance.title) intro.append(node('h1', '', appearance.title));
    if (appearance.showDescription && appearance.description) intro.append(node('p', 'intro-description', appearance.description));
    if (intro.childElementCount) app.append(intro);
    const bar = node('div', 'catalog-bar');
    if (appearance.showCount && !(appearance.hideSingleCount && state.products.length === 1)) bar.append(node('span', 'catalog-count', state.products.length + (state.products.length === 1 ? ' experience to explore' : ' experiences to explore')));
    if (appearance.showSecureBooking && appearance.secureBookingText) { const secure = node('span', 'pill', appearance.secureBookingText); secure.prepend(icon('lock')); bar.append(secure); }
    if (bar.childElementCount) app.append(bar);
    if (state.offerings.length) {
      const offers = node('div', 'offering-list');
      state.offerings.forEach(offering => offers.append(button(offering.name, () => chooseOffering(offering), 'button offering' + (state.offeringCode === offering.code ? ' selected' : ''), 'ticket'))); app.append(offers);
    }
    if (!state.products.length) { app.append(node('p', 'empty', 'There are no experiences available through this partner right now. Please check back soon.')); return; }
    const grid = node('div', 'catalog-grid');
    state.products.forEach(product => {
      const card = node('article', 'activity-card'); card.dataset.productId = product.id; card.dataset.theme = theme(product);
      const media = node('div', 'card-media'); media.append(image(photo(product), product.name));
      const content = product.config?.content || {}, copy = content.card || {};
      if (typeof copy.ribbon === 'string' && copy.ribbon.trim()) media.append(node('span', 'ribbon', cleanText(copy.ribbon)));
      const body = node('div', 'card-body'); body.append(node('p', 'card-category', category(product)), node('h2', 'card-title', product.name));
      const description = cleanText(copy.description || copy.subtitle || content.summary || content.description).split('\n')[0];
      if (description) body.append(node('p', 'card-description', description.length > 160 ? description.slice(0, 157) + '...' : description));
      const facts = node('div', 'card-facts');
      const duration = number(product.config?.durationMinutes);
      if (duration > 0) { const span = node('span', '', duration % 60 ? Math.floor(duration / 60) + 'h ' + duration % 60 + 'min' : duration / 60 + ' hours'); span.prepend(icon('clock')); facts.append(span); }
      const stats = Array.isArray(copy.stats) ? copy.stats.slice(0, 3) : [];
      stats.forEach(stat => { if (!stat || typeof stat.label !== 'string') return; const span = node('span', '', (stat.count != null ? stat.count + ' ' : '') + stat.label); span.prepend(icon(stat.icon)); facts.append(span); });
      const fixed = product.config?.availability?.fixedDate;
      if (fixed) { const span = node('span', '', dateLabel(fixed)); span.prepend(icon('calendar')); facts.append(span); }
      else if (product.config?.defaultStartTime) { const span = node('span', '', product.config.defaultStartTime + ' start'); span.prepend(icon('clock')); facts.append(span); }
      if (facts.childNodes.length) body.append(facts);
      const bottom = node('div', 'card-bottom'), price = node('div', 'from-price'); price.append(node('small', '', 'From'), node('strong', '', money(product.price?.amount)), node('small', '', '/ guest'));
      const cta = button('Book now', () => chooseProduct(product), 'button', 'arrow'); cta.setAttribute('aria-label', 'Book ' + product.name); bottom.append(price, cta); body.append(bottom); card.append(media, body); grid.append(card);
    }); app.append(grid);
    if (state.items.length) app.append(button('Continue your booking', () => go('configure'), 'button wide add-experience', 'arrow'));
  }
  function quantityControl(value, min, max, label, change, small = false) {
    const maximum = () => typeof max === 'function' ? max() : max;
    const control = node('div', 'quantity-stepper'), input = node('input'); input.type = 'number'; input.min = String(min); input.max = String(maximum()); input.step = '1'; input.value = String(value); input.inputMode = 'numeric'; input.setAttribute('aria-label', label);
    const minus = button('\u2212', () => update(number(input.value) - 1), ''), plus = button('+', () => update(number(input.value) + 1), ''); minus.setAttribute('aria-label', 'Decrease ' + label); plus.setAttribute('aria-label', 'Increase ' + label);
    function sync() { input.max = String(maximum()); minus.disabled = number(input.value) <= min; plus.disabled = number(input.value) >= maximum(); }
    function update(next) { const result = Math.max(min, Math.min(maximum(), Math.floor(number(next)))); input.value = String(result); change(result); sync(); control.closest('.variant-grid')?.querySelectorAll('.quantity-stepper').forEach(element => element.dispatchEvent(new Event('refresh-limit'))); }
    control.addEventListener('refresh-limit', sync);
    input.addEventListener('change', () => update(input.value)); input.addEventListener('input', () => { if (input.value !== '') update(input.value); });
    control.append(minus, input, plus); sync(); return control;
  }
  function field(labelText, control, className = '') { const wrap = node('label', 'field ' + className); wrap.append(node('span', '', labelText), control); return wrap; }
  function closeSelect(focus = false) { if (!activeSelect) return; const previous = activeSelect; activeSelect = null; previous.menu.remove(); previous.trigger.classList.remove('is-open'); previous.trigger.setAttribute('aria-expanded', 'false'); if (focus && previous.trigger.isConnected) previous.trigger.focus(); }
  // The storefront's custom select presentation, backed by a real select so its
  // value, form state and keyboard/screen-reader labels have a single source.
  function storefrontSelect(select, className = '', searchable = false, food = false) {
    const wrap = node('div', 'ktk-custom-select storefront-select ' + className), label = select.getAttribute('aria-label') || 'Choose an option';
    select.classList.add('native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    const trigger = button('', toggle, food ? 'country-trigger' : 'ktk-custom-select__trigger'), text = node('span'), arrow = node('i'); arrow.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-label', label); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.append(text, arrow);
    function sync() { text.textContent = (food && select.value ? [...select.value].map(letter => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('') + ' ' : '') + (select.selectedOptions[0]?.textContent || 'Select'); trigger.classList.toggle('is-placeholder', !select.value); trigger.disabled = select.disabled; }
    function toggle() {
      if (activeSelect?.trigger === trigger) { closeSelect(true); return; } closeSelect(); closeCalendar();
      const menu = node('div', 'ktk-custom-select__options'); menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', label); menu.addEventListener('click', event => event.preventDefault());
      const choices = node('div'); let search;
      if (searchable) { const holder = node('div', 'ktk-custom-select__search'); search = node('input'); search.type = 'search'; search.placeholder = 'Search countries'; search.setAttribute('aria-label', 'Search countries'); holder.append(search); menu.append(holder); search.addEventListener('input', draw); }
      function draw() {
        choices.replaceChildren(); const query = search?.value.toLowerCase().trim() || '';
        [...select.options].filter(option => !option.hidden && (!query || option.textContent.toLowerCase().includes(query) || option.value.toLowerCase().includes(query))).forEach(option => {
          const choice = button(option.textContent, () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); closeSelect(true); }, option.selected ? 'is-selected' : '');
          if (food && option.value) { const country = phoneCountries.find(value => value.iso === option.value); choice.replaceChildren(node('span', '', [...country.iso].map(letter => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('')), node('span', '', country.name), node('span', '', country.code)); choice.classList.add('food-country-option'); }
          choice.setAttribute('role', 'option'); choice.setAttribute('aria-selected', String(option.selected)); choice.disabled = option.disabled; choice.dataset.value = option.value; choices.append(choice);
        }); if (!choices.childNodes.length) choices.append(node('p', 'ktk-custom-select__empty', 'No countries found'));
      }
      menu.append(choices); wrap.append(menu); activeSelect = { trigger, menu, wrap }; trigger.classList.add('is-open'); trigger.setAttribute('aria-expanded', 'true'); draw();
      (search || choices.querySelector('[aria-selected="true"]') || choices.querySelector('button'))?.focus();
      menu.addEventListener('keydown', event => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const buttons = [...choices.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1))); buttons[next]?.focus(); });
    }
    trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); toggle(); } });
    select.addEventListener('change', sync); select.addEventListener('refresh-options', sync); wrap.append(select, trigger); sync(); return wrap;
  }
  function syncPhone() {
    const raw = state.phoneInput.trim(), international = raw.startsWith('00') ? '+' + raw.slice(2).replace(/\D/g, '') : raw.includes('+') ? '+' + raw.slice(raw.indexOf('+') + 1).replace(/\D/g, '') : '';
    const parsed = window.libphonenumber?.parsePhoneNumberFromString(international || raw, state.phoneCountry || undefined), country = phoneCountries.find(value => value.iso === state.phoneCountry);
    state.customer.phone = parsed?.number || international || (country && raw ? country.code + raw.replace(/\D/g, '') : raw.replace(/\D/g, ''));
    if (international && parsed?.country) {
      state.phoneCountry = parsed.country; state.phoneInput = parsed.nationalNumber; const select = document.querySelector('select[name="phoneCountry"]'); if (select) { select.value = parsed.country; select.dispatchEvent(new Event('refresh-options')); } const input = document.querySelector('input[name="phone"]'); if (input) input.value = state.phoneInput;
    } invalidate();
  }
  function contactControls(food = false) {
    const grid = node('div', food ? 'food-fields' : 'ktk-contact-fields');
    const name = node('input'); name.name = 'fullName'; name.autocomplete = 'name'; name.required = true; name.maxLength = 201; name.value = state.fullName; name.pattern = '\\S+\\s+\\S.*'; name.title = 'Enter your first and last name';
    name.addEventListener('input', () => { state.fullName = name.value; const words = name.value.trim().split(/\s+/); state.customer.firstName = words.slice(0, -1).join(' '); state.customer.lastName = words.length > 1 ? words.at(-1) : ''; invalidate(); }); grid.append(field('Full name', name, food ? 'full-width' : ''));
    const email = node('input'); email.type = 'email'; email.name = 'email'; email.autocomplete = 'email'; email.required = true; email.maxLength = 254; email.value = state.customer.email; email.addEventListener('input', () => { state.customer.email = email.value; invalidate(); }); grid.append(field(food ? 'Email' : 'Email address', email, food ? 'full-width' : ''));
    const country = node('select'); country.name = 'phoneCountry'; country.setAttribute('aria-label', 'Choose phone country code'); const empty = node('option', '', 'Select a country'); empty.value = ''; country.append(empty);
    phoneCountries.forEach(value => { const option = node('option', '', value.name + ' (' + value.code + ')'); option.value = value.iso; country.append(option); }); country.value = state.phoneCountry; country.addEventListener('change', () => { state.phoneCountry = country.value; syncPhone(); }); grid.append(field('Country code', storefrontSelect(country, '', true, food)));
    const phone = node('input'); phone.type = 'tel'; phone.name = 'phone'; phone.autocomplete = 'tel-national'; phone.required = true; phone.maxLength = 30; phone.value = state.phoneInput; if (food) phone.placeholder = 'Phone number'; phone.addEventListener('input', () => { state.phoneInput = phone.value; syncPhone(); }); grid.append(field('Phone number', phone)); return grid;
  }
  function closeCalendar(focus = false) { if (!activeCalendar) return; const previous = activeCalendar; activeCalendar = null; previous.popup.remove(); previous.trigger.setAttribute('aria-expanded', 'false'); if (focus) previous.trigger.focus(); }
  function openCalendar(wrap, trigger, line, product) {
    if (activeCalendar?.trigger === trigger) { closeCalendar(true); return; } closeCalendar();
    const popup = node('div', 'calendar'); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'Choose activity date');
    popup.addEventListener('click', event => event.preventDefault());
    const calendar = { popup, trigger, month: (line.date || today()).slice(0, 7), request: 0 }; activeCalendar = calendar; wrap.append(popup); trigger.setAttribute('aria-expanded', 'true');
    async function draw() {
      const request = ++calendar.request; popup.replaceChildren();
      const header = node('div', 'calendar-header'); const previous = button('', () => shift(-1), 'icon-button', 'back'), next = button('', () => shift(1), 'icon-button', 'arrow'); previous.setAttribute('aria-label', 'Previous month'); next.setAttribute('aria-label', 'Next month'); previous.disabled = calendar.month <= today().slice(0, 7);
      header.append(previous, node('strong', 'calendar-title', new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateObject(calendar.month + '-01'))), next); popup.append(header, node('p', 'calendar-status', 'Checking available dates...'));
      function shift(offset) { const date = dateObject(calendar.month + '-01'); date.setUTCMonth(date.getUTCMonth() + offset); calendar.month = date.toISOString().slice(0, 7); void draw(); }
      try {
        const data = await api('/availability?productId=' + product.id + '&month=' + calendar.month + (line.time ? '&time=' + encodeURIComponent(line.time) : ''));
        if (activeCalendar !== calendar || request !== calendar.request) return;
        popup.querySelector('.calendar-status').remove();
        const grid = node('div', 'calendar-grid'); grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', header.innerText);
        ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach(day => grid.append(node('span', 'calendar-weekday', day)));
        const padding = (dateObject(calendar.month + '-01').getUTCDay() + 6) % 7;
        for (let i = 0; i < padding; i++) grid.append(node('span'));
        data.days.forEach(day => {
          const control = button(Number(day.date.slice(-2)), () => { line.date = day.date; trigger.querySelector('.date-text').textContent = selectedDateLabel(day.date, product); trigger.removeAttribute('aria-invalid'); closeCalendar(true); refreshAddons(line); invalidate(); setMessage(); }, 'calendar-day' + (day.date === line.date ? ' selected' : '') + (day.date === data.today ? ' today' : ''));
          control.disabled = !day.available; control.dataset.date = day.date; control.setAttribute('aria-label', dateLabel(day.date) + (day.available ? '' : ' - ' + (day.message || 'Unavailable'))); control.setAttribute('aria-pressed', String(day.date === line.date)); if (!day.available) control.title = day.message || 'Unavailable'; grid.append(control);
        });
        grid.addEventListener('keydown', event => {
          const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]; if (!offset) return;
          const buttons = [...grid.querySelectorAll('button')], current = buttons.indexOf(document.activeElement); if (current < 0) return;
          event.preventDefault(); let target = current + offset; while (target >= 0 && target < buttons.length && buttons[target].disabled) target += Math.sign(offset); buttons[target]?.focus();
        }); popup.append(grid, node('p', 'calendar-legend', 'Available dates can be selected.')); popup.querySelector('button.selected:not(:disabled), .calendar-day:not(:disabled)')?.focus();
      } catch (error) { if (activeCalendar !== calendar || request !== calendar.request) return; popup.querySelector('.calendar-status').textContent = error.message; popup.append(button('Try again', () => void draw(), 'text-button')); }
    }
    void draw();
  }
  function schedule(line, product) {
    const config = product.config || {}, ktk = theme(product) === 'ktk', grid = node('div', ktk ? 'ktk-configurator__schedule' : 'field-grid'), wrap = node('label', 'field'); wrap.append(node('span', '', 'Activity date'));
    const fixed = config.availability?.dateMode === 'fixed' && config.availability.fixedDate;
    if (fixed) { const fixedValue = node('div', ktk ? 'ktk-configurator__fixed-date' : 'fixed-value'); fixedValue.append(node('strong', '', dateLabel(fixed)), node('small', '', 'Fixed event date')); wrap.append(fixedValue); }
    else {
      const picker = node('div', ktk ? 'ktk-date-picker' : 'date-wrap'), native = !ktk ? node('input', 'native-date-input') : null;
      const trigger = button('', () => { if (native?.showPicker) { try { native.showPicker(); return; } catch {} } openCalendar(picker, trigger, line, product); }, ktk ? 'ktk-date-picker__trigger' : 'date-trigger'); trigger.dataset.field = 'date-' + line.uid; trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', 'Choose activity date for ' + product.name); trigger.append(node('span', 'date-text', line.date ? selectedDateLabel(line.date, product) : ktk ? 'Pick a date' : 'DD/MM/YYYY')); const glyph = ktk ? node('i') : icon('calendar'); glyph.setAttribute('aria-hidden', 'true'); trigger.append(glyph); picker.append(trigger);
      if (native) { native.type = 'date'; native.tabIndex = -1; native.setAttribute('aria-hidden', 'true'); native.min = today(); native.value = line.date; native.dataset.nativeDate = line.uid; native.addEventListener('change', () => { line.date = native.value; trigger.querySelector('.date-text').textContent = selectedDateLabel(line.date, product); trigger.removeAttribute('aria-invalid'); refreshAddons(line); invalidate(); }); picker.append(native); } wrap.append(picker);
    }
    grid.append(wrap);
    const times = Array.isArray(config.startTimes) ? config.startTimes.filter(value => typeof value === 'string') : [];
    if (config.timeMode === 'fixed' && line.time) { const time = node('div', ktk ? 'ktk-configurator__fixed-time' : 'fixed-value'); time.append(node('strong', '', line.time)); grid.append(field('Start time', time)); }
    else if (config.timeMode !== 'none') {
      let input;
      if (times.length) { input = node('select'); const empty = node('option', '', 'Choose a time'); empty.value = ''; input.append(empty); times.forEach(time => { const option = node('option', '', time); option.value = time; input.append(option); }); }
      else { input = node('input'); input.type = 'time'; }
      input.required = true; input.value = line.time; input.setAttribute('aria-label', 'Start time for ' + product.name); input.addEventListener('change', () => { line.time = input.value; closeCalendar(); invalidate(); }); grid.append(field('Start time', ktk && times.length ? storefrontSelect(input) : input));
    }
    return grid;
  }
  function participants(line, product) {
    const config = product.config || {}, ktk = theme(product) === 'ktk', max = Math.max(1, number(config.maxParticipants, 100)), grid = node('div', ktk ? 'ktk-configurator__split' : 'field-grid');
    if (config.participantMode === 'gender_split') {
      for (const key of ['men', 'women']) {
        const select = node('select'); select.setAttribute('aria-label', (key === 'men' ? 'Men' : 'Women') + ' for ' + product.name); select.dataset.gender = key;
        for (let i = 0; i <= max; i++) { const option = node('option', '', i); option.value = String(i); option.disabled = i > max - line[key === 'men' ? 'women' : 'men']; select.append(option); }
        select.value = String(line[key]); select.addEventListener('change', () => { line[key] = Math.min(number(select.value), max - line[key === 'men' ? 'women' : 'men']); select.value = String(line[key]); line.quantity = line.men + line.women; grid.querySelectorAll('select[data-gender]').forEach(control => { [...control.options].forEach(option => { option.disabled = number(option.value) > max - line[control.dataset.gender === 'men' ? 'women' : 'men']; }); }); refreshAddons(line); invalidate(); }); grid.append(field(key === 'men' ? 'Men' : 'Women', ktk ? storefrontSelect(select, 'ktk-config-quantity-select') : select));
      }
    } else if (ktk) {
      grid.className = 'ktk-configurator__participant'; const label = node('div'); label.append(node('strong', '', 'Participants'), node('small', '', money(product.price?.amount) + ' each')); const select = node('select'); select.setAttribute('aria-label', 'Guests for ' + product.name); for (let i = Math.max(1, number(config.minParticipants, 1)); i <= max; i++) { const option = node('option', '', i); option.value = String(i); select.append(option); } select.value = String(line.quantity); select.addEventListener('change', () => { line.quantity = number(select.value); refreshAddons(line); invalidate(); }); grid.append(label, storefrontSelect(select, 'ktk-config-quantity-select'));
    } else { const control = quantityControl(line.quantity, Math.max(1, number(config.minParticipants, 1)), max, 'Guests for ' + product.name, value => { line.quantity = value; refreshAddons(line); invalidate(); }); const wrap = field('Guests', control); wrap.classList.add('email-field'); grid.append(wrap); }
    return grid;
  }
  function addonAvailability(addon, line) {
    const rules = addon.config?.availability;
    if (rules?.enabled === false) return { available: false, message: rules.unavailableMessage || 'This extra is currently unavailable.' };
    if (rules?.daysOfWeek) {
      if (!line.date) return { available: false, message: 'Choose your date to see availability.' };
      if (!rules.daysOfWeek.includes(dateObject(line.date).getUTCDay() || 7)) return { available: false, message: rules.unavailableMessage || 'Not available on this day.' };
    }
    if (addon.price == null || addon.inventory?.inStock === false) return { available: false, message: 'Currently unavailable.' };
    return { available: true, message: '' };
  }
  function addonLimit(addon, line) {
    const cfg = addon.config || {}; let max = number(cfg.maxQuantity, 100);
    if (addon.maxPerAttendee != null) max = Math.min(max, Math.floor(number(addon.maxPerAttendee) * line.quantity));
    if (addon.inventory?.tracked && addon.inventory.availableQuantity != null) max = Math.min(max, number(addon.inventory.availableQuantity));
    if (cfg.selectionMode === 'quantity' && cfg.allowedQuantities?.length) max = Math.min(max, Math.max(...cfg.allowedQuantities));
    return Math.max(0, max);
  }
  function addonInfo(addon) {
    const dialog = node('dialog', 'addon-dialog'); dialog.setAttribute('aria-label', addon.name);
    const close = button('\u00d7', () => dialog.close(), 'dialog-close'); close.setAttribute('aria-label', 'Close add-on information'); dialog.append(close);
    if (addon.imageUrl) dialog.append(image(addon.imageUrl, addon.name, '', false));
    const content = node('div', 'dialog-body'); content.append(node('h2', '', addon.name), node('p', '', cleanText(addon.description))); dialog.append(content); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }); dialog.showModal();
  }
  function renderKtkAddons(holder, line, addons) {
    const list = node('fieldset', 'ktk-configurator__addons'); list.append(node('legend', '', 'Add-Ons'));
    addons.forEach(addon => {
      const config = addon.config || {}, available = addonAvailability(addon, line), limit = Math.min(500, addonLimit(addon, line)), entry = line.addons[addon.id] || (line.addons[addon.id] = { quantity: 0, value: '', variants: {} });
      if (!available.available) { entry.quantity = 0; entry.value = ''; entry.variants = {}; }
      const box = node('div', 'ktk-configurator__addon'); box.dataset.addonId = String(addon.id); const heading = node('div'), title = node('div', 'ktk-configurator__addon-title'), strong = node('strong');
      const emoji = /cocktail/i.test(addon.name) ? '\uD83C\uDF79' : /t.?shirt/i.test(addon.name) ? '\uD83D\uDC55' : /photo/i.test(addon.name) ? '\uD83D\uDCF8' : '';
      if (emoji) strong.append(node('span', 'ktk-configurator__addon-emoji', emoji)); strong.append(document.createTextNode(addon.name)); title.append(strong);
      if (addon.description || addon.imageUrl) { const info = button('', () => addonInfo(addon), 'ktk-configurator__addon-info-button'); info.append(node('span', '', 'i')); info.setAttribute('aria-label', 'About ' + addon.name); title.append(info); } heading.append(title); box.append(heading);
      if (!available.available) { box.append(node('p', 'addon-unavailable-copy', available.message)); list.append(box); return; }
      if (config.selectionMode === 'boolean') {
        const toggle = button(entry.quantity ? 'Added' : '+ ' + money(addon.price?.amount), () => { entry.quantity = entry.quantity ? 0 : 1; entry.value = entry.quantity ? 'true' : ''; refreshAddons(line); invalidate(); }, entry.quantity ? 'is-active' : ''); toggle.setAttribute('aria-pressed', String(entry.quantity > 0)); box.append(toggle);
      } else {
        const select = node('select'); select.setAttribute('aria-label', addon.name + (config.selectionMode === 'options' ? ' option' : ' quantity')); const empty = node('option', '', 'None'); empty.value = ''; select.append(empty);
        if (config.selectionMode === 'options') {
          (config.options || []).forEach(value => { const option = node('option', '', (value.label || value.value) + (number(value.price) ? ' (+' + money(value.price) + ')' : '')); option.value = value.value; select.append(option); }); select.value = entry.value;
        } else {
          let values = config.allowedQuantities?.length ? config.allowedQuantities : Array.from({ length: limit }, (_, index) => index + 1);
          if (config.selectionMode === 'range') values = values.filter(value => number(value) >= Math.max(1, number(config.minQuantity, 1)));
          values.map(Number).filter(value => value > 0 && value <= limit).forEach(value => { const option = node('option', '', value + ' (+' + money(config.quantityPrices?.[String(value)] ?? number(addon.price?.amount) * value) + ')'); option.value = String(value); select.append(option); });
          if (entry.quantity > limit) entry.quantity = limit; select.value = entry.quantity ? String(entry.quantity) : ''; if (select.selectedIndex < 0) { entry.quantity = 0; select.value = ''; }
        }
        select.addEventListener('change', () => { if (config.selectionMode === 'options') { entry.value = select.value; entry.quantity = select.value ? 1 : 0; } else { entry.quantity = number(select.value); let remaining = entry.quantity; Object.keys(entry.variants).forEach(key => { entry.variants[key] = Math.min(remaining, entry.variants[key]); remaining -= entry.variants[key]; }); } refreshAddons(line); invalidate(); }); box.append(storefrontSelect(select));
        if (addon.inventory?.variantSelectionRequired && entry.quantity > 0) {
          const variants = node('div', 'ktk-configurator__addon-variants'), heading = node('div', 'ktk-configurator__addon-variants-heading'), assigned = node('small'); heading.append(node('span', '', 'Sizes'), assigned); variants.append(heading); const grid = node('div', 'ktk-configurator__addon-variants-grid');
          const sync = () => { assigned.textContent = Object.values(entry.variants).reduce((sum, value) => sum + number(value), 0) + ' / ' + entry.quantity + ' assigned'; grid.querySelectorAll('select').forEach(control => { const others = Object.entries(entry.variants).reduce((sum, [key, value]) => sum + (key === control.dataset.variant ? 0 : number(value)), 0); [...control.options].forEach(option => { option.disabled = number(option.value) > entry.quantity - others; }); }); };
          (addon.inventory.variants || []).filter(value => value.inStock !== false && (value.availableQuantity == null || value.availableQuantity > 0)).forEach(variant => {
            const key = String(variant.value), maximum = Math.min(entry.quantity, variant.availableQuantity == null ? entry.quantity : number(variant.availableQuantity)), wrap = node('div', 'ktk-configurator__addon-variant'), quantity = node('select'); wrap.append(node('span', '', variant.label || key)); quantity.dataset.variant = key; quantity.setAttribute('aria-label', addon.name + ' size ' + (variant.label || key));
            entry.variants[key] = Math.min(maximum, number(entry.variants[key])); for (let i = 0; i <= maximum; i++) { const option = node('option', '', i); option.value = String(i); quantity.append(option); } quantity.value = String(entry.variants[key]); quantity.addEventListener('change', () => { entry.variants[key] = number(quantity.value); sync(); invalidate(); }); wrap.append(storefrontSelect(quantity, 'ktk-configurator__addon-variant-quantity')); grid.append(wrap);
          }); variants.append(grid); box.append(variants); sync();
        }
      }
      list.append(box);
    }); holder.append(list);
  }
  function refreshAddons(line) {
    const holder = document.getElementById('addons-' + line.uid); if (!holder) return; holder.replaceChildren();
    const product = productFor(line), addons = product.addons || [];
    if (!addons.length) return;
    if (theme(product) === 'ktk') { renderKtkAddons(holder, line, addons); return; }
    holder.append(node('h3', 'section-label', 'Make it yours'));
    const list = node('div', 'addons-list');
    addons.forEach(addon => {
      const cfg = addon.config || {}, availability = addonAvailability(addon, line), limit = addonLimit(addon, line);
      const entry = line.addons[addon.id] || (line.addons[addon.id] = { quantity: 0, value: '', variants: {} });
      if (!availability.available) { entry.quantity = 0; entry.value = ''; entry.variants = {}; }
      const box = node('div', 'addon' + (!availability.available ? ' addon-unavailable' : '')), header = node('div', 'addon-header'), name = node('div'), title = node('div', 'addon-name', addon.name); box.dataset.addonId = String(addon.id);
      const info = button('i', () => addonInfo(addon), 'addon-info'); info.setAttribute('aria-label', 'About ' + addon.name); title.append(info); name.append(title, node('p', 'addon-price', cfg.selectionMode === 'options' ? 'Choose your option below' : money(addon.price?.amount) + ' each')); header.append(name); box.append(header);
      if (!availability.available) { box.append(node('p', '', availability.message)); list.append(box); return; }
      if (addon.inventory?.variantSelectionRequired) {
        const sizes = node('details', 'variant-options'); sizes.open = entry.quantity > 0;
        const selectedLabel = node('summary', '', entry.quantity ? entry.quantity + ' selected - change sizes' : 'Choose your sizes'); sizes.append(selectedLabel);
        const variants = node('div', 'variant-grid');
        (addon.inventory.variants || []).forEach(variant => {
          const max = Math.min(limit, number(variant.availableQuantity)); entry.variants[variant.value] = Math.min(max, number(entry.variants[variant.value]));
          const wrap = node('label', 'variant-label', variant.label);
          const available = () => variant.inStock ? Math.max(0, Math.min(max, limit - Object.entries(entry.variants).reduce((sum, [key, value]) => sum + (key === variant.value ? 0 : number(value)), 0))) : 0;
          const control = quantityControl(entry.variants[variant.value], 0, available, addon.name + ' size ' + variant.label, value => { entry.variants[variant.value] = value; entry.quantity = Object.values(entry.variants).reduce((sum, n) => sum + number(n), 0); selectedLabel.textContent = entry.quantity ? entry.quantity + ' selected - change sizes' : 'Choose your sizes'; invalidate(); }, true); wrap.append(control); variants.append(wrap);
        }); entry.quantity = Object.values(entry.variants).reduce((sum, n) => sum + number(n), 0); sizes.append(variants); box.append(sizes);
      } else if (cfg.selectionMode === 'options') {
        const select = node('select', 'addon-select'); select.setAttribute('aria-label', addon.name + ' option'); const empty = node('option', '', 'No thanks'); empty.value = ''; select.append(empty);
        (cfg.options || []).forEach(option => { const control = node('option', '', option.label + ' - ' + money(option.price ?? addon.price?.amount)); control.value = option.value; select.append(control); }); select.value = entry.value;
        select.addEventListener('change', () => { entry.value = select.value; entry.quantity = select.value ? 1 : 0; invalidate(); }); box.append(select);
      } else if (cfg.selectionMode === 'boolean') {
        const input = node('input'); input.type = 'checkbox'; input.checked = entry.quantity > 0; input.setAttribute('aria-label', 'Include ' + addon.name); input.addEventListener('change', () => { entry.quantity = input.checked ? 1 : 0; entry.value = input.checked ? 'true' : ''; invalidate(); }); header.append(input);
      } else if (cfg.selectionMode === 'quantity' && cfg.allowedQuantities?.length) {
        const select = node('select', 'addon-select'); select.setAttribute('aria-label', addon.name + ' quantity');
        const values = [...new Set([0, ...cfg.allowedQuantities.filter(value => number(value) <= limit)])];
        if (!values.includes(entry.quantity)) entry.quantity = 0;
        values.forEach(value => { const option = node('option', '', value ? value + ' - ' + money(cfg.quantityPrices?.[String(value)] ?? value * number(addon.price?.amount)) : 'No thanks'); option.value = String(value); select.append(option); }); select.value = String(entry.quantity); select.addEventListener('change', () => { entry.quantity = number(select.value); invalidate(); }); box.append(select);
      } else {
        entry.quantity = Math.min(limit, entry.quantity); const control = node('div', 'addon-control'); control.append(quantityControl(entry.quantity, 0, limit, addon.name + ' quantity', value => { entry.quantity = value; invalidate(); }, true)); header.append(control);
      }
      list.append(box);
    }); holder.append(list);
  }
  function estimatedTotal() {
    return state.items.reduce((sum, line) => {
      const product = productFor(line);
      return sum + number(product.price?.amount) * line.quantity + (product.addons || []).reduce((extra, addon) => {
        const entry = line.addons[addon.id]; if (!entry || !entry.quantity) return extra;
        if (addon.config?.selectionMode === 'options') return extra + number(addon.config.options?.find(option => option.value === entry.value)?.price, number(addon.price?.amount));
        return extra + number(addon.config?.quantityPrices?.[String(entry.quantity)], number(addon.price?.amount) * entry.quantity);
      }, 0);
    }, 0);
  }
  function updateTotal() { const amount = document.getElementById('estimated-amount'); if (amount) amount.textContent = document.body.dataset.theme === 'food' ? foodMoney(estimatedTotal()) : money(estimatedTotal()); const guests = document.getElementById('food-summary-guests'); if (guests) guests.textContent = String(state.items.reduce((sum, line) => sum + line.quantity, 0)); }
  function discountField() {
    const details = node('details', 'discount-details'); details.open = Boolean(state.discountCode); details.append(node('summary', '', 'Have a discount code?')); const input = node('input'); input.name = 'discountCode'; input.maxLength = 100; input.autocomplete = 'off'; input.value = state.discountCode; input.placeholder = 'Enter your code'; input.setAttribute('aria-label', 'Discount code'); input.addEventListener('input', () => { state.discountCode = input.value; invalidate(); }); details.append(input); return details;
  }
  function additionalExperienceControl() { if (!state.offeringCode || !state.offerings.some(offering => offering.code === state.offeringCode && offering.kind === 'package')) return button('Add another experience', () => { state.adding = true; go('catalog'); }, 'text-button add-experience', 'plus'); return null; }
  function ktkInformation(product) {
    const content = product.config?.content || {}, main = node('div', 'ktk-detail__main'), gallery = node('section', 'ktk-gallery'), stage = node('div', 'ktk-gallery__stage');
    const photos = [...new Set([photo(product), ...(product.images || []).map(value => typeof value === 'string' ? value : value.url)].filter(Boolean))], current = image(photos[0], product.name, '', false), count = node('span', '', '01 / ' + String(Math.max(photos.length, 1)).padStart(2, '0')); stage.append(current, count); gallery.append(stage);
    if (photos.length > 1) { const thumbs = node('div', 'ktk-gallery__thumbs'); photos.forEach((url, index) => { const thumb = button('', () => { const next = image(url, product.name, '', false); stage.firstChild.replaceWith(next); count.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(photos.length).padStart(2, '0'); thumbs.querySelectorAll('button').forEach((element, i) => { element.classList.toggle('is-active', i === index); element.setAttribute('aria-pressed', String(i === index)); }); }, index === 0 ? 'is-active' : ''); thumb.setAttribute('aria-label', 'Show image ' + (index + 1)); thumb.setAttribute('aria-pressed', String(index === 0)); thumb.append(image(url, '', '', true)); thumbs.append(thumb); }); gallery.append(thumbs); } main.append(gallery);
    if (content.description) { const story = node('section', 'ktk-product-story'), heading = node('div'); heading.append(node('p', 'ktk-eyebrow', 'The experience'), node('h2', '', 'Organised chaos, handled locally.')); story.append(heading, node('p', '', cleanText(content.description))); main.append(story); }
    const practical = node('section', 'ktk-practical-info');
    if (content.meetingPoint?.name) { const point = content.meetingPoint, section = node('div', 'ktk-practical-info__section ktk-practical-info__section--meeting'); section.append(node('p', 'ktk-eyebrow', 'Meeting point'), node('h2', '', point.name)); if (point.address) section.append(node('p', '', point.address)); if (point.instructions) section.append(node('strong', '', point.instructions)); if (point.photoUrl) section.append(image(point.photoUrl, point.name, 'meeting-photo')); const url = safeUrl(point.mapUrl); if (url) { const link = node('a', '', 'Open in Google Maps'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; section.append(link); } practical.append(section); }
    if (content.importantInformation?.length) { const section = node('div', 'ktk-practical-info__section'), list = node('ul'); section.append(node('p', 'ktk-eyebrow', 'Important information')); content.importantInformation.forEach(value => list.append(node('li', '', cleanText(value)))); section.append(list); practical.append(section); } if (practical.childNodes.length) main.append(practical); return main;
  }
  function configureKtk(product) {
    const page = node('div', 'ktk-detail'), nav = node('nav', 'ktk-detail__nav'); nav.append(button('All experiences', () => go('catalog'), 'ktk-back', 'back'), node('span', '', 'Local crew. Secure booking.')); page.append(nav);
    const hero = node('header', 'ktk-detail__hero'), intro = node('div', 'ktk-detail__intro'), content = product.config?.content || {}; intro.append(node('h1', '', product.name)); if (content.summary || content.card?.description) intro.append(node('p', '', cleanText(content.summary || content.card.description))); const price = node('div', 'ktk-detail__starting-price'); price.append(node('span', '', 'From'), node('strong', '', money(product.price?.amount)), node('small', '', 'per person')); hero.append(intro, price); page.append(hero);
    const layout = node('div', 'ktk-detail__layout'); layout.append(ktkInformation(product)); const panel = node('aside', 'ktk-booking'); panel.setAttribute('aria-label', 'Configure this experience'); const form = node('form', 'ktk-configurator'); form.id = 'booking-form'; const heading = node('div', 'ktk-configurator__heading'), title = node('div'); title.append(node('h2', 'panel-heading', product.name)); heading.append(title); form.append(heading);
    state.items.forEach((line, index) => {
      const selected = productFor(line); if (state.items.length > 1) { const row = node('div', 'line-heading'); row.append(node('h3', '', selected.name)); if (!state.offeringCode) { const remove = button('', () => { state.items.splice(index, 1); state.activeIndex = 0; invalidate(); render(); }, 'icon-button', 'close'); remove.setAttribute('aria-label', 'Remove ' + selected.name); row.append(remove); } form.append(row); }
      const groups = { date_time: schedule(line, selected), group_size: participants(line, selected), contact_details: null, addons: node('div') }; groups.addons.id = 'addons-' + line.uid;
      if (index === 0) { groups.contact_details = node('section', 'ktk-product-contact'); groups.contact_details.setAttribute('aria-label', 'Contact details'); groups.contact_details.append(contactControls()); }
      const configured = Array.isArray(selected.config?.sectionOrder) ? selected.config.sectionOrder : []; [...new Set([...configured.filter(key => key in groups), 'date_time', 'group_size', 'contact_details', 'addons'])].forEach(key => { if (groups[key]) form.append(groups[key]); });
    });
    const total = node('div', 'ktk-configurator__total'), amount = node('strong'); amount.id = 'estimated-amount'; amount.setAttribute('aria-live', 'polite'); total.append(node('span', '', 'Estimated total'), amount); form.append(total);
    const cta = button('Add to cart', () => {}, 'ktk-booking__cta'); cta.append(node('span', '', '\u2192')); cta.type = 'submit'; cta.dataset.idleLabel = 'Add to cart'; form.append(cta); form.addEventListener('submit', event => { event.preventDefault(); void quote(); }); panel.append(form); layout.append(panel); page.append(layout); app.append(page); state.items.forEach(line => refreshAddons(line)); updateTotal();
  }
  function configureFood(product) {
    const section = node('section', 'source-food'), back = node('div', 'back-row'); back.append(button('All experiences', () => go('catalog'), 'text-button', 'back')); section.append(back);
    const header = node('div', 'food-tour-header'), heading = node('div', 'food-tour-heading'), content = product.config?.content || {}; heading.append(node('h1', '', product.name)); if (content.card?.subtitle) heading.append(node('p', '', cleanText(content.card.subtitle))); header.append(heading);
    const facts = node('dl', 'food-tour-facts'), duration = number(product.config?.durationMinutes); const values = [['Start', foodTime(product.config?.defaultStartTime) || product.config?.startTimes?.map(foodTime).join(' / ')], ['Duration', duration ? (duration % 60 ? (duration / 60).toFixed(1) : duration / 60) + ' hours' : ''], ['Per guest', foodMoney(product.price?.amount)]]; values.filter(([, value]) => value).forEach(([label, value]) => { const item = node('div'); item.append(node('dt', '', label), node('dd', '', value)); facts.append(item); }); facts.dataset.facts = String(facts.childNodes.length); header.append(facts); section.append(header);
    const about = node('details', 'food-about'); about.append(node('summary', '', 'About this experience')); const info = node('div', 'food-experience-content');
    if (content.summary) info.append(node('p', 'food-experience-summary', cleanText(content.summary)));
    function block(title) { const block = node('section'); block.append(node('h3', '', title)); info.append(block); return block; }
    if (content.description) block('About this experience').append(node('p', 'multiline-copy', cleanText(content.description)));
    for (const [key, title] of [['highlights', 'Highlights'], ['importantInformation', 'Good to know']]) if (content[key]?.length) { const list = node('ul'); content[key].forEach(value => list.append(node('li', '', cleanText(value)))); block(title).append(list); }
    if (content.meetingPoint?.name) { const point = content.meetingPoint, meeting = block('Meeting point'); meeting.append(node('strong', '', point.name)); if (point.address) meeting.append(node('p', '', point.address)); if (point.instructions) meeting.append(node('p', 'multiline-copy', point.instructions)); const url = safeUrl(point.mapUrl); if (url) { const link = node('a', '', 'Open meeting point in Google Maps'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; meeting.append(link); } } about.append(info); section.append(about);
    const layout = node('div', 'food-checkout-layout'), form = node('form', 'food-checkout-form'); form.id = 'booking-form';
    state.items.forEach((line, index) => {
      const selected = productFor(line), card = node('section', 'food-section-card'); if (state.items.length > 1) card.append(node('h2', 'line-heading', selected.name)); const grid = node('div', 'food-fields'), date = schedule(line, selected), dateField = date.firstChild; dateField.querySelector('span').textContent = 'Tour date'; grid.append(dateField);
      const config = selected.config || {}, max = number(config.maxParticipants, 20), qty = quantityControl(line.quantity, Math.max(1, number(config.minParticipants, 1)), max, 'Guests for ' + selected.name, value => { line.quantity = value; refreshAddons(line); invalidate(); }), guests = field('Guests', qty); guests.append(node('p', 'food-guest-help', 'Online checkout accepts up to ' + max + ' guests per transaction. This is not a capacity limit for the date. For larger parties, make separate bookings or contact us.')); grid.append(guests);
      if (config.timeMode !== 'fixed' && date.childNodes.length) { const time = node('div', 'food-extra-departure'); while (date.firstChild) time.append(date.firstChild); grid.append(time); }
      if (index === 0) { const contacts = contactControls(true); while (contacts.firstChild) grid.append(contacts.firstChild); } card.append(grid); form.append(card); const addons = node('div'); addons.id = 'addons-' + line.uid; form.append(addons);
      const notes = node('section', 'food-section-card food-notes'), toggle = button('', () => { toggle.hidden = true; label.hidden = false; text.focus(); }, 'notes-toggle'); toggle.append(node('span', '', 'Add dietary notes and/or requests'), node('small', '', '(Optional)')); const label = field('Dietary notes or requests', node('span')); label.replaceChildren(node('span', '', 'Dietary notes or requests')); const text = node('textarea'); text.name = 'notes-' + line.uid; text.rows = 4; text.maxLength = 2000; text.value = line.notes || ''; text.addEventListener('input', () => { line.notes = text.value; invalidate(); }); label.append(text); label.hidden = !line.notes; toggle.hidden = Boolean(line.notes); notes.append(toggle, label, node('p', '', 'Adaptations depend on the planned venues and are not guaranteed. We cannot promise an allergen-free environment or zero cross-contact. For a medically essential requirement, please contact us before paying.')); form.append(notes);
    }); form.addEventListener('submit', event => { event.preventDefault(); void quote(); }); layout.append(form);
    const summary = node('aside', 'food-booking-summary'), headingWrap = node('div', 'food-summary-heading'); headingWrap.append(node('h2', 'panel-heading', 'Booking summary')); summary.append(headingWrap); const rows = [['Tour', state.items.map(line => productFor(line).name).join(' + ')], ['Start time', state.items.map(line => foodTime(line.time)).filter(Boolean).join(' / ')], ['Guests', String(state.items.reduce((sum, line) => sum + line.quantity, 0))], ['Per guest', foodMoney(product.price?.amount)]], descriptions = node('dl', 'food-summary-rows');
    rows.forEach(([label, value]) => { const row = node('div', 'food-summary-row'), item = node('dd', '', value); if (label === 'Guests') item.id = 'food-summary-guests'; row.append(node('dt', '', label), item); descriptions.append(row); }); summary.append(descriptions); const total = node('div', 'food-summary-total'), amount = node('strong'); amount.id = 'estimated-amount'; amount.setAttribute('aria-live', 'polite'); total.append(node('span', '', 'Total today'), amount); summary.append(total);
    const cta = button('Continue to payment', () => {}, 'food-payment-button'); cta.type = 'submit'; cta.setAttribute('form', form.id); cta.dataset.idleLabel = 'Continue to payment'; summary.append(cta, node('div', 'food-payment-state')); layout.append(summary); section.append(layout); app.append(section); state.items.forEach(line => refreshAddons(line)); updateTotal();
  }
  function configure() {
    if (!state.items.length) { state.stage = 'catalog'; render(); return; }
    const selected = productFor(state.items[state.activeIndex] || state.items[0]); if (theme(selected) === 'ktk') { configureKtk(selected); return; } if (theme(selected) === 'food') { configureFood(selected); return; }
  }

  function selection() {
    return { reference: state.reference, paymentMode: 'platform', ...(state.offeringCode ? { offeringCode: state.offeringCode } : {}), customer: { ...state.customer }, ...(state.discountCode.trim() ? { discountCode: state.discountCode.trim() } : {}), items: state.items.map(line => ({ productId: line.productId, quantity: line.quantity, experienceDate: line.date || undefined, experienceTime: line.time || undefined, options: { ...(productFor(line).config?.participantMode === 'gender_split' ? { participants: { men: line.men, women: line.women } } : {}), ...(line.notes?.trim() ? { notes: line.notes.trim() } : {}), ...(state.phoneCountry ? { countryCode: state.phoneCountry } : {}) }, addons: Object.entries(line.addons).filter(([, entry]) => entry.quantity > 0).map(([id, entry]) => ({ addonId: Number(id), quantity: entry.quantity, ...(entry.value ? { value: entry.value } : {}), ...(Object.keys(entry.variants).length ? { variants: Object.entries(entry.variants).filter(([, quantity]) => quantity > 0).map(([value, quantity]) => ({ value, quantity })) } : {}) })) })) };
  }
  function validate() {
    for (const line of state.items) {
      const product = productFor(line), config = product.config || {};
      if (config.dateRequired !== false && !line.date) { const trigger = document.querySelector('[data-field="date-' + line.uid + '"]'); trigger?.setAttribute('aria-invalid', 'true'); trigger?.focus(); throw Error('Choose an activity date for ' + product.name + '.'); }
      if (line.date && line.date < today()) throw Error('Choose an upcoming date for ' + product.name + '.');
      if (config.timeMode !== 'none' && !line.time) throw Error('Choose a start time for ' + product.name + '.');
      if (!Number.isInteger(line.quantity) || line.quantity < Math.max(1, number(config.minParticipants, 1)) || line.quantity > number(config.maxParticipants, 100)) throw Error('Choose a valid number of guests for ' + product.name + '.');
      for (const addon of product.addons || []) {
        const entry = line.addons[addon.id]; if (!entry?.quantity) continue;
        if (entry.quantity > addonLimit(addon, line)) throw Error('Reduce the number of ' + addon.name + ' to match your group or available stock.');
        if (addon.inventory?.variantSelectionRequired && Object.values(entry.variants).reduce((sum, value) => sum + number(value), 0) !== entry.quantity) throw Error('Assign exactly ' + entry.quantity + ' ' + addon.name + ' across the sizes.');
        if (addon.config?.selectionMode === 'range' && entry.quantity < Math.max(1, number(addon.config.minQuantity, 1))) throw Error('Choose at least ' + addon.config.minQuantity + ' for ' + addon.name + '.');
      }
    }
    if (['ktk', 'food'].includes(document.body.dataset.theme) && !state.phoneCountry) { document.querySelector('button[aria-label="Choose phone country code"]')?.focus(); throw Error('Select your country code.'); }
  }
  function setBusy(busy) {
    state.busy = busy; root.setAttribute('aria-busy', String(busy)); root.querySelectorAll('input,select,button').forEach(element => { if (busy) { element.dataset.wasDisabled = String(element.disabled); element.disabled = true; } else if ('wasDisabled' in element.dataset) { element.disabled = element.dataset.wasDisabled === 'true'; delete element.dataset.wasDisabled; } });
    const cta = document.querySelector('#booking-form button[type="submit"], button[form="booking-form"], .review-actions button, .booking-panel .button.wide'); if (cta) cta.textContent = busy ? 'Please wait...' : cta.dataset.idleLabel || (state.stage === 'review' ? 'Continue to secure payment' : 'Review your booking');
  }
  async function quote() {
    if (state.busy) return; setMessage();
    try { validate(); const form = document.getElementById('booking-form'); if (form && !form.reportValidity()) return; setBusy(true); const result = await api('/quote', selection()); state.quoted = result; state.stage = 'review'; render(); app.scrollIntoView({ block: 'start', behavior: 'instant' }); }
    catch (error) { setMessage(error.message); feedback.scrollIntoView({ block: 'nearest' }); }
    finally { setBusy(false); }
  }
  function review() {
    const quote = state.quoted;
    if (!quote) { state.stage = 'configure'; configure(); return; }
    const back = node('div', 'back-row'); if (!state.attempt) back.append(button('Edit your booking', () => go('configure'), 'text-button', 'back')); app.append(back);
    app.append(node('h1', 'review-heading', 'One last look.'), node('p', 'experience-summary', 'Your plans are nearly ready. Check the details below, then continue to secure payment.'));
    const layout = node('div', 'review-layout'), details = node('div');
    quote.items.forEach((item, index) => {
      const product = state.products.find(p => p.id === item.productId), row = node('article', 'review-item'); row.append(image(photo(product), product.name, '', false));
      const info = node('div', 'review-info'); info.append(node('h2', '', item.productName), node('p', '', dateLabel(item.experienceDate) + (item.experienceTime ? ' at ' + item.experienceTime : '')));
      const line = state.items[index], guests = line && product.config?.participantMode === 'gender_split' ? [line.men ? line.men + (line.men === 1 ? ' man' : ' men') : '', line.women ? line.women + (line.women === 1 ? ' woman' : ' women') : ''].filter(Boolean).join(' + ') : item.quantity + (item.quantity === 1 ? ' guest' : ' guests'); info.append(node('p', '', guests));
      (item.addons || []).forEach(addon => { const description = addon.variants?.length ? addon.variants.map(v => v.value + ' x ' + v.quantity).join(', ') : addon.value && addon.value !== 'true' ? addon.value : 'x ' + addon.quantity; info.append(node('p', '', addon.name + ': ' + description)); }); row.append(info, node('strong', 'review-price', money(item.total))); details.append(row);
    });
    const contact = node('section', 'review-contact'); contact.append(node('strong', '', state.customer.firstName + ' ' + state.customer.lastName), node('p', '', state.customer.email)); if (state.customer.phone) contact.append(node('p', '', state.customer.phone)); details.append(contact);
    if (!state.attempt) { const extra = additionalExperienceControl(); if (extra) details.append(extra); details.append(discountField(), button('Apply code', () => void quote(), 'button secondary')); }
    const summary = node('section', 'booking-panel'); summary.append(node('h2', 'panel-heading', 'Your booking'));
    function row(label, amount, className = '') { const result = node('div', 'summary-row ' + className); result.append(node('span', '', label), node('strong', '', money(amount))); summary.append(result); }
    row('Experiences', quote.subtotal); if (quote.addonTotal > 0) row('Extras', quote.addonTotal); if (quote.discountTotal > 0) row('Discount' + (quote.discountCode ? ' (' + quote.discountCode + ')' : ''), -quote.discountTotal, 'discount'); row('Total to pay', quote.total, 'total');
    const actions = node('div', 'review-actions'); actions.append(button('Continue to secure payment', () => void pay(), 'button wide', 'lock')); summary.append(actions); const note = node('p', 'secure-note', 'Payment is securely processed by Stripe.'); note.prepend(icon('lock')); summary.append(note, node('p', 'booking-footer', 'Your tickets and meeting details will arrive by email once payment is confirmed.')); layout.append(details, summary); app.append(layout);
  }
  async function pay() {
    if (state.busy) return; setMessage(); setBusy(true);
    try {
      const payload = state.attempt || selection();
      if (!state.attempt) {
        const fresh = await api('/quote', payload);
        if (!state.quoted || Math.round(fresh.total * 100) !== Math.round(state.quoted.total * 100)) { state.quoted = fresh; render(); setMessage('Your booking has been updated. Please review the total before continuing.', 'info'); return; }
      }
      state.attempt = payload;
      const result = await api('/book', payload);
      if (result.checkoutUrl) {
        const url = new URL(result.checkoutUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw Error('We could not open a verified Stripe payment page. Please retry.');
        if (window.top === window) location.assign(url.href);
        else {
          const link = node('a', 'button wide payment-link', 'Open secure payment'); link.href = url.href; link.target = '_top'; feedback.replaceChildren(node('p', '', 'Your secure checkout is ready.'), link); feedback.hidden = false; feedback.className = 'notice info'; link.click();
        }
      } else setMessage('Your booking has been received. Please check your email for the confirmation.', 'info');
    } catch (error) { setMessage(error.message + (state.attempt ? ' Retry to reopen the same booking securely.' : '')); }
    finally { setBusy(false); if (state.attempt) document.querySelectorAll('.back-row button').forEach(control => { control.disabled = true; }); }
  }
  function render() {
    closeCalendar(); closeSelect(); app.replaceChildren();
    const product = state.items.length ? productFor(state.items[state.activeIndex] || state.items[0]) : null;
    document.body.dataset.theme = state.stage === 'catalog' ? 'catalog' : theme(product);
    document.body.dataset.stage = state.stage; app.className = document.body.dataset.theme === 'ktk' ? 'ktk-app' : '';
    document.querySelector('.progress').hidden = !appearance.showStepper;
    document.querySelectorAll('.progress-item').forEach((item, index) => { const active = index === ['catalog', 'configure', 'review'].indexOf(state.stage); item.classList.toggle('active', active); if (active) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
    if (state.stage === 'catalog') catalog(); else if (state.stage === 'configure') configure(); else review();
  }
  async function load() {
    app.replaceChildren(node('p', 'loading', 'Finding your next experience...')); setMessage();
    try {
      const data = await api('/catalog'); loadedProducts = data.products || []; loadedOfferings = data.offerings || []; appearance = data.appearance || appearance; catalogReady = true;
      applyPresentation(previewAppearance || appearance, true);
      if (data.checkoutMode === 'test') { const banner = node('div', 'test-banner', 'Local preview - Stripe test payments only'); root.prepend(banner); }
      const payment = new URLSearchParams(location.search).get('payment');
      if (payment === 'returned') setMessage('Payment confirmation is being checked. Your booking email will arrive after payment is verified.', 'info');
      else if (payment === 'cancelled') setMessage('Payment was not completed. You can choose your experience and try again.', 'info');
    } catch (error) { app.replaceChildren(node('div', 'empty', 'Your experiences could not be loaded.'), button('Try again', () => void load(), 'button')); setMessage(error.message); }
  }
  function applyPresentation(value, initial = false) {
    appearance = value;
    state.products = loadedProducts.filter(p => !Array.isArray(value.productIds) || value.productIds.includes(p.id));
    state.offerings = loadedOfferings.filter(o => o.items.every(item => state.products.some(p => p.id === item.productId)));
    const brand = document.querySelector('.partner-brand'); brand.replaceChildren(); brand.hidden = !value.showBrand;
    if (value.brandDisplay !== 'name' && safeUrl(value.logoUrl)) {
      const logo = node('img', 'partner-logo'); logo.src = safeUrl(value.logoUrl); logo.alt = presentation.name;
      logo.addEventListener('error', () => { if (value.brandDisplay === 'both') logo.remove(); else logo.replaceWith(node('span', '', presentation.name)); }, { once: true }); brand.append(logo);
    }
    if (value.brandDisplay !== 'logo' || !safeUrl(value.logoUrl)) brand.append(node('span', '', presentation.name));
    const powered = document.querySelector('.powered'); powered.hidden = !value.showPoweredBy; powered.replaceChildren(node('span', '', value.poweredByText), node('strong', '', 'OmniLodge'));
    document.querySelector('.masthead').hidden = !value.showBrand && !value.showPoweredBy;
    const footer = document.querySelector('.footer'); footer.replaceChildren();
    [['showPaymentTrust', 'paymentTrustText', 'lock'], ['showEmailTrust', 'emailTrustText', 'ticket'], ['showPartnerTrust', 'partnerTrustText']].forEach(([visible, text, glyph]) => {
      if (!value[visible] || !value[text]) return; const item = node('span', '', value[text].replaceAll('{partnerName}', presentation.name)); if (glyph) item.prepend(icon(glyph)); footer.append(item);
    });
    footer.hidden = !footer.childElementCount;
    if (initial) {
      state.stage = 'catalog'; state.items = []; state.activeIndex = 0; state.quoted = null; state.attempt = null;
      const chosen = value.entryMode === 'product' ? state.products.find(p => p.id === value.entryProductId) : value.entryMode === 'single' && state.products.length === 1 ? state.products[0] : null;
      if (chosen) { state.items = [makeLine(chosen)]; state.stage = 'configure'; }
      else if (value.entryMode === 'product') { render(); app.replaceChildren(node('p', 'empty', 'This experience is currently unavailable. Please contact the partner.')); return; }
    }
    render();
  }
  // Draft previews use plain text and existing approved catalog data only. They
  // cannot save settings or create a booking, and only accept their own parent.
  if (draftPreview && window.parent !== window) window.addEventListener('message', event => {
    let parentOrigin; try { parentOrigin = new URL(document.referrer).origin; } catch { return; }
    if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== 'omnilodge:partner-preview' || !event.data.appearance || typeof event.data.appearance !== 'object') return;
    previewAppearance = { ...presentation.appearance, ...event.data.appearance };
    if (catalogReady) applyPresentation(previewAppearance, true);
  });
  document.addEventListener('pointerdown', event => { if (activeCalendar && !activeCalendar.popup.contains(event.target) && !activeCalendar.trigger.contains(event.target)) closeCalendar(); if (activeSelect && !activeSelect.wrap.contains(event.target)) closeSelect(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeCalendar(true); closeSelect(true); } if (event.key === 'Tab') closeSelect(); });
  document.body.dataset.embed = String(new URLSearchParams(location.search).get('embed') === '1' || window.top !== window);
  if (window.top !== window && typeof ResizeObserver !== 'undefined') {
    let queued = false, last = 0;
    const observer = new ResizeObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; const height = Math.ceil(root.getBoundingClientRect().height); if (Math.abs(height - last) < 3) return; last = height; let origin = '*'; try { if (document.referrer) origin = new URL(document.referrer).origin; } catch {} window.parent.postMessage({ type: 'omnilodge:partner-resize', height }, origin); }); }); observer.observe(root);
  }
  void load();
})();
`;

/** Optional parent-page helper: accept sizing only from the exact embedded
 * window and origin. Messages never include booking/contact/payment details. */
export const partnerSalesEmbedClient = String.raw`
(() => {
  if (window.__omniPartnerEmbed) return;
  window.__omniPartnerEmbed = true;
  window.addEventListener('message', event => {
    if (event.data?.type !== 'omnilodge:partner-resize' || !Number.isFinite(event.data.height)) return;
    document.querySelectorAll('iframe[data-omnilodge-partner]').forEach(frame => {
      let origin; try { origin = new URL(frame.src, location.href).origin; } catch { return; }
      if (frame.contentWindow !== event.source || origin !== event.origin) return;
      frame.style.height = Math.max(240, Math.min(10000, Math.ceil(event.data.height))) + 'px';
    });
  });
})();
`;
