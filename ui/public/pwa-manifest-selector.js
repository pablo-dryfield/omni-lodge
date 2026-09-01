(function selectOmniLodgeManifest() {
  var isNewTransactionApp =
    window.location.hostname === "transaction.omni-lodge.com" ||
    window.location.hostname === "transaction.localhost";
  var isNewCounterApp =
    window.location.hostname === "counter.omni-lodge.com" ||
    window.location.hostname === "counter.localhost";
  var manifest = document.createElement("link");

  manifest.rel = "manifest";
  manifest.href = isNewTransactionApp
    ? "/finance/new-transaction/new-transaction.webmanifest"
    : isNewCounterApp
      ? "/counters/new-counter/new-counter.webmanifest"
      : "/manifest.json";
  document.head.appendChild(manifest);

  if (isNewTransactionApp || isNewCounterApp) {
    var appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleTouchIcon) {
      appleTouchIcon.href = isNewTransactionApp
        ? "/icons/new-transaction/apple-touch-icon-180.png"
        : "/icons/new-counter/apple-touch-icon-180.png";
    }
  }
}());
