(function setupNewCounterInstaller() {
  "use strict";

  var productionCompanionOrigin = "https://counter.omni-lodge.com";
  var localCompanionOrigin = window.location.port
    ? "http://counter.localhost:" + window.location.port
    : "http://counter.localhost";
  var redirectOrigin = null;

  if (window.location.hostname === "omni-lodge.com" || window.location.hostname === "www.omni-lodge.com") {
    redirectOrigin = productionCompanionOrigin;
  } else if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    redirectOrigin = localCompanionOrigin;
  }

  if (redirectOrigin) {
    window.location.replace(redirectOrigin + window.location.pathname + window.location.search + window.location.hash);
    return;
  }

  var counterUrl = "/counters?mode=create&pwa=new-counter";
  var installButton = document.getElementById("install-button");
  var installStatus = document.getElementById("install-status");
  var menuStep = document.getElementById("menu-step");
  var deferredPrompt = null;
  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (isStandalone && !document.referrer) {
    window.location.replace(counterUrl);
    return;
  }

  if (isIos && menuStep) {
    menuStep.innerHTML = "Tap the <strong>Share</strong> button in Safari.";
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function registerExistingServiceWorker() {
      navigator.serviceWorker.register("/service-worker.js").catch(function ignoreRegistrationFailure() {
        // The production build provides this worker. Manual installation guidance remains available if it cannot register.
      });
    });
  }

  window.addEventListener("beforeinstallprompt", function captureInstallPrompt(event) {
    event.preventDefault();
    deferredPrompt = event;
    if (installButton) {
      installButton.hidden = false;
    }
    if (installStatus) {
      installStatus.textContent = "This companion app is ready to install.";
    }
  });

  if (installButton) {
    installButton.addEventListener("click", function promptForInstall() {
      if (!deferredPrompt) {
        return;
      }

      installButton.disabled = true;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function handleInstallChoice(choice) {
        if (installStatus) {
          installStatus.textContent = choice.outcome === "accepted"
            ? "Installation accepted. The new icon will appear shortly."
            : "Installation was not completed. You can try again from the browser menu.";
        }
        deferredPrompt = null;
        installButton.hidden = true;
        installButton.disabled = false;
      });
    });
  }

  window.addEventListener("appinstalled", function confirmInstallation() {
    deferredPrompt = null;
    if (installButton) {
      installButton.hidden = true;
    }
    if (installStatus) {
      installStatus.textContent = "New Counter is installed and ready from your home screen.";
    }
  });
}());
