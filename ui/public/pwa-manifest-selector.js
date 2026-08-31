(function selectOmniLodgeManifest() {
  var isNewTransactionApp =
    window.location.hostname === "transaction.omni-lodge.com" ||
    window.location.hostname === "transaction.localhost";
  var manifest = document.createElement("link");

  manifest.rel = "manifest";
  manifest.href = isNewTransactionApp
    ? "/finance/new-transaction/new-transaction.webmanifest"
    : "/manifest.json";
  document.head.appendChild(manifest);

  if (isNewTransactionApp) {
    var appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleTouchIcon) {
      appleTouchIcon.href = "/icons/new-transaction/apple-touch-icon-180.png";
    }
  }
}());
