const app = document.getElementById("app");
let state = null;
let selectedKey = "";
let rematching = false;
const queries = {};
const offsets = {};
let searchTimer = null;

function send(data) {
  iina.postMessage("command", data);
}

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.value !== undefined) element.value = options.value;
  if (options.placeholder) element.placeholder = options.placeholder;
  if (options.title) element.title = options.title;
  if (options.min !== undefined) element.min = options.min;
  if (options.max !== undefined && options.max !== null) element.max = options.max;
  if (options.step !== undefined) element.step = options.step;
  if (options.disabled) element.disabled = true;
  if (options.checked !== undefined) element.checked = options.checked;
  if (options.autocomplete) element.autocomplete = options.autocomplete;
  if (options.onClick) element.addEventListener("click", options.onClick);
  if (options.onInput) element.addEventListener("input", options.onInput);
  if (options.onChange) element.addEventListener("change", options.onChange);
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child !== null && child !== undefined) element.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return element;
}

function button(text, onClick, className = "", disabled = false) {
  return node("button", { type: "button", text, onClick, className, disabled });
}

function card(children, className = "") {
  return node("div", { className: `card stack ${className}`.trim() }, children);
}

function heading(title, detail = "") {
  return node("div", { className: "row spread" }, [node("h2", { text: title }), detail ? node("span", { className: "pill", text: detail }) : null]);
}

function titleOf(media) {
  return media?.title?.userPreferred || media?.title?.romaji || media?.title?.english || `AniList #${media?.id}`;
}

function episodeText(item) {
  const start = item.manualEpisode || item.localStart;
  const end = item.manualEpisode || item.localEnd;
  if (!start) return "Episode not detected";
  return start === end ? `Episode ${start}` : `Episodes ${start}–${end}`;
}

function stateText(value) {
  if (!value) return "No entry";
  return `${value.status || "NO STATUS"}, episode ${value.progress || 0}`;
}

function uniqueSeries() {
  const map = new Map();
  [...state.sessions, ...state.pending].forEach((item) => {
    if (!map.has(item.seriesKey)) map.set(item.seriesKey, item);
  });
  return map;
}

function renderAccount() {
  if (state.accountSwitch) {
    return card([
      heading("Switch AniList account"),
      node("p", { text: `The token belongs to ${state.accountSwitch.viewer.name}. Switching accounts clears matches, pending work, ignored titles, and sync history.` }),
      node("div", { className: "row" }, [
        button("Switch and clear", () => send({ action: "confirm-account-switch" }), "danger"),
        button("Cancel", () => send({ action: "cancel-account-switch" })),
      ]),
    ], "error");
  }

  if (state.connected) {
    return card([
      heading("AniList account", "Connected"),
      node("div", { className: "row spread" }, [
        node("strong", { text: state.account?.name || "AniList user" }),
        button("Disconnect", () => {
          if (confirm("Disconnect AniList? Pending items will stay on this Mac.")) send({ action: "disconnect" });
        }),
      ]),
    ]);
  }

  const token = node("input", {
    type: "password",
    placeholder: "Paste the access token",
    autocomplete: "off",
  });
  return card([
    heading("Connect AniList", "Disconnected"),
    node("p", { className: "muted", text: "Open AniList authorization, approve access, then paste the token shown by AniList. It is stored only in macOS Keychain." }),
    button("Open AniList authorization", () => send({ action: "connect" }), "primary", !state.clientConfigured),
    state.clientConfigured ? null : node("p", { className: "error-text", text: "This build has no AniList client ID. Install an official release or configure the build variable." }),
    node("label", {}, [node("span", { text: "Access token" }), token]),
    button("Connect", () => {
      const value = token.value.trim();
      token.value = "";
      if (value) send({ action: "submit-token", token: value });
    }),
  ]);
}

function renderMatcher() {
  const series = uniqueSeries();
  const matched = new Set(state.matches.map((item) => item.seriesKey));
  const ignored = new Set(state.ignored.map((item) => item.seriesKey));
  const unmatched = [...series.keys()].filter((key) => !matched.has(key) && !ignored.has(key));
  if (!rematching && matched.has(selectedKey)) selectedKey = unmatched[0] || "";
  if (!selectedKey || (!series.has(selectedKey) && !matched.has(selectedKey))) selectedKey = unmatched[0] || "";
  if (!selectedKey) return null;

  const source = series.get(selectedKey) || state.matches.find((item) => item.seriesKey === selectedKey);
  if (queries[selectedKey] === undefined) queries[selectedKey] = source?.searchTitle || source?.title || "";
  if (offsets[selectedKey] === undefined) offsets[selectedKey] = state.matches.find((item) => item.seriesKey === selectedKey)?.offset || 0;
  const search = node("input", { type: "search", value: queries[selectedKey], placeholder: "Title, AniList ID, or URL" });
  search.addEventListener("input", () => {
    queries[selectedKey] = search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (search.value.trim().length >= 2) send({ action: "search", seriesKey: selectedKey, query: search.value });
    }, 300);
  });
  const offset = node("input", { type: "number", value: offsets[selectedKey], step: 1 });
  offset.addEventListener("input", () => (offsets[selectedKey] = offset.value));
  const candidates = state.candidates[selectedKey] || [];
  const contents = [
    heading("Match a title", unmatched.length ? `${unmatched.length} unmatched` : "Rematch"),
    node("strong", { text: source?.searchTitle || source?.title || selectedKey }),
    source?.localStart ? node("small", { text: `Detected ${episodeText(source)}` }) : null,
    node("label", {}, [node("span", { text: "Search AniList" }), search]),
    node("div", { className: "row" }, [
      button("Search", () => send({ action: "search", seriesKey: selectedKey, query: search.value }), "primary", search.value.trim().length < 2),
      button("Ignore this series", () => {
        if (confirm("Ignore this series and discard its pending items?")) {
          rematching = false;
          send({ action: "ignore", seriesKey: selectedKey, title: source?.searchTitle || selectedKey });
        }
      }),
    ]),
    node("label", {}, [
      node("span", { text: "Episode offset" }),
      offset,
      node("small", { text: "AniList episode = local episode − offset. For local 13 → AniList 1, use 12." }),
    ]),
  ];

  candidates.forEach((media) => {
    const meta = [media.format, media.season, media.seasonYear, media.episodes ? `${media.episodes} ep` : "ongoing/unknown"].filter(Boolean).join(" · ");
    const progress = media.mediaListEntry ? `Your list: ${media.mediaListEntry.status}, episode ${media.mediaListEntry.progress || 0}` : "Not on your list";
    const primary = titleOf(media);
    const aliases = [...new Set([media.title?.romaji, media.title?.english, media.title?.native, ...(media.synonyms || [])].filter((title) => title && title !== primary))].slice(0, 3).join(" · ");
    contents.push(card([
      node("div", { className: "candidate" }, [
        node("div", {}, [
          node("strong", { text: primary }),
          aliases ? node("p", { className: "muted", text: aliases }) : null,
          node("p", { className: "muted", text: meta }),
          node("small", { text: progress }),
        ]),
        node("div", { className: "row" }, [
          button("Use this title", () => {
            rematching = false;
            send({ action: "set-match", seriesKey: selectedKey, mediaId: media.id, offset: offset.value });
          }, "primary", !state.connected),
          node("span", { className: "muted", text: `#${media.id}` }),
        ]),
      ]),
    ]));
  });
  if (Object.prototype.hasOwnProperty.call(state.candidates, selectedKey) && !candidates.length) {
    contents.push(node("p", { className: "muted", text: "No AniList matches yet. Try fewer words, an alternate title, or an AniList ID." }));
  }
  return card(contents);
}

function renderPending() {
  if (!state.pending.length) return null;
  return card([
    heading("Pending sync", String(state.pending.length)),
    ...state.pending.map((item) => {
      const match = state.matches.find((value) => value.seriesKey === item.seriesKey);
      const episode = node("input", {
        type: "number",
        value: item.suggestedEpisode || "",
        min: 1,
        max: item.maxEpisode,
        step: 1,
      });
      return card([
        node("strong", { text: match?.title || item.searchTitle || item.seriesKey }),
        node("span", { text: episodeText(item) }),
        item.needsEpisode ? node("div", { className: "row" }, [
          episode,
          button("Set episode", () => send({ action: "set-episode", id: item.id, episode: episode.value }), "primary"),
          node("small", { text: item.maxEpisode ? `Maximum ${item.maxEpisode}` : "Positive whole numbers only" }),
        ]) : null,
        item.error ? node("p", { className: "error-text", text: item.error }) : null,
        node("div", { className: "row" }, [
          item.error ? button("Retry", () => send({ action: "retry" })) : null,
          item.correctionId ? null : button("Discard", () => {
            if (confirm("Discard this pending sync?")) send({ action: "discard", id: item.id });
          }),
        ]),
      ]);
    }),
  ]);
}

function issueText(issue) {
  if (issue.type === "episode-range") return `The file represents episodes ${issue.start}–${issue.end}.`;
  if (issue.type === "progress-gap") return `This advances progress from ${issue.from} to ${issue.to}, leaving a gap.`;
  if (issue.type === "resumption") return `The AniList entry is ${issue.from}; it will be changed to CURRENT.`;
  if (issue.type === "status-conflict") return "AniList says COMPLETED, but this is not the known final episode. Status will be repaired before progress advances.";
  return issue.type;
}

function renderConfirmations() {
  const values = Object.values(state.confirmations);
  if (!values.length) return null;
  return card([
    heading("Confirm changes", String(values.length)),
    ...values.map((item) => card([
      node("strong", { text: item.title }),
      ...item.issues.map((issue) => node("p", { text: issueText(issue) })),
      node("dl", {}, [node("dt", { text: "Before" }), node("dd", { text: stateText(item.before) }), node("dt", { text: "After" }), node("dd", { text: stateText(item.after) })]),
      node("div", { className: "row" }, [
        button("Apply change", () => send({ action: "confirm-sync", seriesKey: item.seriesKey, fingerprint: item.fingerprint }), "primary"),
        button("Discard", () => {
          if (confirm("Discard these pending episodes?")) send({ action: "discard", ids: item.run.ids });
        }),
      ]),
    ], "error")),
  ]);
}

function renderCorrections() {
  if (!state.corrections.length) return null;
  return card([
    heading("Past progress", String(state.corrections.length)),
    ...state.corrections.map((item) => {
      const content = [node("strong", { text: `${item.oldMatch.title} → ${item.newMatch.title}` })];
      if (item.status === "offer") {
        content.push(
          node("p", { text: "Future episodes use the new match. Do you also want to move progress previously synced by this plugin? This is never automatic." }),
          node("div", { className: "row" }, [
            button("Sync past progress too", () => send({ action: "correct-past", id: item.id }), "primary"),
            button("Keep past progress", () => send({ action: "keep-past", id: item.id })),
          ]),
        );
      } else if (item.status === "conflict") {
        content.push(
          node("p", { className: "error-text", text: "The old AniList entry changed after this plugin wrote it. Choose the exact target state." }),
          node("dl", {}, [
            node("dt", { text: "Original" }), node("dd", { text: stateText(item.original) }),
            node("dt", { text: "Plugin wrote" }), node("dd", { text: stateText(item.pluginWritten) }),
            node("dt", { text: "Current" }), node("dd", { text: stateText(item.current) }),
          ]),
          node("div", { className: "row" }, [
            button("Restore original", () => send({ action: "resolve-correction", id: item.id, target: "original" }), "danger"),
            button("Keep current", () => send({ action: "resolve-correction", id: item.id, target: "keep-current" })),
          ]),
        );
      } else if (item.status === "protected-data") {
        content.push(
          node("p", { className: "error-text", text: item.error }),
          node("p", { text: "Progress on the new title was updated first. The old entry remains so its score, notes, custom lists, and other user-owned data are not erased." }),
          button("Keep old entry", () => send({ action: "keep-past", id: item.id })),
        );
      } else {
        content.push(
          node("p", { text: item.status === "syncing-new" ? "Updating the new title before restoring the old one…" : item.error || "Correction needs attention." }),
          item.status === "cleanup-error" ? button("Retry cleanup", () => send({ action: "retry-correction", id: item.id })) : null,
        );
      }
      return card(content, ["conflict", "cleanup-error", "protected-data"].includes(item.status) ? "error" : "");
    }),
  ]);
}

function renderSavedLists() {
  if (!state.matches.length && !state.ignored.length) return null;
  const details = node("details");
  details.append(node("summary", { text: "Saved title rules" }));
  const contents = node("div", { className: "stack" });
  state.matches.forEach((match) => contents.append(node("div", { className: "row spread" }, [
    node("span", { text: `${match.title}${match.offset ? ` (offset ${match.offset})` : ""}` }),
    button("Rematch", () => {
      selectedKey = match.seriesKey;
      rematching = true;
      queries[selectedKey] = match.title;
      send({ action: "search", seriesKey: selectedKey, query: match.title });
      render();
    }, "link"),
  ])));
  state.ignored.forEach((item) => contents.append(node("div", { className: "row spread" }, [
    node("span", { text: `${item.title} (ignored)` }),
    button("Stop ignoring", () => send({ action: "unignore", seriesKey: item.seriesKey }), "link"),
  ])));
  details.append(contents);
  return card([details]);
}

function renderHistory() {
  if (!state.history.length) return null;
  const details = node("details");
  details.append(node("summary", { text: `Sync history (${state.history.length})` }));
  const list = node("div", { className: "stack" });
  state.history.slice().reverse().slice(0, 30).forEach((record) => list.append(node("div", {}, [
    node("strong", { text: record.title || `AniList #${record.mediaId}` }),
    node("p", { className: "muted", text: `${record.kind === "correction" ? "Correction" : `Episodes ${record.listStart || record.localStart}–${record.listEnd || record.localEnd}`} · ${new Date(record.at).toLocaleString()}` }),
  ])));
  details.append(list);
  return card([
    details,
    button("Clear sync history", () => {
      if (confirm("Clear completed sync records? Pending syncs will remain.")) send({ action: "clear-history" });
    }, "", state.corrections.length > 0),
    state.corrections.length ? node("small", { text: "Resolve past progress first; its sync records are needed for safe correction." }) : null,
  ]);
}

function render() {
  if (!state) return;
  app.replaceChildren();
  app.append(
    node("div", { className: "row spread" }, [node("h1", { text: "AniList Sync" }), node("span", { className: "pill", text: state.connected ? "Online" : "Offline" })]),
  );
  if (state.compatibilityError) app.append(card([node("strong", { text: "Unsupported IINA version" }), node("p", { className: "error-text", text: state.compatibilityError })], "error"));
  if (state.corruptState) app.append(card([node("strong", { text: "Local state is unreadable" }), node("p", { text: "Sync is disabled to protect your AniList account. Use Full reset below." })], "error"));
  if (state.lastError) app.append(card([node("p", { className: "error-text", text: state.lastError }), button("Retry pending", () => send({ action: "retry" }))], "error"));

  const toggle = node("input", { type: "checkbox", checked: state.enabled, disabled: Boolean(state.compatibilityError || state.corruptState) });
  toggle.addEventListener("change", () => send({ action: "toggle", enabled: toggle.checked }));
  app.append(card([
    node("label", { className: "inline-label" }, [toggle, node("strong", { text: "Automatic sync" })]),
    node("small", { text: state.enabled ? "Marks local video files watched at 85%. Seeking counts; paused playback does not." : "Disabled. Pending items are preserved." }),
  ]));

  app.append(renderAccount());
  [renderConfirmations(), renderPending(), renderCorrections(), renderMatcher(), renderSavedLists(), renderHistory()].forEach((value) => value && app.append(value));
  app.append(card([
    heading("Reset"),
    node("p", { className: "muted", text: "Clears the Keychain token value, account, matches, ignored titles, pending work, confirmations, corrections, and sync history." }),
    button("Full reset", () => {
      if (confirm("Completely reset AniList Sync on this Mac? This cannot be undone.")) send({ action: "reset" });
    }, "danger"),
  ]));
}

iina.onMessage("state", (nextState) => {
  state = nextState;
  render();
});

send({ action: "request-state" });
