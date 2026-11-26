// Demo reading-list SPA for the ui-testing skill. Deliberately ordinary
// vibe-coded app code: client routing, fetch, a dialog, a filter disclosure.
const app = document.getElementById("app");
const state = { books: [], filter: "all", error: null };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("reading-list-theme", theme);
  const btn = document.getElementById("theme");
  btn.setAttribute("aria-pressed", String(theme === "dark"));
  btn.textContent = theme === "dark" ? "Light theme" : "Dark theme";
}
document.getElementById("theme").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
setTheme(localStorage.getItem("reading-list-theme") === "dark" ? "dark" : "light");

function navigate(path) {
  history.pushState(null, "", path);
  render();
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
window.addEventListener("popstate", render);

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadBooks() {
  state.error = null;
  app.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    state.books = (await api("/api/books")).books;
  } catch (err) {
    state.error = err.message;
  }
}

function visibleBooks() {
  if (state.filter === "read") return state.books.filter((b) => b.read);
  if (state.filter === "unread") return state.books.filter((b) => !b.read);
  return state.books;
}

function renderList() {
  if (state.error) {
    app.innerHTML = `<div role="alert"><p>Couldn't load your books: ${esc(state.error)}</p>
      <button id="retry" type="button">Try again</button></div>`;
    document.getElementById("retry").addEventListener("click", async () => { await loadBooks(); renderList(); });
    return;
  }
  const rows = visibleBooks().map((b) => `<li>
      <span><a class="title" href="/books/${b.id}" data-link title="${esc(b.title)}">${esc(b.title)}</a>
      <span class="author">${esc(b.author || "Unknown author")}</span></span>
      <button type="button" class="toggle-read" data-id="${b.id}">${b.read ? "Mark unread" : "Mark read"}</button>
    </li>`).join("");
  const empty = state.books.length === 0
    ? `<p>No books yet.</p><button id="first" type="button">Add your first book</button>`
    : visibleBooks().length === 0 ? `<p>Nothing matches this filter.</p>` : `<ul id="books">${rows}</ul>`;
  app.innerHTML = `<h1>Books</h1>
    <button id="filters-toggle" type="button" aria-expanded="false" aria-controls="filters">Filters</button>
    <div id="filters" class="filters" hidden>
      ${["all", "unread", "read"].map((f) => `<button type="button" data-filter="${f}" aria-pressed="${state.filter === f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join("")}
      ${state.filter !== "all" ? '<button type="button" class="chip-clear">Clear filter</button>' : ""}
    </div>
    ${empty}
    <form id="add" aria-label="Add book" novalidate>
      <label for="title">Title</label><input id="title" name="title" autocomplete="off">
      <label for="author">Author</label><input id="author" name="author" autocomplete="off">
      <p id="add-error" class="error" role="status"></p>
      <button class="primary" type="submit">Add book</button>
    </form>`;

  const toggle = document.getElementById("filters-toggle");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    document.getElementById("filters").hidden = !open;
  });
  const reopen = () => { document.getElementById("filters-toggle").click(); };
  app.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    state.filter = b.dataset.filter; renderList(); reopen();
  }));
  app.querySelector(".chip-clear")?.addEventListener("click", () => { state.filter = "all"; renderList(); reopen(); });
  document.getElementById("first")?.addEventListener("click", () => document.getElementById("title").focus());
  app.querySelectorAll(".toggle-read").forEach((b) => b.addEventListener("click", async () => {
    const book = state.books.find((x) => x.id === Number(b.dataset.id));
    b.disabled = true;
    try {
      Object.assign(book, await api(`/api/books/${book.id}`, { method: "PATCH", body: JSON.stringify({ read: !book.read }) }));
      renderList();
    } catch (err) {
      b.disabled = false;
      document.getElementById("add-error").textContent = err.message;
    }
  }));
  document.getElementById("add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("title");
    const author = document.getElementById("author");
    const error = document.getElementById("add-error");
    if (!title.value.trim()) { error.textContent = "Give the book a title."; title.focus(); return; }
    const submit = e.target.querySelector("button[type=submit]");
    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    try {
      state.books.push(await api("/api/books", { method: "POST", body: JSON.stringify({ title: title.value, author: author.value }) }));
      renderList();
    } catch (err) {
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
      error.textContent = err.message;
    }
  });
}

async function renderDetail(id) {
  app.innerHTML = '<div class="skeleton"></div>';
  let book;
  try {
    book = await api(`/api/books/${id}`);
  } catch (err) {
    app.innerHTML = `<div role="alert"><p>${esc(err.message)}</p><a href="/" data-link>Back to books</a></div>`;
    return;
  }
  app.innerHTML = `<p><a href="/" data-link>← All books</a></p>
    <h1>${esc(book.title)}</h1>
    <p class="author">${esc(book.author || "Unknown author")}</p>
    <button id="delete" type="button" aria-haspopup="dialog">Delete</button>
    <dialog id="confirm" aria-labelledby="confirm-title">
      <h2 id="confirm-title">Delete this book?</h2>
      <button id="cancel" type="button">Cancel</button>
      <button id="really-delete" type="button" class="primary">Delete book</button>
    </dialog>`;
  const dialog = document.getElementById("confirm");
  document.getElementById("delete").addEventListener("click", () => dialog.showModal());
  document.getElementById("cancel").addEventListener("click", () => dialog.close());
  document.getElementById("really-delete").addEventListener("click", async () => {
    await api(`/api/books/${id}`, { method: "DELETE" });
    dialog.close();
    navigate("/");
  });
}

function renderAbout() {
  app.innerHTML = `<h1>About</h1><p>A tiny reading list used to demo the ui-testing skill.</p>
    <p><a href="https://playwright.dev" rel="noopener" target="_blank">Playwright docs</a></p>`;
}

async function render() {
  const path = location.pathname;
  document.querySelectorAll("nav a").forEach((a) => {
    const here = a.getAttribute("href") === "/" ? path === "/" || path.startsWith("/books") : path.startsWith(a.getAttribute("href"));
    if (here) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const m = /^\/books\/(\d+)$/.exec(path);
  if (m) return renderDetail(m[1]);
  if (path === "/about") return renderAbout();
  await loadBooks();
  renderList();
}
render();
