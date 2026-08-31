(function selectOmniLodgeManifest() {
  var params = new URLSearchParams(window.location.search);
  var isNewTransactionApp =
    window.location.pathname === "/finance/transactions" &&
    params.get("pwa") === "new-transaction";
  var manifest = document.createElement("link");

  manifest.rel = "manifest";
  manifest.href = isNewTransactionApp
    ? "/finance/new-transaction/new-transaction.webmanifest"
    : "/manifest.json";
  document.head.appendChild(manifest);
}());
