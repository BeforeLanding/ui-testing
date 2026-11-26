// ui-probe.js — injected into every page (template from the ui-testing skill).
//
// The crawler (inventory.crawl.ts) and the test fixture (fixtures.ts) both load
// this file, so an element gets the SAME key in the inventory and in the tests.
//
//   window.__uiProbe.enumerate()  -> records for every visible interactive element
//   window.__uiProbe.report()     -> send not-yet-sent records to window.__uiSeen
//   window.__uiProbe.mark(key)    -> tag the element with that key (crawler clicks it)
//   window.__uiProbe.revealers(mode) -> keys of controls worth clicking to reveal UI
//
// Every user interaction (click, typing, change, activation keys) on an element
// is sent to window.__uiHit(record). A key looks like
//   /items/:id | form "Add item" | button "Save"
// i.e. route | region | role "accessible name". data-testid wins over the name.
// Controls in header/nav/footer get route "*": one control, not one per page.
//
// Data-driven lists: set window.__uiCollections (from ui-coverage.json →
// "collections", CSS selectors of repeated items such as "#items > li"). Inside
// such an item, links and role-less clickables are keyed "{item}" (one test on one
// row covers the row link instead of leaving 40 "untested" rows); buttons and
// fields keep their label, so "Mark read" and "Mark unread" stay two controls.
(() => {
  if (window.__uiProbe) return;
  const setTimeoutNative = window.setTimeout.bind(window); // survives page.clock.install()
  const clearTimeoutNative = window.clearTimeout.bind(window);

  const SEL = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[contenteditable='']", "[contenteditable=true]", "[onclick]",
    ...["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox",
      "menuitemradio", "option", "combobox", "slider", "spinbutton", "textbox", "searchbox",
      "treeitem", "gridcell"].map((r) => `[role=${r}]`),
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const LANDMARK = { HEADER: "header", NAV: "nav", MAIN: "main", ASIDE: "aside", FOOTER: "footer", FORM: "form" };
  const REGION_ROLES = new Set(["navigation", "banner", "main", "complementary", "contentinfo", "form", "region",
    "toolbar", "menu", "menubar", "tablist", "listbox", "grid", "table", "search", "tabpanel"]);

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const clip = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const tidy = (s, n) => clip(norm(s).replace(/\d+/g, "#"), n); // counts like "Inbox (3)" stay stable
  const stableId = (id) => id && !/\d{3,}|[:«»]|^(radix|headlessui|mui|react|rc|chakra)-/i.test(id);

  function routeOf() {
    const seg = (p) => p.split("/").map((s) => (/^\d+$/.test(s) || /^[0-9a-f]{8,}(-[0-9a-f]{4,})*$/i.test(s) ? ":id" : s)).join("/");
    let r = seg(location.pathname.replace(/\/+$/, "")) || "/";
    if (location.hash.startsWith("#/")) r += "#" + seg(location.hash.slice(1).split("?")[0]);
    return r;
  }

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(/\s+/)[0];
    const t = el.tagName;
    if (t === "A") return "link";
    if (t === "BUTTON" || t === "SUMMARY") return "button";
    if (t === "SELECT") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (t === "TEXTAREA" || el.isContentEditable) return "textbox";
    if (t === "INPUT") {
      const map = { checkbox: "checkbox", radio: "radio", range: "slider", number: "spinbutton", search: "searchbox",
        submit: "button", button: "button", reset: "button", image: "button", file: "button", color: "button" };
      return map[(el.type || "text").toLowerCase()] || "textbox";
    }
    if (el.matches("[tabindex]")) return "focusable";
    return "clickable"; // pointer cursor or onclick, but no semantics: also an a11y smell
  }

  function textOf(el) {
    return norm(el.innerText ?? el.textContent);
  }

  function nameOf(el) {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const s = norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "));
      if (s) return s;
    }
    const aria = norm(el.getAttribute("aria-label"));
    if (aria) return aria;
    if (el.labels && el.labels.length) {
      const s = norm([...el.labels].map((l) => l.textContent).join(" "));
      if (s) return s;
    }
    if (el.tagName === "INPUT" && /^(submit|button|reset)$/.test(el.type) && el.value) return norm(el.value);
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      return norm(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || el.id);
    }
    const txt = textOf(el);
    if (txt) return txt;
    const inner = el.querySelector("img[alt], [aria-label], [title]");
    return norm(el.getAttribute("title") || inner?.getAttribute("alt") || inner?.getAttribute("aria-label")
      || inner?.getAttribute("title") || el.id || "");
  }

  function regionOf(el) {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const role = a.getAttribute("role");
      if (a.tagName === "DIALOG" || role === "dialog" || role === "alertdialog") {
        const label = a.getAttribute("aria-label") || (a.getAttribute("aria-labelledby") &&
          document.getElementById(a.getAttribute("aria-labelledby"))?.textContent) || a.querySelector("h1,h2,h3")?.textContent;
        return `dialog "${tidy(label, 40)}"`;
      }
      if (a.dataset && a.dataset.testid) return `[${tidy(a.dataset.testid, 40)}]`;
      if (stableId(a.id)) return `#${a.id}`;
      const label = a.getAttribute("aria-label");
      if (label && (role || LANDMARK[a.tagName] || a.tagName === "SECTION")) {
        return `${role || LANDMARK[a.tagName] || "section"} "${tidy(label, 40)}"`;
      }
      if (role && REGION_ROLES.has(role)) return role;
      if (LANDMARK[a.tagName]) return LANDMARK[a.tagName];
    }
    return "page";
  }

  // Inside a data-driven row, links and plain clickables are named by the row's
  // data ("Refactoring", "Clean Code") — one control. Buttons and fields keep
  // their label ("Mark read" ≠ "Mark unread"): each is a control to test.
  const DATA_ROLES = /^(link|clickable|focusable|option|treeitem|gridcell|row|listitem)$/;
  function collectionOf(el, role, name) {
    for (const sel of window.__uiCollections || []) {
      let item;
      try { item = el.closest(sel); } catch { continue; }
      if (item) return { sel, name: DATA_ROLES.test(role) ? "{item}" : name };
    }
    return null;
  }

  function disabledOf(el) {
    return !!(el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("fieldset:disabled"));
  }

  function isVisible(el) {
    if (el.closest("[inert], [aria-hidden=true]")) return false;
    const closed = el.parentElement?.closest("details:not([open])");
    if (closed && !(el.tagName === "SUMMARY" && el.parentElement === closed)) return false;
    const shown = (n) => {
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      if (n.checkVisibility) return n.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      const cs = getComputedStyle(n);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };
    if (shown(el)) return true;
    // Visually hidden checkbox/radio styled through its label is still usable.
    return !!(el.labels && [...el.labels].some(shown));
  }

  // Elements that look clickable (pointer cursor starts here) but carry no
  // interactive semantics: React/Vue click handlers on <div>s.
  function clickables() {
    const out = [];
    for (const el of document.body ? document.body.querySelectorAll("*") : []) {
      if (el.tagName === "LABEL" || el.matches(SEL) || el.closest(SEL) !== null) continue;
      if (getComputedStyle(el).cursor !== "pointer") continue;
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") continue;
      if (el.querySelector(SEL)) continue; // a card wrapping a real link/button: the inner control counts
      out.push(el);
    }
    return out;
  }

  function describe(el) {
    const role = roleOf(el);
    const region = regionOf(el);
    // Site chrome (header, nav, footer) is the same control on every page: count it once.
    const route = /^(header|footer|nav|banner|navigation|contentinfo)\b/.test(region) ? "*" : routeOf();
    const rawName = nameOf(el);
    const testid = el.getAttribute("data-testid");
    const coll = collectionOf(el, role, rawName);
    const name = tidy(coll ? coll.name : rawName) || "(no name)";
    const ident = testid && !coll ? `[data-testid=${tidy(testid, 60)}]` : `${role} "${name}"`;
    const key = `${route} | ${region}${coll ? ` | ${coll.sel}` : ""} | ${ident}`;
    return { key, route, region, role, name, testid: testid || undefined, collection: coll?.sel,
      disabled: disabledOf(el), semantic: role !== "clickable" };
  }

  function controls() {
    const set = new Set(document.querySelectorAll(SEL));
    for (const el of clickables()) set.add(el);
    return [...set].filter(isVisible);
  }

  function enumerate() {
    const seen = new Map();
    for (const el of controls()) {
      const rec = describe(el);
      const prev = seen.get(rec.key);
      if (!prev || (prev.disabled && !rec.disabled)) seen.set(rec.key, rec); // enabled beats disabled
    }
    return [...seen.values()];
  }

  // ---- reporting to the Node side (bindings installed by fixtures.ts) ----
  const sentSeen = new Set();
  const sentHits = new Set();
  function report() {
    if (typeof window.__uiSeen !== "function" || !document.body) return Promise.resolve();
    const fresh = enumerate().filter((r) => !sentSeen.has(r.key + "|" + r.disabled));
    fresh.forEach((r) => sentSeen.add(r.key + "|" + r.disabled));
    return fresh.length ? Promise.resolve(window.__uiSeen(fresh)).catch(() => {}) : Promise.resolve();
  }
  let timer = null;
  function schedule() {
    if (timer) clearTimeoutNative(timer);
    timer = setTimeoutNative(() => { timer = null; report(); }, 200);
  }

  const ACTIVATION_KEYS = new Set(["Enter", " ", "Spacebar", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Home", "End", "PageUp", "PageDown"]);
  function onInteract(e) {
    if (e.type === "keydown" && !ACTIVATION_KEYS.has(e.key)) return;
    let t = e.composedPath ? e.composedPath()[0] : e.target;
    if (!(t instanceof Element)) t = t && t.parentElement;
    if (!t || t === document.body || t === document.documentElement) return;
    let el = t.closest(SEL);
    if (!el) for (let a = t; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).cursor === "pointer" && !(a.parentElement && getComputedStyle(a.parentElement).cursor === "pointer")) { el = a; break; }
    }
    if (!el) return;
    report(); // capture the state the user acted on, before the app reacts
    const rec = describe(el);
    if (sentHits.has(rec.key) || typeof window.__uiHit !== "function") return;
    sentHits.add(rec.key);
    Promise.resolve(window.__uiHit({ ...rec, event: e.type })).catch(() => {});
  }
  for (const type of ["click", "input", "change", "keydown", "submit"]) {
    window.addEventListener(type, onInteract, true);
  }

  function start() {
    new MutationObserver(schedule).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "disabled", "aria-expanded", "aria-hidden", "aria-disabled"],
    });
    schedule();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  window.addEventListener("pagehide", () => { report(); });

  // ---- crawler helpers ----
  const REVEAL_DISCLOSURE = "[aria-expanded=false], [aria-haspopup]:not([aria-haspopup=false]), summary, " +
    "[role=tab][aria-selected=false], [popovertarget], [commandfor]";
  function revealers(mode) {
    return controls()
      .filter((el) => !disabledOf(el) && (mode === "all" ? !/^(textbox|searchbox|combobox|slider|spinbutton)$/.test(roleOf(el)) : el.matches(REVEAL_DISCLOSURE)))
      .map((el) => describe(el).key);
  }
  function mark(key) {
    document.querySelectorAll("[data-ui-probe-target]").forEach((n) => n.removeAttribute("data-ui-probe-target"));
    const el = controls().find((c) => describe(c).key === key);
    if (el) el.setAttribute("data-ui-probe-target", "");
    return !!el;
  }

  window.__uiProbe = { enumerate, report, revealers, mark, describe, route: routeOf };
})();
