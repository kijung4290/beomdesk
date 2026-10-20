"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  page: "write",
  features: [],
  templates: [],
  favorites: new Set(),
  category: "전체",
  selected: null,
  visible: 60,
  samples: {},
  previewSequence: 0,
  previewTimer: null,
  draftTimer: null,
  busy: false,
  version: "",
};
const pageNames = {
  write: "문서 만들기",
  tools: "전체 도구",
  favorites: "즐겨찾기",
  edit: "빠른 편집",
  templates: "한글 서식",
  calc: "계산 도구",
  settings: "설정 · 업데이트",
};
const icon = (name) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
};
function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
let toastTimer;
function toast(message, error = false) {
  const item = $("toast");
  item.textContent = message;
  item.classList.toggle("error", error);
  item.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (item.hidden = true), error ? 7000 : 3500);
}
function status(message) {
  $("status-message").textContent = message;
}
function connected() {
  $("connection-dot").classList.add("connected");
  $("connection-label").textContent = "한글 연결됨";
  $("connect").lastChild.textContent = "한글 다시 연결";
}
async function work(action, message) {
  if (state.busy) {
    toast("진행 중인 작업이 끝나면 실행해 주세요.");
    return;
  }
  state.busy = true;
  document.body.classList.add("busy");
  $("create-document").disabled = true;
  status("한글에서 작업하고 있습니다…");
  try {
    const result = await action();
    if (result?.connected) connected();
    if (result !== null && message) {
      toast(message);
      status(message);
    }
    return result;
  } catch (error) {
    const message = error.message.replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    );
    toast(message, true);
    status(
      "작업을 완료하지 못했습니다. 한글의 문서와 선택 위치를 확인해 주세요.",
    );
  } finally {
    state.busy = false;
    document.body.classList.remove("busy");
    $("create-document").disabled = false;
  }
}
function showPage(page) {
  state.page = page;
  document
    .querySelectorAll(".page")
    .forEach((x) => x.classList.toggle("active", x.id === "page-" + page));
  document
    .querySelectorAll("[data-page]")
    .forEach((x) => x.classList.toggle("active", x.dataset.page === page));
  $("breadcrumb").textContent = pageNames[page];
  if (page === "favorites") renderFavorites();
  if (page === "tools") renderTools();
}
document
  .querySelectorAll("[data-page]")
  .forEach((x) => x.addEventListener("click", () => showPage(x.dataset.page)));
function saveDraft() {
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(
    () =>
      window.beom
        .state("save", {
          draft: $("editor").value,
          favorites: [...state.favorites],
        })
        .catch(() => toast("입력 내용을 보관하지 못했습니다.", true)),
    450,
  );
}
async function updatePreview() {
  const sequence = ++state.previewSequence;
  const text = $("editor").value;
  try {
    const result = await window.beom.call("preview", { text });
    if (sequence !== state.previewSequence) return;
    const content = document.createDocumentFragment();
    let tables = 0;
    for (const block of result.blocks) {
      if (block.kind === "table") {
        tables++;
        const table = node("table");
        block.rows.forEach((row, i) => {
          const tr = node("tr");
          row.forEach((value) =>
            tr.append(node(i === 0 ? "th" : "td", "", value)),
          );
          table.append(tr);
        });
        content.append(table);
      } else if (block.kind === "heading")
        content.append(node("h" + block.level, "", block.text));
      else if (block.kind === "gap") content.append(node("div", "gap"));
      else if (block.kind === "bullet")
        content.append(
          node(
            "p",
            "bullet-" + block.level,
            ({ 1: "□ ", 2: "○ ", 3: "- " }[block.level] || "") + block.text,
          ),
        );
      else if (block.kind === "note")
        content.append(node("p", "note", "※ " + block.text));
      else content.append(node("p", "", block.text));
    }
    $("preview").replaceChildren(content);
    $("document-count").textContent =
      text.length.toLocaleString() + "자 · 표 " + tables + "개";
  } catch (error) {
    if (sequence === state.previewSequence)
      $("preview").replaceChildren(node("p", "note", error.message));
  }
}
$("editor").addEventListener("input", () => {
  saveDraft();
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(updatePreview, 230);
});
$("load-sample").addEventListener("click", () => {
  $("editor").value = state.samples[$("sample-select").value];
  updatePreview();
  saveDraft();
});
$("open-text").addEventListener("click", () =>
  work(async () => {
    const result = await window.beom.file("open_text");
    if (result) {
      $("editor").value = result.text;
      updatePreview();
      saveDraft();
    }
    return result;
  }, "텍스트를 불러왔습니다."),
);
$("save-text").addEventListener("click", () =>
  work(
    () => window.beom.file("save_text", { text: $("editor").value }),
    "입력 내용을 저장했습니다.",
  ),
);
$("export-html").addEventListener("click", () =>
  work(
    () => window.beom.file("export_html", { text: $("editor").value }),
    "HTML 문서를 저장했습니다.",
  ),
);
$("connect").addEventListener("click", () =>
  work(() => window.beom.call("connect"), "한글에 연결했습니다."),
);
$("create-document").addEventListener("click", () =>
  work(
    () => window.beom.call("render", { text: $("editor").value }),
    "새 한글 문서를 만들었습니다.",
  ),
);
$("save-hwp").addEventListener("click", () =>
  work(() => window.beom.file("save_hwp"), "한글 문서를 저장했습니다."),
);
document
  .querySelectorAll("[data-command]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      work(
        () => window.beom.call("command", { action: button.dataset.command }),
        button.textContent + " 적용",
      ),
    ),
  );
$("apply-font").addEventListener("click", () =>
  work(
    () =>
      window.beom.call("font", {
        family: $("font-family").value,
        size: Number($("font-size").value),
      }),
    "글꼴을 적용했습니다.",
  ),
);
$("apply-spacing").addEventListener("click", () =>
  work(
    () =>
      window.beom.call("spacing", { percent: Number($("line-spacing").value) }),
    "줄 간격을 적용했습니다.",
  ),
);
$("cell-margins").addEventListener("click", () =>
  work(() => window.beom.call("cell_margins"), "셀 여백을 변경했습니다."),
);

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveDraft();
  renderTools();
  renderFavorites();
  if (state.selected?.id === id) renderDetail(state.selected);
}
function createToolCard(feature) {
  const card = node(
    "article",
    "tool-card" + (state.selected?.id === feature.id ? " selected" : ""),
  );
  card.tabIndex = 0;
  card.dataset.feature = String(feature.id);
  const top = node("div", "tool-card-top");
  top.append(node("span", "tool-category", feature.category));
  const favorite = node(
    "button",
    "favorite-button" + (state.favorites.has(feature.id) ? " active" : ""),
  );
  favorite.setAttribute("aria-label", feature.label + " 즐겨찾기");
  favorite.title = "즐겨찾기";
  favorite.append(icon("star"));
  favorite.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(feature.id);
  });
  top.append(favorite);
  const foot = node("div", "tool-card-footer");
  foot.append(
    node(
      "span",
      feature.direct ? "direct-indicator" : "",
      feature.direct ? "바로 적용" : "입력 화면",
    ),
    icon("arrow"),
  );
  card.append(
    top,
    node("h3", "", feature.label),
    node("span", "tool-context", feature.screen.replace(/(창|프레임)$/, "")),
    foot,
  );
  const select = () => {
    state.selected = feature;
    if (state.page === "favorites") {
      showPage("tools");
      $("tool-search").value = feature.label;
      state.category = "전체";
      state.visible = 60;
      renderCategories();
    }
    renderDetail(feature);
    renderTools();
  };
  card.addEventListener("click", select);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      select();
    }
  });
  card.addEventListener("dblclick", () => executeFeature(feature));
  return card;
}
function renderCategories() {
  const names = ["전체", ...new Set(state.features.map((x) => x.category))];
  $("tool-categories").replaceChildren(
    ...names.map((name) => {
      const button = node(
        "button",
        "category-button" + (name === state.category ? " active" : ""),
        name,
      );
      button.addEventListener("click", () => {
        state.category = name;
        state.visible = 60;
        renderCategories();
        renderTools();
      });
      return button;
    }),
  );
}
function renderTools() {
  const query = $("tool-search").value.trim().toLocaleLowerCase();
  const direct = $("tool-mode").value === "direct";
  const matches = state.features.filter(
    (x) =>
      (state.category === "전체" || x.category === state.category) &&
      (!direct || x.direct) &&
      (!query ||
        (x.label + " " + x.screen + " " + x.category)
          .toLocaleLowerCase()
          .includes(query)),
  );
  $("tool-result-count").textContent =
    matches.length.toLocaleString() + "개의 도구";
  $("tool-grid").replaceChildren(
    ...matches.slice(0, state.visible).map(createToolCard),
  );
  if (!matches.length)
    $("tool-grid").append(
      empty(
        "찾은 도구가 없어요",
        "검색어를 짧게 바꾸거나 다른 분류를 선택해 주세요.",
        "search",
      ),
    );
  $("more-tools").hidden = matches.length <= state.visible;
}
function renderDetail(feature) {
  const box = $("tool-detail");
  const imageWrap = node("div", "detail-image");
  const image = node("img");
  image.src =
    "beom://assets/" +
    feature.image.split("/").map(encodeURIComponent).join("/");
  image.alt = feature.label;
  imageWrap.append(image);
  const primary = node(
    "button",
    "button button-primary full",
    feature.direct ? "한글에 바로 적용" : "입력 화면 열기",
  );
  primary.addEventListener("click", () => executeFeature(feature));
  const original = node(
    "button",
    "button detail-secondary",
    "원본 도구 화면 보기",
  );
  original.addEventListener("click", () =>
    work(
      () => window.beom.call("open_feature", { id: feature.id }),
      "도구 화면을 열었습니다.",
    ),
  );
  const favorite = node(
    "button",
    "text-button detail-secondary",
    state.favorites.has(feature.id)
      ? "★ 즐겨찾기에서 빼기"
      : "☆ 즐겨찾기에 넣기",
  );
  favorite.addEventListener("click", () => toggleFavorite(feature.id));
  box.replaceChildren(
    node(
      "span",
      "detail-category",
      feature.category + " / " + feature.screen.replace(/(창|프레임)$/, ""),
    ),
    imageWrap,
    node("h2", "", feature.label),
    node(
      "p",
      "",
      feature.direct
        ? "한글에서 편집할 위치나 영역을 선택한 뒤 적용하세요."
        : "추가 입력이 필요한 도구입니다. 화면을 열고 필요한 값을 넣어 사용하세요.",
    ),
    primary,
    original,
    favorite,
  );
}
function executeFeature(feature) {
  return work(
    () => window.beom.call("execute_feature", { id: feature.id }),
    feature.direct ? "도구를 적용했습니다." : "입력 화면을 열었습니다.",
  );
}
function empty(title, description, iconName) {
  const div = node("div", "empty-state");
  div.append(icon(iconName), node("h2", "", title), node("p", "", description));
  return div;
}
function renderFavorites() {
  const favorites = state.features.filter((x) => state.favorites.has(x.id));
  $("favorites-grid").replaceChildren(...favorites.map(createToolCard));
  if (!favorites.length)
    $("favorites-grid").append(
      empty(
        "자주 쓰는 도구를 모아보세요",
        "전체 도구에서 별표를 누르면 여기에 나타납니다.",
        "star",
      ),
    );
}
$("tool-search").addEventListener("input", () => {
  state.visible = 60;
  renderTools();
});
$("tool-mode").addEventListener("change", () => {
  state.visible = 60;
  renderTools();
});
$("more-tools").addEventListener("click", () => {
  state.visible += 60;
  renderTools();
});
function renderTemplates() {
  const query = $("template-search").value.trim().toLocaleLowerCase();
  const list = state.templates.filter((x) =>
    (x.name + " " + x.category).toLocaleLowerCase().includes(query),
  );
  $("template-grid").replaceChildren(
    ...list.map((template) => {
      const card = node("article", "template-card");
      const extension = template.name.split(".").pop().toUpperCase();
      const actions = node("div", "template-actions");
      const copy = node("button", "button", "파일 복사");
      copy.addEventListener("click", () =>
        work(
          () => window.beom.file("template_copy", { id: template.id }),
          "서식 파일을 복사했습니다.",
        ),
      );
      const open = node("button", "button button-primary", "한글에서 열기");
      open.addEventListener("click", () =>
        work(
          () => window.beom.call("template_open", { id: template.id }),
          "서식 작업 사본을 열었습니다.",
        ),
      );
      actions.append(copy, open);
      card.append(
        node("span", "template-extension", extension),
        node("h3", "", template.name.replace(/\.hwpx?$/i, "")),
        node("p", "", template.category),
        actions,
      );
      return card;
    }),
  );
  if (!list.length)
    $("template-grid").append(
      empty(
        "일치하는 서식이 없어요",
        "다른 이름이나 기관명으로 검색해 주세요.",
        "folder",
      ),
    );
}
$("template-search").addEventListener("input", renderTemplates);
$("calculate-date").addEventListener("click", () =>
  work(async () => {
    const result = await window.beom.call("date_difference", {
      start: $("date-start").value,
      end: $("date-end").value,
    });
    $("date-result").textContent = result.days.toLocaleString() + "일";
    $("date-detail").textContent =
      result.days >= 0
        ? "시작일 포함 " + (result.days + 1).toLocaleString() + "일"
        : "종료일이 시작일보다 빠릅니다.";
    return result;
  }, "날짜 차이를 계산했습니다."),
);
$("calculate-number").addEventListener("click", () =>
  work(async () => {
    const result = await window.beom.call("calculate", {
      expression: $("expression")
        .value.replaceAll("×", "*")
        .replaceAll("÷", "/"),
    });
    $("number-result").textContent = result.value;
    return result;
  }, "계산했습니다."),
);
$("copy-number").addEventListener("click", () =>
  window.beom
    .file("copy_text", { text: $("number-result").textContent })
    .then(() => toast("결과를 복사했습니다."))
    .catch(() => toast("복사하지 못했습니다.", true)),
);
function renderUpdate(value) {
  const messages = {
    idle: ["최신 상태를 확인할 수 있어요", "새 기능과 개선 사항을 확인하세요."],
    checking: ["새 버전을 확인하고 있습니다", "잠시만 기다려 주세요."],
    available: [
      `v${value.version} 업데이트가 있습니다`,
      "다운로드 후 원할 때 다시 시작할 수 있어요.",
    ],
    current: [
      "최신 버전을 사용하고 있습니다",
      "새 업데이트가 나오면 알려드릴게요.",
    ],
    downloading: ["업데이트 다운로드 중", `${value.percent || 0}% 완료`],
    ready: [
      "업데이트 준비가 끝났습니다",
      "문서 작업을 저장한 뒤 다시 시작해 주세요.",
    ],
    error: [
      "업데이트를 확인하지 못했습니다",
      value.message || "인터넷 연결을 확인하고 다시 시도해 주세요.",
    ],
    development: [
      "개발 실행 중입니다",
      "배포된 앱에서 업데이트를 사용할 수 있습니다.",
    ],
    "not-published": [
      "아직 게시된 업데이트가 없습니다",
      "첫 배포가 올라오면 자동으로 확인할 수 있어요.",
    ],
  };
  const [title, description] = messages[value.status] || messages.idle;
  $("update-title").textContent = title;
  $("update-description").textContent = description;
  $("download-update").hidden = value.status !== "available";
  $("install-update").hidden = value.status !== "ready";
  $("update-progress").hidden = value.status !== "downloading";
  $("update-progress").value = value.percent || 0;
  $("check-update").disabled = ["checking", "downloading"].includes(
    value.status,
  );
  if (value.status === "available")
    $("status-right").textContent = "새 버전 v" + value.version + " 사용 가능";
}
$("check-update").addEventListener("click", async () =>
  renderUpdate(await window.beom.update("check")),
);
$("download-update").addEventListener("click", async () =>
  renderUpdate(await window.beom.update("download")),
);
$("install-update").addEventListener("click", () =>
  window.beom.update("install").catch((error) => toast(error.message, true)),
);
$("auto-check").addEventListener("change", () =>
  window.beom.state("save", { autoCheck: $("auto-check").checked }),
);
window.beom.onEvent((event) => {
  if (event.event === "update") renderUpdate(event.value);
  if (event.event === "tool-error") {
    toast(event.message, true);
    status(event.message);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    $("create-document").click();
  }
  if (event.ctrlKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    $("save-text").click();
  }
  if (event.ctrlKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    showPage("tools");
    $("tool-search").focus();
  }
});
async function initialize() {
  try {
    const [bootstrap, profile] = await Promise.all([
      window.beom.call("bootstrap"),
      window.beom.state("get"),
    ]);
    const order = [
      "기본",
      "문자",
      "표",
      "표세부",
      "블록",
      "이동",
      "편리",
      "기본서식",
      "가이드",
      "지자체",
      "중앙",
      "공기업",
      "교직",
      "국방",
    ];
    bootstrap.features.sort(
      (a, b) =>
        (order.indexOf(a.category) < 0 ? 99 : order.indexOf(a.category)) -
          (order.indexOf(b.category) < 0 ? 99 : order.indexOf(b.category)) ||
        a.label.localeCompare(b.label, "ko"),
    );
    Object.assign(state, {
      features: bootstrap.features,
      templates: bootstrap.templates,
      samples: bootstrap.samples,
      version: profile.version,
    });
    state.favorites = new Set(profile.favorites || []);
    $("sidebar-version").textContent =
      "v" +
      profile.version +
      " · " +
      (profile.mode === "portable" ? "무설치형" : "설치형");
    $("current-version").textContent =
      "현재 v" +
      profile.version +
      " · " +
      (profile.mode === "portable" ? "무설치형" : "설치형");
    $("nav-count").textContent = state.features.length.toLocaleString();
    $("tool-total").textContent =
      state.features.length.toLocaleString() + "개 도구";
    $("template-total").textContent = state.templates.length + "개 서식";
    $("sample-select").replaceChildren(
      ...Object.keys(bootstrap.samples).map((name) => {
        const option = node("option", "", name);
        option.value = name;
        return option;
      }),
    );
    $("editor").value = profile.draft || Object.values(bootstrap.samples)[0];
    $("auto-check").checked = profile.autoCheck !== false;
    const today = new Date();
    const iso = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    $("date-start").value = iso;
    $("date-end").value = iso;
    renderCategories();
    renderTools();
    renderTemplates();
    renderFavorites();
    renderUpdate(profile.updates);
    await updatePreview();
    $("engine-status").textContent = "문서 엔진 준비됨";
    status("작업 준비가 끝났습니다.");
    document.documentElement.dataset.ready = "true";
  } catch (error) {
    $("engine-status").textContent = "문서 엔진 확인 필요";
    toast(error.message, true);
    status("앱을 다시 시작하거나 설치 파일을 다시 실행해 주세요.");
    document.documentElement.dataset.error = error.message;
  }
}
initialize();
window.addEventListener("beforeunload", () => {
  window.beom.flushDraft({draft: $("editor").value, favorites: [...state.favorites]});
});
