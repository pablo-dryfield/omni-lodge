/** Storefront-owned booking rules copied verbatim from KTK storefront.css.
 * Source SHA-256: c3a0cedaec9ac5f18fbf7c83bd5779723c77df1fc22cc654caf2c40d908e1f9a
 * Keep these selectors and the matching DOM in sync with the source configurator.
 * No WordPress scripts, analytics, cart APIs or storefront deployment is imported. */
export const partnerKtkStyles = String.raw`

.ktk-configurator {
  display: grid;
  gap: 24px;
  min-width: 0;
  padding: clamp(22px, 4vw, 38px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  background:
    radial-gradient(circle at 100% 0, rgba(255, 16, 139, 0.13), transparent 36%),
    #0b0a0b;
}

.ktk-configurator__heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
}

.ktk-configurator__heading h2 {
  margin: 4px 0 0;
  color: #fff;
  font-family: "Oswald", sans-serif;
  font-size: clamp(30px, 4vw, 54px);
  line-height: 0.92;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}

.ktk-configurator__heading > span,
.ktk-configurator__total {
  color: var(--ktk-yellow);
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ktk-configurator__split,
.ktk-configurator__schedule,
.ktk-configurator__customer {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.ktk-configurator__participant {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.ktk-configurator__participant > div:first-child {
  display: grid;
  gap: 4px;
}

.ktk-configurator__participant strong {
  color: #fff;
  font-size: 13px;
  text-transform: uppercase;
}

.ktk-configurator__participant small,
.ktk-configurator__addon small {
  color: rgba(243, 238, 228, 0.55);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}

.ktk-configurator label,
.ktk-configurator fieldset {
  display: grid;
  gap: 8px;
  min-width: 0;
  margin: 0;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.ktk-configurator label > span {
  text-align: center;
}

.ktk-configurator legend,
.ktk-configurator__participant > div:first-child {
  text-align: center;
}

.ktk-configurator input,
.ktk-configurator select {
  width: 100%;
  min-height: 52px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 0;
  background: #121012;
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  text-align: center;
  text-transform: none;
}

.ktk-configurator select {
  appearance: none;
  padding-inline: 38px;
  background-color: #121012;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='8' viewBox='0 0 14 8' fill='none'%3E%3Cpath d='M1 1L7 7L13 1' stroke='%23FFD43B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;
  background-size: 12px 7px;
  color-scheme: dark;
  cursor: pointer;
  text-align: center;
  text-align-last: center;
}

.ktk-configurator select option {
  padding-right: 0;
  padding-left: 0;
  text-align: center;
  text-indent: 0;
}

.ktk-custom-select {
  --ktk-select-font-size: 18px;
  position: relative;
  width: 100%;
  min-width: 0;
}

.ktk-custom-select__trigger {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 52px;
  padding: 12px 38px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: #121012;
  color: #fff;
  font: inherit;
  font-size: var(--ktk-select-font-size);
  font-weight: 800;
  letter-spacing: 0;
  text-align: center;
  text-transform: none;
  cursor: pointer;
}

.ktk-custom-select__trigger:hover,
.ktk-custom-select__trigger:focus-visible,
.ktk-custom-select__trigger.is-open {
  border-color: var(--ktk-pink);
  outline: 2px solid rgba(255, 16, 139, 0.18);
  outline-offset: 2px;
}

.ktk-custom-select__trigger > span {
  display: block;
  width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ktk-custom-select__trigger > i {
  position: absolute;
  right: 16px;
  width: 12px;
  height: 7px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='8' viewBox='0 0 14 8' fill='none'%3E%3Cpath d='M1 1L7 7L13 1' stroke='%23FFD43B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
  transition: transform 160ms ease;
}

.ktk-custom-select__trigger.is-open > i {
  transform: rotate(180deg);
}

.ktk-custom-select__options {
  position: absolute;
  z-index: 50;
  top: calc(100% + 6px);
  left: 0;
  width: 100%;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid rgba(243, 238, 228, 0.3);
  background: #121012;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.58);
}

.ktk-custom-select__search {
  position: sticky;
  z-index: 1;
  top: 0;
  padding: 8px;
  border-bottom: 1px solid rgba(243, 238, 228, 0.18);
  background: #171015;
}

.ktk-configurator .ktk-custom-select__search input {
  min-height: 44px;
  padding: 9px 12px;
  border-color: var(--ktk-pink);
  font-size: 14px;
}

.ktk-custom-select__empty {
  margin: 0;
  padding: 18px 12px;
  color: rgba(243, 238, 228, 0.55);
  font-size: 12px;
  text-align: center;
  text-transform: none;
}

.ktk-custom-select__options button {
  display: block;
  width: 100%;
  min-height: 50px;
  padding: 12px;
  border: 0;
  border-bottom: 1px solid rgba(243, 238, 228, 0.08);
  background: transparent;
  color: var(--ktk-cream);
  font: inherit;
  font-size: var(--ktk-select-font-size);
  font-weight: 800;
  text-align: center;
  text-transform: none;
  cursor: pointer;
}

.ktk-custom-select__options button:hover,
.ktk-custom-select__options button:focus-visible,
.ktk-custom-select__options button.is-selected {
  background: var(--ktk-pink);
  color: #fff;
  outline: 0;
}

.ktk-configurator input:focus,
.ktk-configurator select:focus {
  border-color: var(--ktk-pink);
  outline: 2px solid rgba(255, 16, 139, 0.2);
  outline-offset: 2px;
}

.ktk-configurator input[aria-invalid="true"] {
  border-color: var(--ktk-pink);
}

.ktk-configurator .ktk-field-error {
  color: #ff76b9;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.02em;
  line-height: 1.35;
  text-align: center;
  text-transform: none;
}

.ktk-configurator input::placeholder {
  color: rgba(243, 238, 228, 0.68);
  opacity: 1;
  text-align: center;
}

.ktk-configurator__fixed-date,
.ktk-configurator__fixed-time {
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 2px;
  min-height: 52px;
  padding: 4px 0;
}

.ktk-configurator__fixed-date strong,
.ktk-configurator__fixed-time strong {
  color: var(--ktk-yellow);
  font-size: 20px;
}

.ktk-configurator__fixed-date small {
  color: rgba(243, 238, 228, 0.62);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ktk-date-picker {
  position: relative;
  min-width: 0;
}

.ktk-date-picker__trigger {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 12px 15px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: #121012;
  color: rgba(243, 238, 228, 0.68);
  font: inherit;
  font-size: 22px;
  font-weight: 900;
  text-align: left;
  text-transform: uppercase;
  cursor: pointer;
}

.ktk-date-picker__trigger > span {
  width: 100%;
  text-align: center;
}

.ktk-date-picker__trigger:hover,
.ktk-date-picker__trigger:focus-visible,
.ktk-date-picker__trigger.is-open {
  border-color: var(--ktk-pink);
  outline: 2px solid rgba(255, 16, 139, 0.18);
  outline-offset: 2px;
}

.ktk-date-picker__trigger i {
  position: absolute;
  right: 15px;
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  border: 1px solid rgba(243, 238, 228, 0.5);
  background:
    linear-gradient(var(--ktk-pink), var(--ktk-pink)) 2px 4px / 11px 2px no-repeat;
}

.ktk-date-picker__popover {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  left: 0;
  width: min(310px, calc(100vw - 64px));
  padding: 14px;
  border: 1px solid rgba(243, 238, 228, 0.24);
  background: #171015;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
}

.ktk-date-picker__header {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 8px;
  margin-bottom: 13px;
}

.ktk-date-picker__header strong {
  color: var(--ktk-cream);
  font-size: 12px;
  text-align: center;
}

.ktk-date-picker__header button {
  display: grid;
  place-items: center;
  width: 34px;
  min-height: 34px;
  padding: 0;
  border: 1px solid rgba(243, 238, 228, 0.16);
  background: transparent;
  color: var(--ktk-yellow);
  font: inherit;
  cursor: pointer;
}

.ktk-date-picker__header button:hover:not(:disabled),
.ktk-date-picker__header button:focus-visible {
  border-color: var(--ktk-pink);
  background: var(--ktk-pink);
  color: #fff;
}

.ktk-date-picker__header button:disabled {
  color: rgba(243, 238, 228, 0.2);
  cursor: not-allowed;
}

.ktk-date-picker__weekdays,
.ktk-date-picker__days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}

.ktk-date-picker__weekdays {
  margin-bottom: 4px;
}

.ktk-date-picker__weekdays span {
  color: rgba(243, 238, 228, 0.72);
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.ktk-date-picker__days > span,
.ktk-date-picker__days button {
  min-width: 0;
  min-height: 34px;
}

.ktk-date-picker__days button {
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ktk-cream);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.ktk-date-picker .ktk-date-picker__days button {
  font-size: 14px;
}

.ktk-date-picker__days button:hover:not(:disabled),
.ktk-date-picker__days button:focus-visible {
  border-color: var(--ktk-pink);
}

.ktk-date-picker__days button.is-today {
  border-color: var(--ktk-yellow);
  color: var(--ktk-yellow);
}

.ktk-date-picker__days button.is-selected {
  border-color: var(--ktk-pink);
  background: var(--ktk-pink);
  color: #fff;
}

.ktk-date-picker__days button.is-unavailable {
  border-color: rgba(255, 211, 54, 0.28);
  background:
    linear-gradient(135deg, transparent 45%, rgba(255, 211, 54, 0.82) 47%, rgba(255, 211, 54, 0.82) 53%, transparent 55%);
  color: rgba(243, 238, 228, 0.54);
}

.ktk-date-picker__days button.is-unavailable:hover,
.ktk-date-picker__days button.is-unavailable:focus-visible {
  border-color: var(--ktk-yellow);
  color: var(--ktk-yellow);
}

.ktk-date-picker__days button.is-unavailable.is-redirect {
  border-color: var(--ktk-yellow);
  background: var(--ktk-yellow);
  color: #111;
  box-shadow: 0 0 0 1px rgba(255, 211, 54, 0.2);
}

.ktk-date-picker__days button.is-unavailable.is-redirect:hover,
.ktk-date-picker__days button.is-unavailable.is-redirect:focus-visible {
  border-color: var(--ktk-pink);
  background: var(--ktk-pink);
  color: #fff;
}

.ktk-date-picker__days button:disabled {
  color: rgba(243, 238, 228, 0.2);
  text-decoration: line-through;
  cursor: not-allowed;
}

.ktk-configurator__availability-message {
  margin: -10px 0 8px;
  color: var(--ktk-yellow);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
  text-transform: uppercase;
}

.ktk-configurator__phone {
  grid-column: 1 / -1;
}

.ktk-configurator__phone > div {
  display: grid;
  grid-template-columns: minmax(145px, 0.8fr) minmax(130px, 1fr);
  align-items: center;
  min-width: 0;
}

.ktk-configurator__phone > div > select,
.ktk-configurator__phone > div > .ktk-custom-select {
  min-width: 0;
}

.ktk-configurator__addons {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 0;
  border: 0;
}

.ktk-configurator__addons legend {
  margin-bottom: 12px;
}

.ktk-configurator__addon {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.035);
}

.ktk-configurator__addon > div:first-child {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.ktk-configurator__addon-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
}

.ktk-configurator__addon-title strong {
  min-width: 0;
}

.ktk-configurator__addon-info-button {
  display: inline-grid;
  place-items: center;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid currentColor;
  border-radius: 50%;
  background: transparent;
  color: var(--ktk-pink);
  font: 900 italic 16px/1 Georgia, serif;
  cursor: pointer;
}

.ktk-configurator__addon-info-button:hover,
.ktk-configurator__addon-info-button:focus-visible {
  color: var(--ktk-yellow);
}

.ktk-configurator__addon-info-button:focus-visible {
  outline: 2px solid var(--ktk-yellow);
  outline-offset: 2px;
}

.ktk-configurator__addon-emoji {
  display: inline-block;
  margin-right: 8px;
  font-size: 18px;
  line-height: 1;
  vertical-align: -2px;
}

.ktk-configurator__addon-variants {
  display: grid;
  gap: 10px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.ktk-configurator__addon-variants-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: baseline;
  gap: 12px;
}

.ktk-configurator__addon-variants-heading > span {
  grid-column: 2;
  color: rgba(243, 238, 228, 0.76);
  font-size: 13px;
  font-weight: 900;
  text-align: center;
  text-transform: uppercase;
}

.ktk-configurator__addon-variants-heading > small {
  grid-column: 3;
  justify-self: end;
  color: var(--ktk-yellow);
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;
}

.ktk-configurator__addon-variants-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(48px, 1fr));
  gap: 8px;
}

.ktk-configurator__addon-variant {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.ktk-configurator__addon-variant > span {
  color: rgba(243, 238, 228, 0.82);
  font-size: 12px;
  font-weight: 900;
  text-align: center;
  text-transform: uppercase;
}

.ktk-configurator__addon-variant-quantity .ktk-custom-select__trigger {
  min-height: 44px;
  padding: 8px 10px;
  font-size: 14px;
}

.ktk-configurator__addon-variants .ktk-custom-select__trigger[aria-invalid="true"] {
  border-color: var(--ktk-pink);
  outline: 2px solid rgba(255, 16, 139, 0.2);
  outline-offset: 2px;
}

.ktk-configurator__addon-variants .ktk-field-error {
  text-align: left;
}

.ktk-configurator__addon > button {
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid rgba(243, 238, 228, 0.22);
  background: transparent;
  color: var(--ktk-cream);
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  cursor: pointer;
}

.ktk-configurator__addon > button:hover,
.ktk-configurator__addon > button:focus-visible,
.ktk-configurator__addon > button.is-active {
  border-color: var(--ktk-pink);
  background: var(--ktk-pink);
}

.ktk-config-stepper {
  display: grid;
  grid-template-columns: 48px minmax(42px, 1fr) 48px;
  min-height: 52px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: #121012;
}

.ktk-config-stepper button,
.ktk-config-stepper output {
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 18px;
  font-weight: 900;
}

.ktk-config-stepper button {
  cursor: pointer;
}

.ktk-config-stepper button:hover {
  background: var(--ktk-pink);
}

.ktk-configurator .ktk-config-quantity-select {
  --ktk-select-font-size: 22px;
}

.ktk-configurator .ktk-config-quantity-select .ktk-custom-select__trigger {
  font-weight: 900;
}

@media (max-width: 720px) {

  .ktk-configurator__heading {
    align-items: start;
  }

  .ktk-configurator__schedule,
  .ktk-configurator__customer,
  .ktk-configurator__addons {
    grid-template-columns: 1fr;
  }

  .ktk-configurator__split {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ktk-configurator__phone > div {
    grid-template-columns: minmax(112px, 0.8fr) minmax(110px, 1fr);
  }
}

.ktk-eyebrow {
  margin: 0 0 18px;
  color: var(--ktk-pink);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.ktk-product-card h3 a,
.ktk-product-card__footer a,
a.ktk-back,
a.ktk-hero__secondary,
a.ktk-hero-ticket {
  color: inherit;
  text-decoration: none;
}

.ktk-product-card a:focus-visible,
a.ktk-back:focus-visible,
a.ktk-hero__secondary:focus-visible,
a.ktk-hero-ticket:focus-visible {
  outline: 2px solid var(--ktk-pink);
  outline-offset: 5px;
}
#ktk-storefront-public-content .ktk-practical-info__section--important h2 { font-family: inherit; }

.ktk-detail {
  width: min(1380px, calc(100% - 48px));
  margin: 0 auto;
  padding: 55px 0 120px;
}

.ktk-back {
  margin-bottom: 30px;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgba(243, 238, 228, 0.7);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  cursor: pointer;
}

.ktk-detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(350px, 0.9fr);
  gap: clamp(50px, 8vw, 130px);
  align-items: start;
}

.ktk-detail .ktk-product-art {
  min-height: 610px;
}

.ktk-detail__content {
  padding-top: 45px;
}

.ktk-detail h1 {
  margin: 0;
  font-family: "Oswald", sans-serif;
  font-size: clamp(64px, 7vw, 108px);
  letter-spacing: -0.055em;
  line-height: 0.85;
  text-transform: uppercase;
}

.ktk-detail__lead {
  margin: 35px 0;
  color: rgba(243, 238, 228, 0.72);
  font-size: 17px;
  line-height: 1.7;
}

.ktk-error > p:not(.ktk-eyebrow) {
  max-width: 500px;
  color: rgba(243, 238, 228, 0.7);
  line-height: 1.7;
}

@media (max-width: 900px) {

  .ktk-detail__grid {
    grid-template-columns: 1fr;
  }

  .ktk-detail .ktk-product-art {
    min-height: 470px;
  }
}

@media (max-width: 620px) {
  .ktk-hero,
  .ktk-detail,
  .ktk-footer {
    width: min(100% - 30px, 1380px);
  }

  .ktk-detail {
    padding-top: 35px;
    padding-bottom: 80px;
  }

  .ktk-detail .ktk-product-art {
    min-height: 310px;
  }

  .ktk-detail__content {
    padding-top: 0;
  }

  .ktk-detail h1 {
    font-size: 64px;
  }
}
.ktk-detail {
  width: min(1440px, calc(100% - 64px));
  margin: 0 auto;
  padding: 36px 0 120px;
}

.ktk-detail__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--ktk-line);
}

.ktk-back {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ktk-cream);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.ktk-back span {
  color: var(--ktk-pink);
  font-size: 20px;
  line-height: 1;
  transition: transform 180ms ease;
}

.ktk-back:hover span,
.ktk-back:focus-visible span {
  transform: translateX(-4px);
}

.ktk-detail__nav > span {
  color: rgba(243, 238, 228, 0.58);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.ktk-detail__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: clamp(32px, 5vw, 72px);
  padding: clamp(48px, 7vw, 92px) 0 clamp(42px, 5vw, 66px);
}

.ktk-detail__intro {
  min-width: 0;
  max-width: 1080px;
  text-align: center;
}

.ktk-detail__intro .ktk-eyebrow,
.ktk-product-story .ktk-eyebrow,
.ktk-booking .ktk-eyebrow {
  margin: 0 0 16px;
  color: var(--ktk-pink);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.ktk-product-story .ktk-eyebrow {
  font-size: clamp(17px, 1.45vw, 21px);
}

.ktk-detail__intro h1 {
  max-width: 1000px;
  margin: 0 auto;
  color: var(--ktk-cream);
  font-family: "Oswald", sans-serif;
  font-size: clamp(72px, 8.8vw, 148px);
  font-weight: 700;
  letter-spacing: -0.055em;
  line-height: 0.82;
  text-transform: uppercase;
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.ktk-detail__intro > p:last-child {
  width: 100%;
  max-width: 760px;
  margin: 30px auto 0;
  color: rgba(243, 238, 228, 0.72);
  font-size: clamp(16px, 1.35vw, 21px);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.ktk-detail__starting-price {
  min-width: 190px;
  display: grid;
  gap: 4px;
  padding: 12px 0 10px 30px;
  border-left: 1px solid var(--ktk-line);
}

.ktk-detail__starting-price span,
.ktk-detail__starting-price small {
  color: rgba(243, 238, 228, 0.55);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.ktk-detail__starting-price strong {
  color: var(--ktk-yellow);
  font-family: "Oswald", sans-serif;
  font-size: clamp(34px, 3vw, 48px);
  line-height: 1;
}

.ktk-detail__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 390px);
  align-items: start;
  gap: clamp(36px, 5vw, 80px);
}

.ktk-detail__main {
  min-width: 0;
}

.ktk-gallery__stage {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border: 1px solid rgba(243, 238, 228, 0.12);
  border-radius: 5px;
  background:
    linear-gradient(135deg, rgba(255, 22, 143, 0.15), transparent 42%),
    #151311;
}

.ktk-gallery__stage > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ktk-gallery__stage > span {
  position: absolute;
  right: 18px;
  bottom: 16px;
  padding: 8px 10px;
  border: 1px solid rgba(243, 238, 228, 0.25);
  background: rgba(9, 9, 9, 0.78);
  color: var(--ktk-cream);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.14em;
  backdrop-filter: blur(8px);
}

.ktk-gallery__stage .ktk-product-art {
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 0;
}

.ktk-gallery__thumbs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.ktk-gallery__thumbs button {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: #151311;
  opacity: 0.48;
  cursor: pointer;
  transition:
    border-color 180ms ease,
    opacity 180ms ease,
    transform 180ms ease;
}

.ktk-gallery__thumbs button:hover,
.ktk-gallery__thumbs button:focus-visible,
.ktk-gallery__thumbs button.is-active {
  border-color: var(--ktk-pink);
  opacity: 1;
  transform: translateY(-2px);
}

.ktk-gallery__thumbs img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ktk-product-story {
  display: grid;
  grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1.2fr);
  gap: clamp(32px, 5vw, 76px);
  align-items: start;
  padding: clamp(54px, 7vw, 92px) 0;
  border-bottom: 1px solid var(--ktk-line);
}

.ktk-product-story h2 {
  margin: 0;
  color: var(--ktk-cream);
  font-family: "Oswald", sans-serif;
  font-size: clamp(38px, 4vw, 64px);
  letter-spacing: -0.035em;
  line-height: 0.96;
  text-transform: uppercase;
}

.ktk-product-story > div {
  text-align: center;
}

.ktk-product-story > p {
  justify-self: center;
  max-width: 650px;
  margin: 0;
  color: rgba(243, 238, 228, 0.72);
  font-size: clamp(16px, 1.25vw, 19px);
  line-height: 1.72;
  text-align: center;
  white-space: pre-line;
}

.ktk-practical-info,
.ktk-cancellation-policy {
  padding: clamp(48px, 6vw, 78px) 0;
  border-bottom: 1px solid var(--ktk-line);
}

.ktk-practical-info {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(36px, 6vw, 84px);
  padding-bottom: clamp(24px, 3.5vw, 42px);
}

.ktk-practical-info__section {
  display: grid;
  align-content: start;
  gap: 13px;
}

.ktk-practical-info__section .ktk-eyebrow,
.ktk-cancellation-policy .ktk-eyebrow {
  margin: 0 0 4px;
  color: var(--ktk-pink);
  font-size: 11px;
  font-weight: 900;
  text-align: center;
  text-transform: uppercase;
}

.ktk-practical-info__section .ktk-eyebrow {
  font-size: clamp(17px, 1.45vw, 21px);
  letter-spacing: 0.2em;
}

.ktk-cancellation-policy .ktk-eyebrow {
  font-size: clamp(17px, 1.45vw, 21px);
  letter-spacing: 0.2em;
}

.ktk-practical-info__section h2,
.ktk-cancellation-policy__title {
  display: block;
  margin: 0;
  color: var(--ktk-cream);
  font-family: "Oswald", sans-serif;
  font-size: clamp(28px, 3vw, 44px);
  letter-spacing: 0;
  line-height: 1.05;
  text-transform: uppercase;
}

.ktk-practical-info__section > p:not(.ktk-eyebrow),
.ktk-practical-info__section li,
.ktk-cancellation-policy p {
  margin: 0;
  color: rgba(243, 238, 228, 0.72);
  font-size: 15px;
  line-height: 1.65;
}

.ktk-practical-info__section > strong {
  color: var(--ktk-yellow);
  font-size: 15px;
}

.ktk-practical-info__section > a {
  width: fit-content;
  margin-top: 5px;
  color: var(--ktk-cream);
  font-size: 12px;
  font-weight: 900;
  text-decoration: underline;
  text-underline-offset: 5px;
  text-transform: uppercase;
}

.ktk-practical-info__section--meeting {
  justify-items: center;
  text-align: center;
}

.ktk-practical-info__section--meeting:only-child {
  grid-column: 1 / -1;
  width: min(100%, 760px);
  justify-self: center;
}

.ktk-practical-info__section--important {
  justify-items: center;
  text-align: center;
}

.ktk-practical-info__section--important .ktk-eyebrow {
  display: block;
}

.ktk-practical-info__section ul {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 20px;
}

.ktk-practical-info__section--important ul {
  width: min(100%, 560px);
  gap: 0;
  padding: 6px 0 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  list-style: none;
}

.ktk-practical-info__section--important li {
  position: relative;
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 13px 0;
  color: var(--ktk-cream);
  font-weight: 700;
  line-height: 1.55;
  text-align: left;
}

.ktk-practical-info__section--important li + li {
  border-top: 1px solid rgba(243, 238, 228, 0.1);
}

.ktk-practical-info__section--important li::before {
  content: "";
  display: block;
  width: 8px;
  height: 8px;
  margin-top: 0.72em;
  border-radius: 50%;
  background: var(--ktk-pink);
  box-shadow:
    0 0 0 4px rgba(255, 27, 145, 0.1),
    0 0 16px rgba(255, 27, 145, 0.24);
}

.ktk-booking {
  position: sticky;
  top: 42px;
  scroll-margin-top: 24px;
  overflow: hidden;
  padding: 28px;
  border: 1px solid rgba(243, 238, 228, 0.18);
  border-radius: 5px;
  background:
    radial-gradient(circle at 100% 0, rgba(255, 22, 143, 0.2), transparent 45%),
    linear-gradient(145deg, #1b1117, #100d0f 65%);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
}

.ktk-booking::before {
  content: "";
  position: absolute;
  inset: 7px;
  border: 1px solid rgba(243, 238, 228, 0.07);
  pointer-events: none;
}

.ktk-booking > * {
  position: relative;
  z-index: 1;
}

.ktk-booking .ktk-configurator {
  gap: 22px;
  padding: 0;
  border: 0;
  background: transparent;
}

.ktk-booking .ktk-configurator__heading {
  align-items: center;
  justify-content: center;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--ktk-line);
  text-align: center;
}

.ktk-booking .ktk-configurator__heading > div {
  width: 100%;
}

.ktk-booking .ktk-configurator__heading h2 {
  font-size: clamp(36px, 3.2vw, 44px);
  overflow-wrap: normal;
}

.ktk-booking .ktk-configurator__heading > span {
  flex: 0 0 auto;
  font-size: 9px;
  letter-spacing: 0.14em;
}

.ktk-booking .ktk-configurator__participant,
.ktk-booking .ktk-configurator__split,
.ktk-booking .ktk-configurator__schedule,
.ktk-booking .ktk-configurator__customer,
.ktk-booking .ktk-configurator__addons {
  padding-bottom: 22px;
  border-bottom: 1px solid var(--ktk-line);
}

.ktk-booking .ktk-configurator__phone > div {
  grid-template-columns: minmax(0, 1fr);
}

.ktk-booking .ktk-configurator__phone > div > input {
  grid-column: 1 / -1;
  margin-top: 8px;
}

.ktk-booking .ktk-configurator__addons {
  grid-template-columns: minmax(0, 1fr);
}

.ktk-booking .ktk-configurator__addon {
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 13px;
}

.ktk-booking .ktk-configurator__addon > div:first-child {
  text-align: center;
}

.ktk-booking .ktk-configurator__addon > button,
.ktk-booking .ktk-configurator__addon > .ktk-config-stepper {
  width: auto;
  max-width: 180px;
  justify-self: center;
}

.ktk-booking .ktk-configurator__addon > select,
.ktk-booking .ktk-configurator__addon > .ktk-custom-select {
  width: 100%;
  max-width: none;
  justify-self: stretch;
}

.ktk-booking .ktk-configurator__addon > .ktk-custom-select .ktk-custom-select__options {
  top: auto;
  bottom: calc(100% + 6px);
}

.ktk-booking .ktk-custom-select__trigger,
.ktk-booking .ktk-custom-select__options button {
  font-size: 18px;
  line-height: 1.2;
}

.ktk-booking .ktk-date-picker__trigger,
.ktk-booking .ktk-date-picker__trigger > span {
  font-size: 22px !important;
  line-height: 1.1;
}

.ktk-booking .ktk-configurator__addon .ktk-custom-select__trigger {
  font-size: 16px;
}

.ktk-booking .ktk-configurator__addon .ktk-configurator__addon-variant-quantity .ktk-custom-select__trigger {
  padding: 8px 22px 8px 8px;
  font-size: 15px;
}

.ktk-booking .ktk-configurator__addon .ktk-configurator__addon-variant-quantity .ktk-custom-select__trigger > i {
  right: 7px;
  width: 9px;
}

.ktk-booking .ktk-configurator__addon .ktk-configurator__addon-variant-quantity .ktk-custom-select__options button {
  min-height: 42px;
  padding: 8px;
  font-size: 14px;
}

.ktk-booking .ktk-config-quantity-select .ktk-custom-select__trigger,
.ktk-booking .ktk-config-quantity-select .ktk-custom-select__options button {
  font-size: 22px;
  font-weight: 900;
}

.ktk-booking .ktk-configurator__total {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  font-size: 15px;
  letter-spacing: 0;
}

.ktk-booking .ktk-configurator__total strong {
  font-size: 18px;
  line-height: 1;
}

.ktk-booking__heading {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: start;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--ktk-line);
}

.ktk-booking__heading h2 {
  margin: 0;
  color: var(--ktk-cream);
  font-family: "Oswald", sans-serif;
  font-size: 42px;
  line-height: 0.95;
  text-transform: uppercase;
}

.ktk-booking__heading > span {
  color: var(--ktk-yellow);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.ktk-booking__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 0;
  border-bottom: 1px solid var(--ktk-line);
}

.ktk-booking__row > div:first-child {
  display: grid;
  gap: 5px;
}

.ktk-booking__row strong,
.ktk-booking__addons strong {
  color: var(--ktk-cream);
  font-size: 13px;
}

.ktk-booking__row small,
.ktk-booking__addons small {
  color: rgba(243, 238, 228, 0.5);
  font-size: 11px;
}

.ktk-booking__addons {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 24px 0;
  border: 0;
  border-bottom: 1px solid var(--ktk-line);
}

.ktk-booking__addons legend {
  width: 100%;
  margin: 0 0 14px;
  color: rgba(243, 238, 228, 0.58);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.ktk-booking__addons label {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(243, 238, 228, 0.12);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.025);
  cursor: pointer;
}

.ktk-booking__addons label:has(input:checked) {
  border-color: var(--ktk-pink);
  background: rgba(255, 22, 143, 0.09);
}

.ktk-booking__addons input {
  width: 17px;
  height: 17px;
  margin: 0;
  accent-color: var(--ktk-pink);
}

.ktk-booking__addons label span {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.ktk-booking__total {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 0;
}

.ktk-booking__total span {
  color: rgba(243, 238, 228, 0.58);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.ktk-booking__total strong {
  color: var(--ktk-yellow);
  font-family: "Oswald", sans-serif;
  font-size: 38px;
  line-height: 1;
}

.ktk-app .ktk-booking__cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  width: 100%;
  min-height: 58px;
  padding: 14px 18px;
  background: var(--ktk-pink);
  color: var(--ktk-black);
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-align: center;
  text-decoration: none;
  text-transform: uppercase;
  transition:
    background 180ms ease,
    color 180ms ease,
    transform 180ms ease;
}

.ktk-booking__cta span {
  font-size: 22px;
  transition: transform 180ms ease;
}

.ktk-booking__cta:hover,
.ktk-booking__cta:focus-visible {
  background: var(--ktk-yellow);
  color: var(--ktk-black);
  transform: translateY(-2px);
}

.ktk-booking__cta:hover span,
.ktk-booking__cta:focus-visible span {
  transform: translateX(4px);
}

.ktk-booking__note {
  margin: 14px 0 0;
  color: rgba(243, 238, 228, 0.48);
  font-size: 10px;
  line-height: 1.55;
  text-align: center;
}

@media (max-width: 1100px) {
  .ktk-detail__layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .ktk-booking {
    position: static;
    width: min(620px, 100%);
    margin: 10px auto 0;
  }
}

@media (max-width: 760px) {

  .ktk-detail {
    width: calc(100vw - 32px);
    max-width: calc(100vw - 32px);
    margin-inline: 16px;
    padding: 22px 0 80px;
    overflow-x: clip;
  }

  .ktk-detail__nav > span {
    display: none;
  }

  .ktk-detail__hero {
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    max-width: 100%;
    gap: 28px;
    padding: 42px 0 36px;
  }

  .ktk-detail__intro {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  .ktk-detail__intro > p:last-child {
    display: block;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    margin-right: auto;
    margin-left: auto;
    padding-inline: 8px;
    box-sizing: border-box;
    white-space: normal;
    word-break: normal;
    overflow-wrap: anywhere;
  }

  .ktk-detail__intro h1 {
    font-size: clamp(58px, 19vw, 100px);
  }

  .ktk-detail__intro > p:last-child {
    margin-top: 22px;
    font-size: 15px;
  }

  .ktk-detail__starting-price {
    width: 100%;
    grid-template-columns: auto 1fr auto;
    align-items: end;
    gap: 12px;
    padding: 18px 0 0;
    border-top: 1px solid var(--ktk-line);
    border-left: 0;
  }

  .ktk-detail__starting-price strong {
    font-size: 34px;
  }

  .ktk-detail__starting-price small {
    padding-bottom: 3px;
    text-align: right;
  }

  .ktk-gallery__stage {
    aspect-ratio: 4 / 3;
  }

  .ktk-gallery__stage > span {
    right: 10px;
    bottom: 10px;
  }

  .ktk-gallery__thumbs {
    gap: 6px;
    margin-top: 6px;
  }

  .ktk-product-story {
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
    padding: 54px 0;
  }

  .ktk-product-story h2 {
    font-size: clamp(38px, 13vw, 56px);
  }

  .ktk-product-story > p {
    font-size: 15px;
    line-height: 1.65;
  }

  .ktk-practical-info,
  .ktk-cancellation-policy__items {
    grid-template-columns: minmax(0, 1fr);
  }

  .ktk-practical-info {
    gap: 36px;
  }

  .ktk-booking {
    padding: 22px;
  }
}

@media (max-width: 420px) {
  .ktk-detail {
    width: calc(100vw - 32px);
    max-width: calc(100vw - 32px);
    margin-inline: 16px;
  }

  .ktk-detail__intro h1 {
    font-size: clamp(52px, 18vw, 74px);
  }

  .ktk-detail__starting-price {
    grid-template-columns: 1fr auto;
  }

  .ktk-detail__starting-price > span {
    grid-column: 1 / -1;
  }

  .ktk-booking__heading h2 {
    font-size: 36px;
  }

  .ktk-booking__addons label span,
  .ktk-booking__total {
    align-items: start;
  }
}

.ktk-eyebrow {
  margin: 0 0 12px;
  color: var(--ktk-pink);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.ktk-contact-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.ktk-contact-fields label {
  display: grid;
  gap: 8px;
  min-width: 0;
  color: var(--ktk-cream);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-align: center;
  text-transform: uppercase;
}

.ktk-contact-fields input,
.ktk-contact-fields select {
  width: 100%;
  min-width: 0;
  min-height: 54px;
  padding: 12px 15px;
  border: 1px solid var(--ktk-line);
  border-radius: 0;
  outline: 0;
  background: #090909;
  color: var(--ktk-cream);
  font: inherit;
  font-size: 16px;
  letter-spacing: 0;
  text-align: center;
  text-transform: none;
}

.ktk-contact-fields select,
.ktk-checkout__phone select {
  appearance: none;
  padding-right: 38px;
  background-color: #090909;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='8' viewBox='0 0 14 8' fill='none'%3E%3Cpath d='M1 1L7 7L13 1' stroke='%23FFD43B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 16px center;
  background-size: 12px 7px;
  color-scheme: dark;
  cursor: pointer;
  text-align: center;
  text-align-last: center;
}

.ktk-contact-fields select option,
.ktk-checkout__phone select option {
  background: #090909;
  color: var(--ktk-cream);
}

.ktk-contact-fields input:focus,
.ktk-contact-fields select:focus,
.ktk-contact-fields input[aria-invalid="true"],
.ktk-contact-fields select[aria-invalid="true"] {
  border-color: var(--ktk-pink);
}

.ktk-contact-fields label > small {
  color: #ff76b9;
  font-size: 10px;
  text-transform: none;
}

.ktk-contact-fields .ktk-custom-select__search input {
  min-height: 44px;
  padding: 9px 12px;
  border-color: var(--ktk-pink);
  font-size: 14px;
}

.ktk-contact-fields .ktk-custom-select__trigger,
.ktk-contact-fields .ktk-custom-select__options button {
  font-size: 18px !important;
  font-weight: 800;
}

.ktk-product-contact {
  display: grid;
  padding: 0 0 28px;
  border-bottom: 1px solid var(--ktk-line);
}

.ktk-product-contact .ktk-contact-fields {
  grid-template-columns: 1fr;
  gap: 14px;
}

.ktk-product-contact .ktk-contact-fields input {
  min-height: 48px;
}

.ktk-product-contact .ktk-contact-fields select {
  min-height: 48px;
}

.ktk-order-summary > .ktk-eyebrow {
  text-align: center;
}

.ktk-success__header .ktk-eyebrow {
  margin-bottom: 16px;
}

@media (max-width: 800px) {

  .ktk-contact-fields {
    grid-template-columns: 1fr;
  }
}
`;
