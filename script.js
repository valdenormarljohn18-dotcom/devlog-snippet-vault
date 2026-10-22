const STORAGE_KEY = "devlog-vault.entries.v1";
const THEME_STORAGE_KEY = "devlog-vault.theme.v1";
const themes = {
  forest: { label: "Forest dark", color: "#111713" },
  midnight: { label: "Black & blue", color: "#090e18" },
  violet: { label: "White & violet", color: "#f7f5fb" },
};

function loadTheme() {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return Object.hasOwn(themes, savedTheme) ? savedTheme : "forest";
  } catch (error) {
    console.error("Could not read the saved Devlog theme.", error);
    return "forest";
  }
}

let activeTheme = loadTheme();
document.documentElement.dataset.theme = activeTheme;

function syncThemeChoices() {
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === activeTheme));
  });
}

const starterEntries = [];
const sampleEntryIds = new Set([
  "starter-log-css-grid",
  "starter-snippet-debounce",
  "starter-log-api",
  "starter-snippet-clamp",
]);

const elements = {
  grid: document.querySelector("#entries-grid"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  palette: document.querySelector("#palette-dialog"),
  paletteSearch: document.querySelector("#palette-search"),
  paletteResults: document.querySelector("#palette-results"),
  sort: document.querySelector("#sort-select"),
  dialog: document.querySelector("#entry-dialog"),
  form: document.querySelector("#entry-form"),
  previewPanel: document.querySelector("#preview-panel"),
  previewFrame: document.querySelector("#playground-frame"),
  previewOutput: document.querySelector("#playground-output"),
  markdownPreview: document.querySelector("#markdown-preview"),
  toast: document.querySelector("#toast"),
};

let entries = loadEntries();
let activeFilter = "all";
let organizationFilter = null;
let searchQuery = "";
let selectedPaletteIndex = 0;
let editingId = null;
let toastTimer;
function setTheme(theme) {
  if (!Object.hasOwn(themes, theme)) return;
  activeTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = themes[theme].color;
  syncThemeChoices();
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.error("Could not save the Devlog theme.", error);
    showToast("Theme changed, but could not be saved on this device.");
    return;
  }
  showToast(`${themes[theme].label} theme selected.`);
}

document.querySelectorAll("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    setTheme(button.dataset.themeChoice);
    document.querySelector(".theme-menu").open = false;
  });
});
syncThemeChoices();

function loadEntries() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(starterEntries));
      return starterEntries;
    }
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      throw new TypeError("Saved entries must be an array.");
    }
    return parsed
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === "string" &&
          typeof entry.title === "string" &&
          typeof entry.content === "string" &&
          !sampleEntryIds.has(entry.id) &&
          (entry.type === "log" || entry.type === "snippet"),
      )
      .map((entry) => ({
        ...entry,
        language: typeof entry.language === "string" ? entry.language : "",
        folder: normalizeFolder(entry.folder || ""),
        tags: Array.isArray(entry.tags)
          ? entry.tags.filter((tag) => typeof tag === "string")
          : [],
        favorite: Boolean(entry.favorite),
      }));
  } catch (error) {
    console.error("Could not read saved Devlog entries.", error);
    window.setTimeout(
      () => showToast("Saved data could not be read. Your new entries will still work."),
      0,
    );
    return starterEntries;
  }
}

function normalizeFolder(value) {
  return String(value)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function persistEntries() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch (error) {
    console.error("Could not save Devlog entries.", error);
    showToast("Could not save to this device. Check your browser storage settings.");
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function fuzzyScore(query, value) {
  const normalizedValue = value.toLocaleLowerCase();
  let totalScore = 0;
  for (const term of query.toLocaleLowerCase().split(/\s+/).filter(Boolean)) {
    let index = -1;
    let previousIndex = -2;
    let firstIndex = -1;
    let score = 0;
    for (const character of term) {
      index = normalizedValue.indexOf(character, index + 1);
      if (index === -1) return -1;
      if (firstIndex === -1) firstIndex = index;
      score += index === previousIndex + 1 ? 4 : 1;
      if (index === 0 || /[\s_\-/.]/.test(normalizedValue[index - 1])) score += 5;
      previousIndex = index;
    }
    totalScore += score + Math.max(0, 16 - firstIndex);
  }
  return totalScore;
}

function entrySearchFields(entry) {
  return [
    entry.title,
    entry.language,
    entry.folder,
    entry.content,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
  ].filter(Boolean);
}

function scoreEntry(entry, query) {
  if (!query.trim()) return 0;
  const fields = entrySearchFields(entry);
  let totalScore = 0;
  for (const term of query.trim().split(/\s+/)) {
    const bestScore = Math.max(...fields.map((field) => fuzzyScore(term, field)));
    if (bestScore < 0) return -1;
    totalScore += bestScore;
  }
  return totalScore;
}

function getVisibleEntries() {
  const query = searchQuery.trim();
  const filtered = entries.filter((entry) => {
    const matchesType =
      activeFilter === "all" ||
      (activeFilter === "favorites"
        ? entry.favorite
        : entry.type === activeFilter);
    const matchesOrganization =
      !organizationFilter ||
      (organizationFilter.field === "language"
        ? (entry.language || "").toLocaleLowerCase() === organizationFilter.value.toLocaleLowerCase()
        : organizationFilter.field === "tag"
          ? (entry.tags || []).some(
              (tag) => tag.toLocaleLowerCase() === organizationFilter.value.toLocaleLowerCase(),
            )
          : (entry.folder || "").toLocaleLowerCase() === organizationFilter.value.toLocaleLowerCase() ||
            (entry.folder || "").toLocaleLowerCase().startsWith(`${organizationFilter.value.toLocaleLowerCase()}/`));
    return (
      matchesType &&
      matchesOrganization &&
      (!query || scoreEntry(entry, query) >= 0)
    );
  });

  return filtered.sort((first, second) => {
    if (query) {
      const scoreDifference = scoreEntry(second, query) - scoreEntry(first, query);
      if (scoreDifference) return scoreDifference;
    }
    if (elements.sort.value === "az") {
      return first.title.localeCompare(second.title);
    }
    const direction = elements.sort.value === "oldest" ? 1 : -1;
    return direction * (new Date(first.createdAt) - new Date(second.createdAt));
  });
}

function renderLibraryTree() {
  const languages = [...new Set(entries.map((entry) => entry.language.trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  const folders = new Set();
  entries.forEach((entry) => {
    const segments = entry.folder.split("/").map((part) => part.trim()).filter(Boolean);
    segments.forEach((_, index) => folders.add(segments.slice(0, index + 1).join("/")));
  });
  const sortedFolders = [...folders].sort((first, second) => first.localeCompare(second));
  const tags = [...new Set(entries.flatMap((entry) => entry.tags || []).filter(Boolean))].sort(
    (first, second) => first.localeCompare(second),
  );

  document.querySelector("#language-tree").innerHTML = languages.length
    ? languages
        .map((language) => {
          const count = entries.filter(
            (entry) => entry.language.toLocaleLowerCase() === language.toLocaleLowerCase(),
          ).length;
          return `<button class="tree-item ${organizationFilter?.field === "language" && organizationFilter.value === language ? "is-selected" : ""}" type="button" data-org-field="language" data-org-value="${escapeHtml(language)}"><span class="tree-language-mark">${escapeHtml(language.slice(0, 1).toUpperCase())}</span><span>${escapeHtml(language)}</span><span class="tree-count">${count}</span></button>`;
        })
        .join("")
    : `<span class="tree-placeholder">No languages yet</span>`;

  document.querySelector("#folder-tree").innerHTML = sortedFolders.length
    ? sortedFolders
        .map((folder) => {
          const depth = folder.split("/").length - 1;
          const prefix = `${folder.toLocaleLowerCase()}/`;
          const count = entries.filter(
            (entry) =>
              entry.folder.toLocaleLowerCase() === folder.toLocaleLowerCase() ||
              entry.folder.toLocaleLowerCase().startsWith(prefix),
          ).length;
          return `<button class="tree-item folder-tree-item ${organizationFilter?.field === "folder" && organizationFilter.value === folder ? "is-selected" : ""}" type="button" data-org-field="folder" data-org-value="${escapeHtml(folder)}" style="--tree-depth:${depth}"><span class="folder-icon" aria-hidden="true">▱</span><span>${escapeHtml(folder.split("/").pop().trim())}</span><span class="tree-count">${count}</span></button>`;
        })
        .join("")
    : `<span class="tree-placeholder">No project folders yet</span>`;

  document.querySelector("#tag-tree").innerHTML = tags.length
    ? tags
        .map((tag) => {
          const count = entries.filter((entry) =>
            (entry.tags || []).some(
              (entryTag) => entryTag.toLocaleLowerCase() === tag.toLocaleLowerCase(),
            ),
          ).length;
          return `<button class="tree-item ${organizationFilter?.field === "tag" && organizationFilter.value === tag ? "is-selected" : ""}" type="button" data-org-field="tag" data-org-value="${escapeHtml(tag)}"><span class="tag-tree-mark" aria-hidden="true">#</span><span>${escapeHtml(tag)}</span><span class="tree-count">${count}</span></button>`;
        })
        .join("")
    : `<span class="tree-placeholder">No tags yet</span>`;

  document.querySelector("#tree-empty").classList.toggle(
    "is-hidden",
    languages.length > 0 || sortedFolders.length > 0 || tags.length > 0,
  );
  document.querySelector("#folder-options").innerHTML = sortedFolders
    .map((folder) => `<option value="${escapeHtml(folder)}"></option>`)
    .join("");
}

function highlightMatch(text, query) {
  const characters = [...String(text)];
  const firstTerm = query.trim().split(/\s+/)[0]?.toLocaleLowerCase() || "";
  if (!firstTerm || fuzzyScore(firstTerm, text) < 0) return escapeHtml(text);
  const marked = new Set();
  let cursor = 0;
  for (const character of firstTerm) {
    const found = characters.findIndex(
      (candidate, index) => index >= cursor && candidate.toLocaleLowerCase() === character,
    );
    if (found === -1) break;
    marked.add(found);
    cursor = found + 1;
  }
  return characters
    .map((character, index) =>
      marked.has(index)
        ? `<mark class="match-highlight">${escapeHtml(character)}</mark>`
        : escapeHtml(character),
    )
    .join("");
}

function renderPalette() {
  if (!elements.palette.open) return;
  const query = elements.paletteSearch.value.trim();
  const results = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((result) => !query || result.score >= 0)
    .sort((first, second) => {
      if (query && first.score !== second.score) return second.score - first.score;
      return new Date(second.entry.createdAt) - new Date(first.entry.createdAt);
    })
    .slice(0, 10);

  if (results.length === 0) {
    elements.paletteResults.innerHTML = `<div class="palette-no-results">${query ? "No matching entries. Try another search." : "Your vault is empty. Create an entry to start searching."}</div>`;
    selectedPaletteIndex = 0;
    return;
  }
  selectedPaletteIndex = Math.min(selectedPaletteIndex, results.length - 1);
  elements.paletteResults.innerHTML = results
    .map(({ entry }, index) => {
      const metadata = [
        entry.type === "snippet" ? "Snippet" : "Dev log",
        entry.language,
        entry.folder && entry.folder.replaceAll("/", " / "),
        ...(entry.tags || []).slice(0, 2),
      ]
        .filter(Boolean)
        .join(" · ");
      const excerpt = entry.content.replace(/\s+/g, " ").trim();
      const excerptStart = query
        ? Math.max(0, excerpt.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 24)
        : 0;
      const excerptText = excerpt.slice(excerptStart, excerptStart + 110);
      const excerptMarkup = query
        ? `<span class="palette-result-excerpt">${excerptStart ? "… " : ""}${highlightMatch(excerptText, query)}${excerptStart + 110 < excerpt.length ? "…" : ""}</span>`
        : "";
      return `<button class="palette-result ${index === selectedPaletteIndex ? "is-active" : ""}" type="button" role="option" aria-selected="${index === selectedPaletteIndex}" data-palette-index="${index}" data-entry-id="${escapeHtml(entry.id)}"><span class="palette-result-mark">${entry.type === "snippet" ? "{ }" : "↗"}</span><span class="palette-result-copy"><span class="palette-result-title">${highlightMatch(entry.title, query)}</span><span class="palette-result-meta">${escapeHtml(metadata)}</span>${excerptMarkup}</span><span class="palette-enter-hint">↵</span></button>`;
    })
    .join("");
}

function entryCard(entry) {
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const preview = entry.content.trim();
  const excerpt =
    preview.length > 168 ? `${preview.slice(0, 168).trimEnd()}…` : preview;
  const snippet = entry.type === "snippet";
  const typeLabel = snippet ? "Snippet" : "Dev log";
  const tagMarkup = tags
    .slice(0, 3)
    .map((tag) => `<span class="entry-tag">${escapeHtml(tag)}</span>`)
    .join("");
  const folderLabel = entry.folder
    ? `<span class="entry-folder">${escapeHtml(entry.folder)}</span>`
    : "";

  return `
    <article class="entry-card ${snippet ? "snippet-card" : "log-card"}" data-entry-id="${escapeHtml(entry.id)}">
      <div class="card-topline">
        <span class="entry-type ${snippet ? "type-snippet" : "type-log"}">
          <span class="type-mark">${snippet ? "{ }" : "↗"}</span>${typeLabel}
        </span>
        <button class="favorite-button ${entry.favorite ? "is-favorite" : ""}" type="button" data-action="favorite" aria-label="${entry.favorite ? "Remove from" : "Add to"} favorites" aria-pressed="${Boolean(entry.favorite)}">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.8 2.2 4.45 4.91.72-3.55 3.46.84 4.89L10 14.01l-4.4 2.31.84-4.89-3.55-3.46 4.91-.72L10 2.8Z"></path></svg>
        </button>
      </div>
      <button class="card-content-button" type="button" data-action="edit" aria-label="Edit ${escapeHtml(entry.title)}">
        <h3>${escapeHtml(entry.title)}</h3>
        ${
          snippet
            ? `<pre class="code-preview"><code>${escapeHtml(excerpt)}</code></pre>`
            : `<p class="entry-excerpt">${escapeHtml(excerpt)}</p>`
        }
      </button>
      <div class="card-tags">${tagMarkup}</div>
      <div class="card-footer">
        <span class="entry-date">${formatDate(entry.createdAt)}</span>
        ${snippet && entry.language ? `<span class="language-label"><span></span>${escapeHtml(entry.language)}</span>` : ""}
      </div>
      ${folderLabel}
    </article>`;
}

function render() {
  const visible = getVisibleEntries();
  elements.grid.innerHTML = visible.map(entryCard).join("");
  elements.grid.classList.toggle("is-hidden", visible.length === 0);
  elements.emptyState.classList.toggle("is-hidden", visible.length > 0);

  const logs = entries.filter((entry) => entry.type === "log").length;
  const snippets = entries.filter((entry) => entry.type === "snippet").length;
  const favorites = entries.filter((entry) => entry.favorite).length;
  document.querySelector("#all-count").textContent = entries.length;
  document.querySelector("#log-count").textContent = logs;
  document.querySelector("#snippet-count").textContent = snippets;
  document.querySelector("#favorite-count").textContent = favorites;
  document.querySelector("#total-stat").textContent = entries.length;
  document.querySelector("#logs-stat").textContent = logs;
  document.querySelector("#snippets-stat").textContent = snippets;
  document.querySelector("#favorites-stat").textContent = favorites;
  document.querySelector("#result-count").textContent =
    `${visible.length} ${visible.length === 1 ? "entry" : "entries"}`;
  renderLibraryTree();
  renderPalette();

  document.querySelectorAll("[data-filter]").forEach((button) => {
    const isActive = button.dataset.filter === activeFilter;
    button.classList.toggle("is-active", isActive && button.classList.contains("nav-item"));
    button.classList.toggle("is-selected", isActive && button.classList.contains("filter-chip"));
    if (button.classList.contains("nav-item")) {
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });

  const sectionNames = {
    all: "All entries",
    log: "Dev logs",
    snippet: "Snippets",
    favorites: "Favorites",
  };
  const section = sectionNames[activeFilter];
  const sectionLabel = organizationFilter
    ? organizationFilter.value.split("/").pop().trim()
    : section;
  document.querySelector("#current-section").textContent = sectionLabel;
  document.querySelector("#entries-heading").textContent =
    organizationFilter
      ? sectionLabel
      : activeFilter === "favorites"
        ? "Your favorites"
        : section === "All entries"
          ? "Your entries"
          : section;

  if (visible.length === 0) {
    const hasSearch = searchQuery.trim().length > 0;
    elements.emptyTitle.textContent = hasSearch
      ? "Nothing found."
      : organizationFilter
        ? "Nothing in this collection yet."
      : activeFilter === "favorites"
        ? "No favorites yet."
        : "A fresh page.";
    elements.emptyDescription.textContent = hasSearch
      ? "Try another search, or clear the command palette to see all your entries."
      : organizationFilter
        ? "Add an entry to this language or folder to see it here."
      : activeFilter === "favorites"
        ? "Star an entry to keep it close at hand."
        : "Every good collection starts somewhere. Save a useful snippet or jot down what you learned today.";
  }
}

function setFilter(filter) {
  activeFilter = filter;
  organizationFilter = null;
  render();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2800);
}

function openEntry(entry = null) {
  editingId = entry ? entry.id : null;
  elements.form.reset();
  document.querySelector("#dialog-title").textContent = entry ? "Edit entry" : "New entry";
  document.querySelector("#entry-title").value = entry ? entry.title : "";
  document.querySelector("#entry-type").value = entry ? entry.type : "log";
  document.querySelector("#entry-language").value = entry ? entry.language || "" : "";
  document.querySelector("#entry-folder").value = entry ? entry.folder || "" : "";
  document.querySelector("#entry-tags").value = entry && Array.isArray(entry.tags) ? entry.tags.join(", ") : "";
  document.querySelector("#entry-content").value = entry ? entry.content : "";
  document.querySelector("#delete-entry-button").classList.toggle("is-hidden", !entry);
  document.querySelector("#content-hint").textContent =
    entry && entry.type === "snippet" ? "Your code, ready to reuse." : "What did you learn?";
  document.querySelector("#entry-content").placeholder =
    entry && entry.type === "snippet"
      ? "Paste or write a useful piece of code..."
      : "Write it down while it’s fresh...";
  elements.previewPanel.classList.add("is-hidden");
  elements.previewFrame.removeAttribute("srcdoc");
  elements.dialog.showModal();
  document.querySelector("#entry-title").focus();
}

function closeEntry() {
  if (elements.dialog.open) elements.dialog.close();
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let codeLines = null;
  let listOpen = false;
  const closeList = () => {
    if (listOpen) output.push("</ul>");
    listOpen = false;
  };
  const inline = (text) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (codeLines) {
        closeList();
        output.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        codeLines = null;
      } else {
        closeList();
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(escapeHtml(line));
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (listItem) {
      if (!listOpen) output.push("<ul>"), (listOpen = true);
      output.push(`<li>${inline(listItem[1])}</li>`);
    } else if (line.trim()) {
      closeList();
      output.push(`<p>${inline(line)}</p>`);
    } else {
      closeList();
    }
  }
  if (codeLines) output.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  closeList();
  return output.join("");
}

function preparePlayground(language, content) {
  const normalizedLanguage = language.trim().toLocaleLowerCase();
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";
  const header = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const bridge = `(() => { const send = (kind, values) => { let text; try { text = values.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" "); } catch { text = "[unprintable value]"; } parent.postMessage({ type: "vault-console", kind, text }, "*"); }; for (const kind of ["log", "info", "warn", "error"]) { const original = console[kind]; console[kind] = (...values) => { send(kind, values); original.apply(console, values); }; } addEventListener("error", event => send("error", [event.message])); })();`;
  const runtimePolicy =
    "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src https://cdn.jsdelivr.net; worker-src blob:; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";
  const runtimeHeader = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${runtimePolicy}">`;
  const safeSource = JSON.stringify(content).replace(/</g, "\\u003c");

  if (["html", "html5"].includes(normalizedLanguage)) {
    return {
      mode: "html",
      srcdoc: `<!doctype html><html><head>${header}<style>body{font:16px system-ui,sans-serif;padding:20px;color:#24352b}</style></head><body>${content}</body></html>`,
    };
  }
  if (normalizedLanguage === "css") {
    const safeCss = content.replace(/<\/style/gi, "<\\/style");
    return {
      mode: "css",
      srcdoc: `<!doctype html><html><head>${header}<style>body{font:16px system-ui,sans-serif;padding:20px;color:#24352b}${safeCss}</style></head><body><h1>CSS preview</h1><p>Style this sample content with your snippet.</p><button>Example button</button></body></html>`,
    };
  }
  if (["js", "javascript"].includes(normalizedLanguage)) {
    const safeCode = content.replace(/<\/script/gi, "<\\/script");
    return {
      mode: "javascript",
      srcdoc: `<!doctype html><html><head>${header}</head><body><p>JavaScript is running in a sandbox.</p><script>${bridge}</script><script>${safeCode}</script></body></html>`,
    };
  }
  if (["ts", "typescript"].includes(normalizedLanguage)) {
    return {
      mode: "typescript",
      srcdoc: `<!doctype html><html><head>${runtimeHeader}<script src="https://cdn.jsdelivr.net/npm/typescript@5.8.3/lib/typescript.js"></script></head><body><script>${bridge}try { const compiled = ts.transpileModule(${safeSource}, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText; const runner = document.createElement("script"); runner.textContent = compiled; document.body.append(runner); } catch (error) { console.error(error); }</script></body></html>`,
    };
  }
  if (["py", "python", "python 3", "python3"].includes(normalizedLanguage)) {
    return {
      mode: "python",
      srcdoc: `<!doctype html><html><head>${runtimeHeader}<script src="https://cdn.jsdelivr.net/pyodide/v0.28.2/full/pyodide.js"></script></head><body><script>${bridge}(async () => { try { const pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.28.2/full/" }); pyodide.setStdout({ batched: (text) => console.log(text) }); pyodide.setStderr({ batched: (text) => console.error(text) }); const result = pyodide.runPython(${safeSource}); if (result !== undefined && result !== null) console.log(String(result)); if (result && typeof result.destroy === "function") result.destroy(); } catch (error) { console.error(error); } })();</script></body></html>`,
    };
  }
  return { mode: "unsupported", srcdoc: "" };
}

function showEntryPreview() {
  const content = document.querySelector("#entry-content").value;
  const language = document.querySelector("#entry-language").value;
  const type = document.querySelector("#entry-type").value;
  elements.previewPanel.classList.remove("is-hidden");
  elements.markdownPreview.classList.add("is-hidden");
  elements.previewFrame.classList.add("is-hidden");
  elements.previewOutput.classList.add("is-hidden");
  elements.previewOutput.textContent = "";
  elements.previewFrame.removeAttribute("srcdoc");

  if (content.length > 80000) {
    showToast("Preview is limited to 80 KB of content.");
    return;
  }
  if (type === "log" || language.trim().toLocaleLowerCase() === "markdown") {
    document.querySelector("#preview-label").textContent = "MARKDOWN PREVIEW";
    elements.markdownPreview.innerHTML = renderMarkdown(content);
    elements.markdownPreview.classList.remove("is-hidden");
    return;
  }

  const playground = preparePlayground(language, content);
  const previewLabels = {
    html: "HTML PREVIEW",
    css: "CSS PREVIEW",
    javascript: "JAVASCRIPT PLAYGROUND",
    python: "PYTHON RUNNER · ON-DEVICE",
    typescript: "TYPESCRIPT RUNNER · ON-DEVICE",
  };
  document.querySelector("#preview-label").textContent =
    previewLabels[playground.mode] || "SANDBOXED PREVIEW";
  if (playground.mode === "unsupported") {
    elements.previewOutput.textContent =
      "This language is saved as a snippet but cannot run in this browser yet. Run support is available for HTML, CSS, JavaScript, Python, and TypeScript; Markdown renders as a preview.";
    elements.previewOutput.classList.remove("is-hidden");
    return;
  }
  elements.previewFrame.classList.remove("is-hidden");
  if (["javascript", "python", "typescript"].includes(playground.mode)) {
    elements.previewOutput.textContent =
      playground.mode === "python" || playground.mode === "typescript"
        ? "Loading the language runtime in this browser. First use requires an internet connection; your code is not sent to an execution service."
        : "Console output will appear here.";
    elements.previewOutput.classList.remove("is-hidden");
  }
  elements.previewFrame.srcdoc = playground.srcdoc;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  downloadFile(
    `devlog-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(entries, null, 2),
    "application/json",
  );
  showToast("JSON backup downloaded.");
}

async function shareVaultBackup() {
  const fileName = `devlog-vault-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(entries, null, 2)], fileName, {
    type: "application/json",
  });
  const exportMenu = document.querySelector(".export-menu");

  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    downloadFile(fileName, await file.text(), file.type);
    exportMenu.open = false;
    showToast("Backup downloaded. Use your device's share menu to send it.");
    return;
  }

  try {
    await navigator.share({
      files: [file],
      title: "DevLog vault backup",
      text: "DevLog & Snippet Vault backup. Import this JSON file into DevLog.",
    });
    showToast("Choose Bluetooth or another sharing option on your device.");
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Could not share the Devlog backup.", error);
    downloadFile(fileName, await file.text(), file.type);
    showToast("Sharing failed. A backup was downloaded instead.");
  } finally {
    exportMenu.open = false;
  }
}

function exportMarkdown() {
  const content = entries
    .map((entry) => {
      const tags = (entry.tags || []).join(", ");
      const metadata = [
        `Type: ${entry.type === "snippet" ? "Snippet" : "Dev log"}`,
        entry.language && `Language: ${entry.language}`,
        entry.folder && `Folder: ${entry.folder.replaceAll("/", " / ")}`,
        tags && `Tags: ${tags}`,
        `Created: ${formatDate(entry.createdAt)}`,
      ].filter(Boolean);
      const body =
        entry.type === "snippet"
          ? (() => {
              const longestFence = Math.max(
                0,
                ...(entry.content.match(/`+/g) || []).map((fence) => fence.length),
              );
              const fence = "`".repeat(Math.max(3, longestFence + 1));
              const language = (entry.language || "").replace(/[^\w+#.-]/g, "");
              return `${fence}${language}\n${entry.content}\n${fence}`;
            })()
          : entry.content;
      return `## ${entry.title}\n\n${metadata.map((line) => `- ${line}`).join("\n")}\n\n${body}`;
    })
    .join("\n\n---\n\n");
  downloadFile(
    `devlog-export-${new Date().toISOString().slice(0, 10)}.md`,
    `# Devlog & Snippet Vault export\n\n${content || "_No entries yet._"}\n`,
    "text/markdown;charset=utf-8",
  );
  showToast("Markdown export downloaded.");
}

async function importJsonFile(file) {
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) {
      throw new TypeError("The backup must contain a JSON array of entries.");
    }
    const existingIds = new Set(entries.map((entry) => entry.id));
    const additions = imported
      .filter((entry) => {
        if (
          !entry ||
          typeof entry.title !== "string" ||
          typeof entry.content !== "string" ||
          (entry.type !== "log" && entry.type !== "snippet")
        ) {
          return false;
        }
        if (typeof entry.id === "string") {
          if (existingIds.has(entry.id)) return false;
          existingIds.add(entry.id);
        }
        return true;
      })
      .map((entry) => ({
        id:
          typeof entry.id === "string"
            ? entry.id
            : crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: entry.type,
        title: entry.title,
        content: entry.content,
        language: typeof entry.language === "string" ? entry.language : "",
        folder: normalizeFolder(entry.folder || ""),
        tags: Array.isArray(entry.tags)
          ? entry.tags.filter((tag) => typeof tag === "string").slice(0, 8)
          : [],
        favorite: Boolean(entry.favorite),
        createdAt:
          typeof entry.createdAt === "string"
            ? entry.createdAt
            : new Date().toISOString(),
      }));
    if (additions.length === 0) {
      showToast("No new valid entries found in that backup.");
      return;
    }
    entries = [...additions, ...entries];
    const saved = persistEntries();
    render();
    showToast(
      saved
        ? `Imported ${additions.length} ${additions.length === 1 ? "entry" : "entries"}.`
        : "Import could not be saved to this device.",
    );
  } catch (error) {
    console.error("Could not import Devlog backup.", error);
    showToast("Could not import that file. Choose a valid Devlog JSON backup.");
  }
}

function openPalette() {
  if (!elements.palette.open) elements.palette.showModal();
  selectedPaletteIndex = 0;
  elements.paletteSearch.value = searchQuery;
  renderPalette();
  elements.paletteSearch.focus();
  elements.paletteSearch.select();
}

function openPaletteEntry(index = selectedPaletteIndex) {
  const query = elements.paletteSearch.value.trim();
  const results = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((result) => !query || result.score >= 0)
    .sort((first, second) => {
      if (query && first.score !== second.score) return second.score - first.score;
      return new Date(second.entry.createdAt) - new Date(first.entry.createdAt);
    });
  const selected = results[index]?.entry;
  if (!selected) return;
  searchQuery = query;
  elements.palette.close();
  render();
  openEntry(selected);
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
});

document.querySelector("#language-tree").addEventListener("click", (event) => {
  const button = event.target.closest("[data-org-field]");
  if (!button) return;
  const sameFilter =
    organizationFilter?.field === button.dataset.orgField &&
    organizationFilter.value === button.dataset.orgValue;
  organizationFilter = sameFilter
    ? null
    : { field: button.dataset.orgField, value: button.dataset.orgValue };
  activeFilter = "all";
  searchQuery = "";
  elements.paletteSearch.value = "";
  render();
});
document.querySelector("#folder-tree").addEventListener("click", (event) => {
  const button = event.target.closest("[data-org-field]");
  if (!button) return;
  const sameFilter =
    organizationFilter?.field === button.dataset.orgField &&
    organizationFilter.value === button.dataset.orgValue;
  organizationFilter = sameFilter
    ? null
    : { field: button.dataset.orgField, value: button.dataset.orgValue };
  activeFilter = "all";
  searchQuery = "";
  elements.paletteSearch.value = "";
  render();
});
document.querySelector("#tag-tree").addEventListener("click", (event) => {
  const button = event.target.closest("[data-org-field]");
  if (!button) return;
  const sameFilter =
    organizationFilter?.field === button.dataset.orgField &&
    organizationFilter.value === button.dataset.orgValue;
  organizationFilter = sameFilter
    ? null
    : { field: button.dataset.orgField, value: button.dataset.orgValue };
  activeFilter = "all";
  searchQuery = "";
  elements.paletteSearch.value = "";
  render();
});

document.querySelector("#new-entry-button").addEventListener("click", () => openEntry());
document.querySelector("#empty-new-button").addEventListener("click", () => openEntry());
document.querySelectorAll(".close-dialog").forEach((button) => {
  button.addEventListener("click", closeEntry);
});
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) closeEntry();
});

document.querySelector("#entry-type").addEventListener("change", (event) => {
  const isSnippet = event.target.value === "snippet";
  document.querySelector("#content-hint").textContent = isSnippet
    ? "Your code, ready to reuse."
    : "What did you learn?";
  document.querySelector("#entry-content").placeholder = isSnippet
    ? "Paste or write a useful piece of code..."
    : "Write it down while it’s fresh...";
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(elements.form);
  const previous = entries.find((entry) => entry.id === editingId);
  const entry = {
    id: editingId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    type: formData.get("type"),
    title: String(formData.get("title")).trim(),
    content: String(formData.get("content")).trim(),
    language: String(formData.get("language")).trim(),
    folder: normalizeFolder(formData.get("folder")),
    tags: String(formData.get("tags"))
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8),
    favorite: previous ? Boolean(previous.favorite) : false,
    createdAt: previous ? previous.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!entry.title || !entry.content) {
    showToast("Add a title and some notes before saving.");
    return;
  }

  entries = previous
    ? entries.map((item) => (item.id === editingId ? entry : item))
    : [entry, ...entries];
  const saved = persistEntries();
  closeEntry();
  render();
  showToast(
    saved
      ? previous
        ? "Entry updated."
        : "Entry saved on this device."
      : "Change isn't saved to this device.",
  );
});

document.querySelector("#delete-entry-button").addEventListener("click", () => {
  const entry = entries.find((item) => item.id === editingId);
  if (!entry || !window.confirm(`Delete “${entry.title}”? This cannot be undone.`)) return;
  entries = entries.filter((item) => item.id !== editingId);
  const saved = persistEntries();
  closeEntry();
  render();
  showToast(saved ? "Entry deleted." : "Change isn't saved to this device.");
});

document.querySelector("#preview-button").addEventListener("click", showEntryPreview);
document.querySelector("#preview-close").addEventListener("click", () => {
  elements.previewPanel.classList.add("is-hidden");
  elements.previewFrame.removeAttribute("srcdoc");
});
document.querySelector("#share-vault").addEventListener("click", shareVaultBackup);
document.querySelector("#export-json").addEventListener("click", () => {
  exportJson();
  document.querySelector(".export-menu").open = false;
});
document.querySelector("#export-markdown").addEventListener("click", () => {
  exportMarkdown();
  document.querySelector(".export-menu").open = false;
});
document.querySelector("#import-json-trigger").addEventListener("click", () => {
  document.querySelector("#import-json-file").click();
  document.querySelector(".export-menu").open = false;
});
document.querySelector("#import-json-file").addEventListener("change", async (event) => {
  await importJsonFile(event.target.files[0]);
  event.target.value = "";
});

document.querySelector("#open-palette-button").addEventListener("click", openPalette);
document.querySelector("#palette-dialog").addEventListener("click", (event) => {
  if (event.target === elements.palette) elements.palette.close();
});
elements.paletteSearch.addEventListener("input", () => {
  searchQuery = elements.paletteSearch.value;
  selectedPaletteIndex = 0;
  render();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => {
        console.error("Could not register the Devlog offline app shell.", error);
      });
    });
  }
});
elements.paletteResults.addEventListener("click", (event) => {
  const result = event.target.closest("[data-palette-index]");
  if (result) openPaletteEntry(Number(result.dataset.paletteIndex));
});
elements.previewFrame.addEventListener("load", () => {
  elements.previewOutput.textContent =
    elements.previewOutput.textContent === "Console output will appear here."
      ? "No console output."
      : elements.previewOutput.textContent;
});
window.addEventListener("message", (event) => {
  if (event.source !== elements.previewFrame.contentWindow) return;
  if (!event.data || event.data.type !== "vault-console") return;
  const line = `[${String(event.data.kind).toUpperCase()}] ${String(event.data.text)}`;
  const current = elements.previewOutput.textContent;
  elements.previewOutput.textContent =
    current === "No console output." || current === "Console output will appear here."
      ? line
      : `${current}\n${line}`;
});

elements.grid.addEventListener("click", (event) => {
  const card = event.target.closest(".entry-card");
  if (!card) return;
  const entry = entries.find((item) => item.id === card.dataset.entryId);
  if (!entry) return;

  if (event.target.closest('[data-action="favorite"]')) {
    entry.favorite = !entry.favorite;
    const saved = persistEntries();
    render();
    showToast(
      saved
        ? entry.favorite
          ? "Added to favorites."
          : "Removed from favorites."
        : "Change isn't saved to this device.",
    );
  } else if (event.target.closest('[data-action="edit"]')) {
    openEntry(entry);
  }
});

elements.sort.addEventListener("change", render);
document.querySelector("#today-date").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
}).format(new Date());

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    openPalette();
    return;
  }
  if (elements.palette.open) {
    const optionCount = elements.paletteResults.querySelectorAll("[data-palette-index]").length;
    if (event.key === "ArrowDown" && optionCount > 0) {
      event.preventDefault();
      selectedPaletteIndex = (selectedPaletteIndex + 1) % optionCount;
      renderPalette();
    } else if (event.key === "ArrowUp" && optionCount > 0) {
      event.preventDefault();
      selectedPaletteIndex = (selectedPaletteIndex - 1 + optionCount) % optionCount;
      renderPalette();
    } else if (event.key === "Enter") {
      event.preventDefault();
      openPaletteEntry();
    }
    return;
  }
  if (event.key === "Escape") return;
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    openEntry();
  }
});

render();
