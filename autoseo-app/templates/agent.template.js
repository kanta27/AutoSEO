/* AutoSEO runtime agent — loaded on the customer's site via:
     <script async src="https://api.autoseo.live/v1/agent.js?key=auto_..."></script>
   On every page load it fetches /v1/fixes for this URL and patches title /
   description / Open Graph / JSON-LD / TL;DR into the DOM. Failures are silent
   so the host page is never broken. */
(function () {
  "use strict";
  var KEY = /*__AUTOSEO_KEY__*/ null;
  var ENDPOINT = /*__AUTOSEO_ENDPOINT__*/ "";
  if (!KEY || !ENDPOINT) return;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function setMeta(selector, identityAttr, identityValue, content) {
    var head = document.head;
    var el = head.querySelector(selector);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(identityAttr, identityValue);
      head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  function apply(fixes) {
    if (!fixes || !document.head) return;
    var head = document.head;

    if (fixes.title) {
      var t = head.querySelector("title");
      if (!t) {
        t = document.createElement("title");
        head.appendChild(t);
      }
      t.textContent = fixes.title;
    }

    if (fixes.description) {
      setMeta('meta[name="description"]', "name", "description", fixes.description);
    }

    if (fixes.og) {
      Object.keys(fixes.og).forEach(function (p) {
        var key = "og:" + p;
        setMeta('meta[property="' + key + '"]', "property", key, fixes.og[p]);
      });
    }

    if (fixes.schema && !head.querySelector('script[type="application/ld+json"][data-autoseo]')) {
      var s = document.createElement("script");
      s.type = "application/ld+json";
      s.setAttribute("data-autoseo", "1");
      s.textContent = typeof fixes.schema === "string" ? fixes.schema : JSON.stringify(fixes.schema);
      head.appendChild(s);
    }

    if (fixes.tldr && !document.querySelector('[data-autoseo="tldr"]')) {
      var h1 = document.body && document.body.querySelector("h1");
      if (h1) {
        var p = document.createElement("p");
        p.setAttribute("data-autoseo", "tldr");
        p.innerHTML = "<b>In short:</b> " + escapeHtml(fixes.tldr);
        h1.parentNode.insertBefore(p, h1.nextSibling);
      }
    }
  }

  function fetchAndApply() {
    var url =
      ENDPOINT +
      "/v1/fixes?key=" +
      encodeURIComponent(KEY) +
      "&url=" +
      encodeURIComponent(location.href);
    fetch(url, { mode: "cors", credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data && data.fixes) apply(data.fixes); })
      .catch(function () { /* fail silently — never break the host page */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchAndApply);
  } else {
    fetchAndApply();
  }
})();
