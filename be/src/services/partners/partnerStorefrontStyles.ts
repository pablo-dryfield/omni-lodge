/** Adapters for the original storefront DOM. KTK's selectors are imported
 * verbatim; Food Tour's values follow checkout-page.tsx, CheckoutTourHeader and
 * bistro-theme.css. Partner identity replaces only the website navigation. */
export const partnerStorefrontStyles = String.raw`
.native-select{position:absolute!important;opacity:0!important;width:1px!important;height:1px!important;min-height:0!important;padding:0!important;pointer-events:none!important}
.date-wrap{position:relative}.source-food [hidden]{display:none!important}
.source-food .field input.native-date-input{position:absolute;bottom:0;right:0;width:1px;height:1px;min-height:0;padding:0;opacity:0;pointer-events:none}
.storefront-select{position:relative;min-width:0;width:100%}.storefront-select [hidden]{display:none!important}
.storefront-select .ktk-custom-select__options{z-index:60}.storefront-select .ktk-custom-select__options button{display:block;width:100%;text-align:center}
.storefront-select .ktk-custom-select__search{padding:10px}.storefront-select .ktk-custom-select__search input{width:100%}
[hidden]{display:none!important}.partner-logo{display:block;max-width:min(260px,45vw);max-height:72px;width:auto;height:auto;object-fit:contain}.partner-brand{gap:12px}.masthead:has(.partner-brand[hidden]){justify-content:center}.masthead:has(.powered[hidden]){justify-content:center}.catalog-bar:has(>:only-child){justify-content:center}body[data-stage=configure] #app{outline:none}
body[data-theme=ktk]{--ktk-black:#090909;--ktk-ink:#11100f;--ktk-cream:#f3eee4;--ktk-pink:#ff168f;--ktk-yellow:#ffd43b;--ktk-blue:#7dc9ff;--ktk-line:rgba(243,238,228,.2);--paper:#090909;--surface:#121012;--field:#121012;--ink:#f3eee4;--muted:#f3eee4b3;--border:#f3eee433;--accent:#ff168f;--on-accent:#090909;--highlight:#ffd43b;--heading:Oswald,Arial,sans-serif;--body:Montserrat,Arial,sans-serif;background:radial-gradient(circle at 88% 12%,rgba(255,22,143,.16),transparent 22rem),#090909;color:var(--ktk-cream)}
body[data-theme=ktk] .page{max-width:none;padding:0}body[data-theme=ktk] .masthead,body[data-theme=ktk] .progress,body[data-theme=ktk] .footer{width:min(1440px,calc(100% - 64px));margin-inline:auto}
.ktk-app{font-family:Montserrat,sans-serif;font-size:16px;font-weight:500;line-height:27.2px}.ktk-app button,.ktk-app input,.ktk-app select{font-family:inherit}
.ktk-app .ktk-detail__layout>.ktk-booking{width:100%;margin:0}.ktk-app .ktk-booking form{margin:0}
.ktk-app .ktk-configurator__heading .panel-heading{font-weight:500;letter-spacing:normal;line-height:.92;margin:4px 0 0;padding-bottom:10px}
.ktk-app .ktk-configurator .field{display:grid;gap:8px;padding:0}.ktk-app .ktk-configurator .field>span{font:inherit;letter-spacing:inherit}
.ktk-app .ktk-configurator__fixed-time{border:0;background:none}.ktk-app .ktk-configurator__fixed-time strong{font-weight:800}
.ktk-app .ktk-contact-fields .field>span{font-size:11px;font-weight:900;letter-spacing:.06em}
.ktk-app .ktk-configurator__addons{min-width:0}.ktk-app .ktk-configurator__addon .addon-name{justify-content:center}
.ktk-app .ktk-configurator__addon .addon-unavailable-copy{font-size:11px;font-weight:500;text-align:center;text-transform:none;line-height:1.6;color:#f3eee499}
.ktk-app .ktk-configurator__addon-variants[hidden]{display:none}.ktk-app .ktk-configurator__addon-variants{width:100%}
.ktk-app .ktk-configurator__total{margin:0;padding:0;border:0;letter-spacing:0}.ktk-app .ktk-configurator__total strong{font-family:Montserrat,sans-serif;font-weight:900}
.ktk-app .ktk-booking__cta{border:0;border-radius:0;box-shadow:none;cursor:pointer}.ktk-app .ktk-booking__cta>svg{width:22px;height:22px}
.ktk-app .ktk-booking__cta:disabled{opacity:.6;cursor:wait;transform:none}.ktk-app .ktk-detail__nav svg{width:20px;height:20px;color:var(--ktk-pink)}
.ktk-app .ktk-booking .discount-details{margin:0;font-size:11px;text-transform:none}.ktk-app .add-experience{margin:0;text-transform:none;color:#f3eee4b3;font-size:11px}
.ktk-app .ktk-gallery__stage img{display:block;width:100%;height:100%;object-fit:cover}.ktk-app .ktk-gallery__thumbs button{padding:0;cursor:pointer}
.ktk-app .ktk-practical-info__section p{line-height:1.7}.ktk-app .ktk-practical-info__section a{display:inline-flex;gap:8px;color:var(--ktk-yellow);font-size:12px;font-weight:800;margin-top:12px}
.ktk-app .ktk-practical-info__section .meeting-photo{border-radius:0;height:auto;max-height:230px}.ktk-app .ktk-product-story>p{white-space:pre-line}
.ktk-app .ktk-date-picker__trigger{position:relative}.ktk-app .ktk-date-picker__trigger svg{display:none}
.ktk-app .ktk-date-picker__trigger,.ktk-app .ktk-date-picker__trigger>span{color:#fff;font-weight:800}
.ktk-app .ktk-configurator__schedule .field>span{color:#fff}
.ktk-app .ktk-product-contact input{color:#4e4e4e;background:#fff;padding:2px;border:1px solid #bbb;line-height:27.2px}
.ktk-app .ktk-configurator__addon-info-button{color:#fff;font:800 12px/27.2px Montserrat,sans-serif}
.ktk-app .ktk-booking__cta{color:#f3eee4;font:500 16px/27.2px Montserrat,sans-serif;letter-spacing:.06em;border:2px outset #000;min-height:58px}
.ktk-app .ktk-date-picker .calendar{background:#121012;border-radius:0;border-color:var(--ktk-line);font-family:Montserrat,sans-serif;width:300px;max-width:min(300px,calc(100vw - 76px))}
.ktk-app .calendar-day{border-radius:0;font-size:13px}.ktk-app .calendar-day.selected{background:var(--ktk-pink);color:#090909}.ktk-app .calendar-title{font-size:14px}.ktk-app .calendar-weekday{font-size:10px}
.ktk-app .calendar button{font-family:inherit}.ktk-app .calendar-header>button{background:transparent;color:var(--ktk-cream)}
/* Food Tour checkout: exact field order, card geometry and separate summary. */
body[data-theme=food] .page{max-width:1216px;padding-inline:32px}body[data-theme=food]{--paper:#fff6e8;--surface:#f3e3c5;--field:#fffcf5;--ink:#2b1b14;--muted:#6b4b37;--border:#d6bd98;--accent:#b43c25;--on-accent:#fff;--highlight:#a46b24;--heading:Fraunces,Georgia,serif;--body:Manrope,Arial,sans-serif;background:#fff6e8;color:#2b1b14;font-family:Manrope,sans-serif}
.source-food{padding:40px 0 80px;color:#2b1b14;line-height:24px}.source-food button,.source-food input,.source-food textarea{font-family:Manrope,sans-serif}
.food-tour-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:20px;background:#fffcf5;border:1px solid #d1b482;border-radius:16.8px;padding:28px 32px;box-shadow:4px 5px 0 #dda34a33;margin-bottom:24px}
.food-tour-heading{text-align:center}.food-tour-heading h1{font-family:Fraunces,Georgia,serif;font-size:48px;font-weight:600;line-height:1.1;letter-spacing:-.035em;margin:0}.food-tour-heading p{font-size:16px;line-height:24px;font-weight:600;margin:8px 0 0}
.food-tour-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;min-width:448px;margin:0;text-align:center}.food-tour-facts[data-facts="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}.food-tour-facts>div{border:1px solid #b18a5247;background:#f3e3c5;border-radius:12.8px;padding:12px}.food-tour-facts dt{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.food-tour-facts dd{font-size:14px;font-weight:700;margin:4px 0 0}
.food-about{border:1px solid #2b1b141a;border-radius:16px;padding:0 16px;background:#fff6e8;margin-bottom:20px;text-align:center}.food-about>summary{font-size:14px;list-style:none;cursor:pointer;padding:12px;font-weight:600}.food-about>summary:after{content:' \2304'}.food-about>div{padding:8px 12px 20px;font-size:14px;line-height:28px}.food-about .experience-photo{max-width:560px;max-height:260px;margin:0 auto 20px;display:block;border-radius:16px}.food-about .experience-summary{font-size:14px;color:#6b4b37}.food-about .content-details{text-align:left}.food-about .details-content{font-size:14px}
.food-experience-content{text-align:left;overflow-wrap:anywhere}.food-experience-content>section+section{margin-top:24px}.food-experience-content h3{text-align:center;font-size:14px;font-weight:800;margin-bottom:8px}.food-experience-summary{text-align:center;margin-bottom:20px}.food-experience-content a{font-weight:700;text-decoration:underline;display:inline-flex;align-items:center;min-height:44px}.multiline-copy{white-space:pre-line}
.food-checkout-layout{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:20px;align-items:start}
.food-checkout-form{display:grid;gap:20px;min-width:0;border:1px solid #d1b482;border-radius:22.4px;background:#f3e3c5;padding:28px;box-shadow:4px 5px 0 #dda34a33}
.food-checkout-form>[id^=addons-]:empty{display:none}
.food-section-card{border:1px solid #ffffff59;border-radius:20px;background:#ffffff33;padding:20px;box-shadow:inset 0 1px 0 #ffffff40;min-width:0}
.food-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.8fr);gap:20px;min-width:0}.food-fields>.full-width{grid-column:1/-1}
.source-food .field{position:relative;display:block;padding-top:12px;min-width:0}.source-food .field>span{pointer-events:none;position:absolute;left:50%;top:0;z-index:1;transform:translateX(-50%);margin:0;white-space:nowrap;border-radius:999px;background:#2b1b14;padding:4px 12px;color:#fff;font-size:11.52px;font-weight:600;line-height:1;letter-spacing:.06em;box-shadow:0 6px 16px #2b1b142e}
.source-food .field input,.source-food .field select,.source-food .date-trigger,.source-food .quantity-stepper,.source-food .country-trigger{height:56px;min-height:56px;width:100%;border:1px solid #2b1b1433;border-radius:16.8px;background:#fffcf5;color:#2b1b14;font-size:16px;line-height:24px;font-weight:500;box-shadow:0 10px 24px #2b1b1414;text-align:center;padding:0 16px;outline:none}
.source-food .field input:focus,.source-food .date-trigger:focus-visible,.source-food .country-trigger:focus-visible{border-color:#2b1b14;background:#fff;outline:4px solid #2b1b141a;outline-offset:0}
.source-food .field input::placeholder{color:#806b58;opacity:1}.source-food .date-trigger{display:flex;align-items:center;justify-content:center;position:relative;padding-right:48px}.source-food .date-trigger svg{position:absolute;right:20px;width:20px;height:20px;color:#2b1b14;order:1}
.source-food .quantity-stepper{display:flex;padding:0;overflow:hidden}.source-food .quantity-stepper button{height:100%;width:56px;color:#2b1b14;font-size:24px;box-shadow:none;flex-shrink:0}.source-food .quantity-stepper input{height:100%;min-height:0;padding:0;border:0;border-inline:1px solid #2b1b141a;box-shadow:none;background:transparent;border-radius:0;font-weight:700}
.food-guest-help{margin:8px auto 0;max-width:320px;text-align:center;font-size:11.2px;line-height:16px;font-weight:500;color:#6b4b37}
.source-food .country-trigger{position:relative;display:flex;justify-content:center;align-items:center;padding-right:36px;font-weight:600;cursor:pointer}.source-food .country-trigger i{position:absolute;right:18px;width:9px;height:9px;border-right:1.5px solid;border-bottom:1.5px solid;transform:rotate(45deg);margin-top:-4px}
.source-food .country-trigger.is-placeholder{font-weight:500;color:#806b58}
.source-food .storefront-select .ktk-custom-select__options{top:calc(100% + 6px);border:1px solid #2b1b1433;border-radius:12px;background:#fffcf5;box-shadow:0 18px 40px #2b1b1426;color:#2b1b14}
.source-food .ktk-custom-select__options button{background:transparent;color:#2b1b14;font:600 14px Manrope,sans-serif;padding:11px}.source-food .ktk-custom-select__options button:hover,.source-food .ktk-custom-select__options button.is-selected{background:#f3e3c5}.source-food .ktk-custom-select__search input{min-height:40px;border:1px solid #2b1b1433;border-radius:8px;background:#fff;text-align:left;padding:8px 12px;font-size:14px}
.source-food .ktk-custom-select__options button.food-country-option{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:8px;align-items:center;border-radius:12px;min-height:44px;padding:8px 12px;text-align:left}.food-country-option>span:last-child{color:#6b4b37;font-weight:600}
.food-notes{text-align:center;padding:16px}.food-notes>.notes-toggle{display:inline-flex;flex-direction:column;justify-content:center;align-items:center;min-height:56px;border-radius:999px;padding:12px 24px;background:#2b1b14;color:#fff;font-size:14px;font-weight:600;line-height:17.5px;box-shadow:0 10px 24px #2b1b1429}.notes-toggle small{font-size:12px;font-weight:500;line-height:15px;margin-top:2px;color:#ffffffb3}
.food-notes p{margin:12px auto 0;max-width:576px;font-size:12px;font-weight:500;line-height:20px;color:#60452f}.food-notes textarea{display:block;width:100%;border:1px solid #2b1b1433;border-radius:16.8px;background:#fffcf5;padding:20px 16px;font-size:16px;line-height:24px;text-align:center;resize:vertical;color:#2b1b14}.food-notes textarea[hidden]{display:none}
.food-booking-summary{position:sticky;top:28px;border:1px solid #815e32;border-radius:19.2px;background:#2b1b14;color:#fff6e8;padding:24px;box-shadow:4px 5px 0 #dda34a3d}
.food-summary-heading{padding-bottom:16px;border-bottom:1px solid #dda34a4d;text-align:center}.food-booking-summary .panel-heading{font:700 18px/22.5px Manrope,sans-serif;letter-spacing:.16em;text-transform:uppercase;text-align:center;padding:0;margin:0;color:#fff6e8}
.food-summary-rows{margin:20px 0 0}.food-summary-row{display:flex;justify-content:space-between;gap:16px;font-size:14px;line-height:20px}.food-summary-row+.food-summary-row{margin-top:12px}.food-summary-row>dt{color:#dfccb1}.food-summary-row>dd{text-align:right;font-weight:600;color:#fff6e8;margin:0}.food-summary-total{display:flex;justify-content:space-between;align-items:center;border:1px solid #815e32;border-radius:14.4px;background:#fff6e8;color:#2b1b14;padding:16px;margin-top:20px;font-size:16px;line-height:24px}.food-summary-total>span{font-size:14px;font-weight:600;line-height:20px}.food-summary-total strong{font-size:20px;font-weight:600;line-height:28px}
.food-booking-summary .food-payment-button{display:flex;align-items:center;justify-content:center;width:100%;margin-top:20px;min-height:56px;border:1px solid #fff6e833;border-radius:12px;background:#b43c25;color:#fff;padding:16px 32px;box-shadow:0 3px 0 #8f2d1b,0 7px 18px #b43c2526;font-size:16px;line-height:24px;font-weight:700;cursor:pointer}
.food-payment-state{margin-top:20px}
.food-booking-summary .food-payment-button:hover{background:#8f2d1b}.food-booking-summary .food-payment-button:disabled{opacity:.6;cursor:wait}.food-booking-summary .discount-details{margin-top:20px;color:#dfccb1}.food-booking-summary .discount-details input{margin-top:14px;width:100%;border:1px solid #815e32;border-radius:10px;background:#fffcf5;color:#2b1b14;padding:12px;text-align:center}
.source-food .add-experience{margin-top:16px;font-size:12px;color:#6b4b37}.source-food .food-extra-departure{grid-column:1/-1}.source-food .food-extra-departure .field-grid{grid-template-columns:1fr}
@media(max-width:1279px){.food-tour-header,.food-about,.food-checkout-layout{max-width:640px;margin-inline:auto}.food-checkout-layout{grid-template-columns:1fr}.food-tour-header{grid-template-columns:1fr;padding:20px 24px}.food-tour-heading h1{font-size:36px}.food-tour-facts{min-width:0}.food-booking-summary{position:static}.food-tour-facts{width:100%}.source-food{padding-top:40px}}
@media(max-width:760px){body[data-theme=ktk] .masthead,body[data-theme=ktk] .progress,body[data-theme=ktk] .footer{width:calc(100% - 32px)}.ktk-app .ktk-detail{margin:0 16px;width:calc(100% - 32px);max-width:calc(100% - 32px)}.ktk-app .ktk-detail__layout>.ktk-booking{margin-top:10px}.ktk-app .ktk-detail__nav{padding-bottom:16px}}
@media(max-width:639px){body[data-theme=food] .page{padding-inline:10px}.source-food{padding:20px 0 48px}.food-tour-header{padding:20px 16px;border-radius:16.8px;gap:20px;margin-bottom:20px}.food-tour-heading h1{font-size:32px}.food-tour-heading p{font-size:14px}.food-tour-facts{gap:6px}.food-tour-facts>div{border-radius:12px;padding:10px 8px}.food-tour-facts dt{font-size:10.4px}.food-tour-facts dd{font-size:11.52px}.food-checkout-layout{gap:16px}.food-checkout-form{padding:12px;border-radius:18.4px;gap:16px}.food-section-card{padding:12px;border-radius:16px}.food-fields{grid-template-columns:1fr;gap:20px}.food-fields>.full-width{grid-column:auto}.source-food .field>span{font-size:9.92px;padding:4px 10px}.source-food .field input,.source-food .date-trigger,.source-food .quantity-stepper,.source-food .country-trigger{height:52px;min-height:52px;border-radius:15.2px;font-size:14px;padding-inline:12px}.source-food .date-trigger{padding-right:48px}.source-food .quantity-stepper{padding:0}.source-food .quantity-stepper input{border-radius:0}.source-food .quantity-stepper button{width:48px}.food-booking-summary{padding:20px}.food-notes{padding:16px}.food-about{padding-inline:16px}.food-about>div{padding-inline:0}.food-tour-facts{min-width:0}.food-guest-help{font-size:11.2px}.source-food .field input,.source-food .country-trigger{font-size:16px}}
/* Keep content centred in the whole control, independently of trailing icons.
 * These deliberate alignment fixes apply after the storefront breakpoints. */
.source-food .date-trigger{padding-inline:48px}
.source-food .country-trigger{padding-inline:40px}
.source-food .country-trigger>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.source-food .food-country-option>span{text-align:center}
.ktk-app .ktk-booking .ktk-configurator__addon .ktk-configurator__addon-variant-quantity .ktk-custom-select__trigger{padding-inline:10px}
.ktk-app .ktk-booking .ktk-configurator__addon .ktk-configurator__addon-variant-quantity .ktk-custom-select__trigger>i{right:3px;width:7px}
.ktk-app .ktk-booking__cta{position:relative;padding-inline:44px}
.ktk-app .ktk-booking__cta>span{position:absolute;right:18px;top:50%;transform:translateY(-50%)}
.ktk-app .ktk-booking__cta:hover>span,.ktk-app .ktk-booking__cta:focus-visible>span{transform:translate(4px,-50%)}
.food-summary-row,.summary-row{align-items:center}
.review-item{align-items:center}
.review-info,.review-contact{text-align:center}
.line-heading{position:relative;justify-content:center;padding-inline:32px;text-align:center}
.line-heading>.icon-button{position:absolute;right:0;top:50%;transform:translateY(-50%)}
.card-body{text-align:center}.card-facts{justify-content:center}
.ktk-app .ktk-detail__starting-price,.ktk-app .ktk-practical-info__section{text-align:center}
.ktk-app .ktk-practical-info__section .meeting-photo{display:block;margin-inline:auto}
.ktk-app .ktk-practical-info__section>a{justify-self:center}
.food-experience-content section>a{display:flex;width:fit-content;margin-inline:auto;justify-content:center;text-align:center}
.ktk-app .ktk-detail__nav{flex-direction:column;justify-content:center;gap:10px;text-align:center}
.source-food>.back-row{justify-content:center}
.back-link,.ktk-app .ktk-back.back-link{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding-inline:0}
.back-link>svg{position:static;transform:none;flex-shrink:0}
.ktk-app .ktk-booking .ktk-configurator__total{align-items:center}
.ktk-app .ktk-booking .ktk-configurator__total>span,.ktk-app .ktk-booking .ktk-configurator__total>strong{line-height:1.25}
/* The activity chooser belongs to the same dark storefront experience. */
body[data-theme=catalog]{--paper:#090909;--surface:#151115;--field:#121012;--ink:#f3eee4;--muted:#b9b2b7;--border:#f3eee433;--accent:#ff168f;--on-accent:#090909;--highlight:#ffd43b;--heading:Oswald,Arial,sans-serif;--body:Montserrat,Arial,sans-serif;--radius:5px;color-scheme:dark;background:radial-gradient(ellipse at 90% 8%,#ff168f14,transparent 38rem),#090909;color:#f3eee4}
body[data-theme=catalog] .intro{max-width:850px;margin-block:38px 44px}
body[data-theme=catalog] .intro h1{font-family:Oswald,Arial,sans-serif;font-size:clamp(44px,6vw,78px);font-weight:600;letter-spacing:-.035em;line-height:1.05;text-transform:uppercase;text-wrap:balance}
body[data-theme=catalog] .intro .eyebrow{color:#ff168f}
body[data-theme=catalog] .catalog-bar>.pill{border-color:#f3eee433;background:#ffffff05}
body[data-theme=catalog] .activity-card{--card-accent:#ff168f;--card-wash:#ff168f14;--card-cta:#ff168f;--card-cta-ink:#090909;border-color:#f3eee42e;background:radial-gradient(circle at 100% 0,var(--card-wash),transparent 65%),#131013;box-shadow:0 16px 50px #0003;transition:border-color .18s ease,box-shadow .18s ease}
body[data-theme=catalog] .activity-card[data-theme=food]{--card-accent:#dda34a;--card-wash:#dda34a16;--card-cta:#b43c25;--card-cta-ink:#fff6e8;border-color:#815e32;background:radial-gradient(circle at 100% 0,var(--card-wash),transparent 70%),#21140f;border-radius:20px}
body[data-theme=catalog] .activity-card:hover{border-color:var(--card-accent);box-shadow:0 18px 50px #0006}
body[data-theme=catalog] .card-media{background:#151115;border-bottom:1px solid #f3eee41a}
body[data-theme=catalog] .card-media:after{content:'';position:absolute;inset:65% 0 0;background:linear-gradient(transparent,#09090966);pointer-events:none}
body[data-theme=catalog] .ribbon{background:#131013ed;border:1px solid var(--card-accent);color:#f3eee4;z-index:1}
body[data-theme=catalog] .card-category{color:var(--card-accent)}
body[data-theme=catalog] .card-title{font-family:Oswald,Arial,sans-serif;font-size:34px;font-weight:600;text-transform:uppercase;letter-spacing:-.015em;color:#f3eee4}
body[data-theme=catalog] .activity-card[data-theme=food] .card-title{font-family:Fraunces,Georgia,serif;font-weight:600;text-transform:none}
body[data-theme=catalog] .card-description,body[data-theme=catalog] .card-facts{color:#c0b7bd}
body[data-theme=catalog] .activity-card[data-theme=food] .card-description,body[data-theme=catalog] .activity-card[data-theme=food] .card-facts{color:#dfccb1}
body[data-theme=catalog] .card-facts svg{color:var(--card-accent)}
body[data-theme=catalog] .card-bottom{border-color:#f3eee426}
body[data-theme=catalog] .from-price strong{color:#ffd43b}
body[data-theme=catalog] .card-bottom .button{background:var(--card-cta);color:var(--card-cta-ink);border-radius:2px;font-weight:800}
body[data-theme=catalog] .activity-card[data-theme=food] .card-bottom .button{border-radius:10px;box-shadow:0 3px 0 #8f2d1b}
body[data-theme=catalog] .footer{border-color:#f3eee426}
@media(max-width:480px){body[data-theme=catalog] .intro{margin-block:24px 30px}body[data-theme=catalog] .intro h1{font-size:46px}body[data-theme=catalog] .card-title{font-size:31px}}
.ktk-app .ktk-detail__starting-price{grid-template-columns:max-content max-content;justify-content:center;align-items:end;gap:4px 10px;text-align:left}
.ktk-app .ktk-detail__starting-price>span{grid-column:1/-1;text-align:center}
.ktk-app .ktk-detail__starting-price>strong{grid-column:1;grid-row:2}
.ktk-app .ktk-detail__starting-price>small{grid-column:2;grid-row:2;align-self:end;padding-bottom:3px;line-height:1.2;text-align:left}
`;
