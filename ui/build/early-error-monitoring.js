(function () {
  "use strict";

  var events = [];
  var limit = 10;
  var storageKey = "omnilodge:early-error-buffer:v1";
  var maxStoredBytes = 48000;
  var maxTransportBytes = 48000;
  var transportTimeoutMs = 12000;
  var endpoint = /^(transaction|counter)\.omni-lodge\.com$/i.test(location.hostname)
    ? "https://omni-lodge.com/api/client-errors/batch"
    : "/api/client-errors/batch";
  var retryTimer;
  var retryAt;
  var bootstrapWatchdogTimer;
  var attempts = 0;
  var sending = false;
  var captureDisposed = false;

  var safeGet = function (value, key) {
    try {
      return value && value[key];
    } catch (_) {
      return undefined;
    }
  };

  var utf8Length = function (value) {
    try {
      if (typeof window.TextEncoder === "function") {
        return new window.TextEncoder().encode(value).byteLength;
      }
    } catch (_) {
      // Fall through to the allocation-free counter for older webviews.
    }
    var bytes = 0;
    for (var index = 0; index < value.length; index += 1) {
      var codeUnit = value.charCodeAt(index);
      if (codeUnit <= 0x7f) {
        bytes += 1;
      } else if (codeUnit <= 0x7ff) {
        bytes += 2;
      } else if (
        codeUnit >= 0xd800
        && codeUnit <= 0xdbff
        && index + 1 < value.length
        && value.charCodeAt(index + 1) >= 0xdc00
        && value.charCodeAt(index + 1) <= 0xdfff
      ) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  };
  var safeJson = function (value) {
    try {
      var serialized = JSON.stringify(value);
      return typeof serialized === "string" ? serialized : undefined;
    } catch (_) {
      return undefined;
    }
  };

  var clean = function (value, max) {
    if (typeof value !== "string") return undefined;
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
      .replace(/(\b(?:password|secret|token|authorization|api[_-]?key)\b\s*[:=]\s*)[^\s,;&]+/gi, "$1[redacted]")
      .replace(/([?&][^=&#\s]{1,100}=)[^&#\s)\]]+/g, "$1[redacted]")
      .replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi, "[redacted-iban]")
      .replace(/\b(?:\d[ -]?){20,34}\b/g, "[redacted-bank-account]")
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-number]")
      .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, "[redacted-phone]")
      .replace(/\b(amount|balance|salary|wage|compensation|reimbursement|payout|revenue|price|cost|subtotal|grand[_ -]?total)\s*[:=]\s*(?:PLN|EUR|USD|GBP|z\u0142|\u20ac|\$)?\s*-?\d[\d .,]*/gi, "$1=[redacted]")
      .replace(/(?:\b(?:PLN|EUR|USD|GBP|CHF)\b|z\u0142|\u20ac|\$)\s*-?\d[\d .,]*/gi, "[redacted-amount]")
      .replace(/\b-?\d[\d .,]*\s*(?:PLN|EUR|USD|GBP|CHF|z\u0142)(?![A-Za-z0-9])/gi, "[redacted-amount]")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[uuid]")
      .replace(/\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, "[opaque-id]")
      .slice(0, max);
  };
  var cleanCorrelationId = function (value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) return undefined;
    return value;
  };
  var cleanPathSegment = function (segment) {
    if (!segment) return segment;
    var decoded = segment;
    for (var attempt = 0; attempt < 2; attempt += 1) {
      try {
        var next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch (_) {
        break;
      }
    }
    if (clean(decoded, 2000) !== decoded) return "[redacted]";
    if (/^\d+$/.test(decoded)) return "[numeric-id]";
    if (/^(?=.{20,}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9._~-]+$/.test(decoded)) return "[opaque-id]";
    return segment;
  };
  var cleanUrl = function (value) {
    if (typeof value !== "string") return undefined;
    var withoutQuery = value.split(/[?#]/, 1)[0];
    return withoutQuery.split("/").map(cleanPathSegment).join("/").slice(0, 1000);
  };
  var normalizeStoredEvent = function (value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var allowedTypes = {
      exception: true,
      unhandled_rejection: true,
      resource_error: true
    };
    var context = value.context && typeof value.context === "object" && !Array.isArray(value.context)
      ? value.context
      : {};
    var eventId = cleanCorrelationId(value.eventId);
    if (!eventId) return null;
    var normalized = {
      eventId: eventId,
      type: allowedTypes[value.type] ? value.type : "exception",
      level: value.level === "fatal" ? "fatal" : "error",
      name: clean(value.name, 120) || "EarlyBootError",
      message: clean(value.message, 1000) || "Application startup failed",
      stack: clean(value.stack, 8000),
      occurredAt: clean(value.occurredAt, 40) || new Date().toISOString(),
      release: "web-preboot",
      environment: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        ? "development"
        : "production",
      pageUrl: cleanUrl(value.pageUrl) || cleanUrl(location.pathname) || "/",
      route: cleanUrl(value.route) || cleanUrl(location.pathname) || "/",
      context: {
        earlyBoot: true,
        tag: clean(context.tag, 40),
        source: cleanUrl(context.source),
        pagePath: cleanUrl(context.pagePath) || cleanUrl(location.pathname) || "/",
        line: typeof context.line === "number" ? context.line : undefined,
        column: typeof context.column === "number" ? context.column : undefined
      }
    };
    if (Object.prototype.hasOwnProperty.call(value, "capturedUserId")) {
      normalized.capturedUserId = null;
    }
    return normalized;
  };
  var compactOversizedEvent = function (value) {
    return {
      eventId: cleanCorrelationId(safeGet(value, "eventId"))
        || "early-oversize-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
      capturedUserId: null,
      type: "exception",
      level: safeGet(value, "level") === "fatal" ? "fatal" : "error",
      name: "EarlyMonitoringPayloadTooLarge",
      message: "An early browser diagnostic exceeded the safe transport size and was discarded",
      occurredAt: clean(safeGet(value, "occurredAt"), 40) || new Date().toISOString(),
      release: "web-preboot",
      environment: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        ? "development"
        : "production",
      pageUrl: cleanUrl(location.pathname) || "/",
      route: cleanUrl(location.pathname) || "/",
      context: {
        earlyBoot: true,
        tag: "monitoring_payload_replaced",
        pagePath: cleanUrl(location.pathname) || "/"
      }
    };
  };
  var persist = function () {
    var serialized;
    try {
      if (!events.length) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      serialized = safeJson(events.slice(-limit));
      while ((!serialized || utf8Length(serialized) >= maxStoredBytes) && events.length > 1) {
        var removableIndex = events.findIndex(function (event) {
          return safeGet(event, "level") !== "fatal";
        });
        events.splice(removableIndex >= 0 ? removableIndex : 0, 1);
        serialized = safeJson(events.slice(-limit));
      }
      if ((!serialized || utf8Length(serialized) >= maxStoredBytes) && events.length === 1) {
        events[0] = compactOversizedEvent(events[0]);
        serialized = safeJson(events);
      }
      if (!serialized || utf8Length(serialized) >= maxStoredBytes) {
        events.splice(0, events.length);
        window.localStorage.removeItem(storageKey);
        return;
      }
      window.localStorage.setItem(storageKey, serialized);
    } catch (_) {
      // Storage can be unavailable in private mode. The bounded memory queue stays active.
    }
  };
  var restore = function () {
    try {
      var stored = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(stored)) return;
      stored.slice(-limit).forEach(function (item) {
        var normalized = normalizeStoredEvent(item);
        if (normalized && !events.some(function (event) { return event.eventId === normalized.eventId; })) {
          events.push(normalized);
        }
      });
      // Re-apply the current UTF-8 budget to records written by an older
      // character-counting bootstrap before attempting delivery.
      persist();
    } catch (_) {
      // A corrupt or blocked store must never interfere with application startup.
    }
  };
  var push = function (event) {
    if (events.length >= limit) {
      var removableIndex = events.findIndex(function (candidate) {
        return candidate.level !== "fatal";
      });
      if (removableIndex < 0 && event.level !== "fatal") {
        return;
      }
      events.splice(removableIndex >= 0 ? removableIndex : 0, 1);
    }
    event.eventId = "early-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    event.capturedUserId = null;
    event.release = "web-preboot";
    event.environment = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      ? "development"
      : "production";
    event.pageUrl = cleanUrl(location.pathname) || "/";
    event.route = cleanUrl(location.pathname) || "/";
    events.push(event);
    attempts = 0;
    persist();
    scheduleRetry();
  };
  var scheduleRetry = function (delayOverride) {
    if ((!events.length && typeof delayOverride !== "number") || attempts >= 4) return;
    var delay = typeof delayOverride === "number"
      ? delayOverride
      : Math.min(120000, 15000 * Math.pow(2, attempts));
    var desiredAt = Date.now() + delay;
    if (retryTimer !== undefined && retryAt !== undefined && retryAt <= desiredAt) return;
    clearTimeout(retryTimer);
    retryAt = desiredAt;
    retryTimer = setTimeout(function () {
      retryTimer = undefined;
      retryAt = undefined;
      send();
    }, delay);
  };
  var send = function () {
    if (sending || !events.length || typeof window.fetch !== "function") return;
    var batch = events.slice(0, limit);
    var body = safeJson({ events: batch });
    while ((!body || utf8Length(body) >= maxTransportBytes) && batch.length > 1) {
      batch.pop();
      body = safeJson({ events: batch });
    }
    if ((!body || utf8Length(body) >= maxTransportBytes) && batch.length === 1) {
      var originalId = safeGet(batch[0], "eventId");
      var replacement = compactOversizedEvent(batch[0]);
      for (var eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
        if (safeGet(events[eventIndex], "eventId") === originalId) {
          events[eventIndex] = replacement;
          break;
        }
      }
      batch = [replacement];
      body = safeJson({ events: batch });
      persist();
    }
    if (!body || utf8Length(body) >= maxTransportBytes) {
      var unsendableId = batch.length ? safeGet(batch[0], "eventId") : undefined;
      for (var removeIndex = events.length - 1; removeIndex >= 0; removeIndex -= 1) {
        if (safeGet(events[removeIndex], "eventId") === unsendableId) events.splice(removeIndex, 1);
      }
      persist();
      scheduleRetry();
      return;
    }
    sending = true;
    attempts += 1;
    var controller = typeof window.AbortController === "function"
      ? new window.AbortController()
      : null;
    var timeoutId;
    var request;
    try {
      request = window.fetch(endpoint, {
        method: "POST",
        credentials: "include",
        keepalive: true,
        signal: controller ? controller.signal : undefined,
        headers: {
          "Content-Type": "application/json",
          "X-OmniLodge-Telemetry": "1"
        },
        body: body
      });
    } catch (error) {
      request = Promise.reject(error);
    }
    var timeout = new Promise(function (_resolve, reject) {
      timeoutId = setTimeout(function () {
        try {
          if (controller) controller.abort();
        } catch (_) {
          // The retry path below still releases the sender.
        }
        reject(new Error("Early telemetry delivery timed out"));
      }, transportTimeoutMs);
    });
    Promise.race([request, timeout]).then(function (response) {
      if (response.ok) {
        var confirmed = {};
        batch.forEach(function (event) { confirmed[event.eventId] = true; });
        for (var index = events.length - 1; index >= 0; index -= 1) {
          if (confirmed[events[index].eventId]) events.splice(index, 1);
        }
        attempts = 0;
        persist();
      }
    }).catch(function () {
      // Retain the bounded queue for the application SDK or one later retry.
    }).then(function () {
      clearTimeout(timeoutId);
      sending = false;
      scheduleRetry();
    });
  };
  var onError = function (event) {
    if (captureDisposed) return;
    var target = safeGet(event, "target");
    if (target && target !== window) {
      var resourceUrl = safeGet(target, "currentSrc") || safeGet(target, "src") || safeGet(target, "href");
      var tagName = safeGet(target, "tagName") || "resource";
      push({
        type: "resource_error",
        level: "error",
        name: "EarlyResourceLoadError",
        message: "Failed to load " + clean(String(tagName).toLowerCase(), 40),
        occurredAt: new Date().toISOString(),
        context: {
          earlyBoot: true,
          tag: clean(String(tagName).toLowerCase(), 40),
          source: cleanUrl(resourceUrl),
          pagePath: cleanUrl(location.pathname) || "/"
        }
      });
      return;
    }
    var error = safeGet(event, "error");
    push({
      type: "exception",
      level: "error",
      name: clean(safeGet(error, "name"), 120) || "EarlyWindowError",
      message: clean(safeGet(error, "message") || safeGet(event, "message"), 1000) || "Early application error",
      stack: clean(safeGet(error, "stack"), 8000),
      occurredAt: new Date().toISOString(),
      context: {
        earlyBoot: true,
        source: cleanUrl(safeGet(event, "filename")),
        line: safeGet(event, "lineno") || undefined,
        column: safeGet(event, "colno") || undefined,
        pagePath: cleanUrl(location.pathname) || "/"
      }
    });
  };
  var onUnhandledRejection = function (event) {
    if (captureDisposed) return;
    var reason = safeGet(event, "reason");
    var isError = reason && typeof reason === "object";
    push({
      type: "unhandled_rejection",
      level: "error",
      name: clean(isError && safeGet(reason, "name"), 120) || "EarlyUnhandledRejection",
      message: clean(isError ? safeGet(reason, "message") : reason, 1000) || "Unhandled promise rejection during startup",
      stack: clean(isError && safeGet(reason, "stack"), 8000),
      occurredAt: new Date().toISOString(),
      context: { earlyBoot: true, pagePath: cleanUrl(location.pathname) || "/" }
    });
  };

  restore();
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  window.addEventListener("pagehide", send);
  scheduleRetry(12000);
  var runBootstrapWatchdog = function () {
    bootstrapWatchdogTimer = undefined;
    if (captureDisposed) return;
    var root = document.getElementById("root");
    if (root && (root.firstElementChild || String(root.textContent || "").trim())) return;
    if (
      !root
      || document.visibilityState !== "visible"
      || navigator.onLine === false
      || document.readyState !== "complete"
    ) {
      bootstrapWatchdogTimer = setTimeout(runBootstrapWatchdog, 5000);
      return;
    }
    push({
      type: "exception",
      level: "fatal",
      name: "AppBootstrapTimeout",
      message: "The application root remained empty after startup",
      occurredAt: new Date().toISOString(),
      context: { earlyBoot: true, pagePath: cleanUrl(location.pathname) || "/" }
    });
    send();
  };
  var retryBootstrapWatchdog = function () {
    if (captureDisposed || bootstrapWatchdogTimer) return;
    bootstrapWatchdogTimer = setTimeout(runBootstrapWatchdog, 0);
  };
  window.addEventListener("online", retryBootstrapWatchdog);
  window.addEventListener("load", retryBootstrapWatchdog);
  document.addEventListener("visibilitychange", retryBootstrapWatchdog);
  bootstrapWatchdogTimer = setTimeout(runBootstrapWatchdog, 20000);
  window.__OMNILODGE_EARLY_ERROR_BUFFER__ = {
    events: events,
    dispose: function () {
      captureDisposed = true;
      clearTimeout(retryTimer);
      retryAt = undefined;
      clearTimeout(bootstrapWatchdogTimer);
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("pagehide", send);
      window.removeEventListener("online", retryBootstrapWatchdog);
      window.removeEventListener("load", retryBootstrapWatchdog);
      document.removeEventListener("visibilitychange", retryBootstrapWatchdog);
      // Keep delivering already-buffered events after the full SDK takes over.
      // The persistent copy is removed only after the server confirms the batch.
      send();
    }
  };
})();
