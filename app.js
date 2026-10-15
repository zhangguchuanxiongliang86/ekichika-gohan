// 駅チカごはん personal-1：お気に入り・検索履歴
(() => {
  "use strict";

  function init() {
    const $ = selector => document.querySelector(selector);

    const form = $("#search-form");
    const stationInput = $("#station");
    const searchButton = $("#search-button");
    const genreButtons = [...document.querySelectorAll(".genre")];
    const statusBox = $("#status");
    const resultsBox = $("#results");
    const resultCount = $("#result-count");
    const resultsTitle = $("#results-title");

    const historyBox = $("#history-list");
    const historyEmpty = $("#history-empty");
    const clearHistoryButton = $("#clear-history");

    const favoritesBox = $("#favorites-list");
    const favoritesCount = $("#favorites-count");
    const favoritesEmpty = $("#favorites-empty");
    const noticeBox = $("#personal-notice");

    const required = {
      form,
      stationInput,
      searchButton,
      statusBox,
      resultsBox,
      resultCount,
      resultsTitle
    };

    const missing = Object.entries(required)
      .filter(([, element]) => !element)
      .map(([name]) => name);

    if (missing.length) {
      console.error("必要なHTML要素がありません:", missing);
      return;
    }

    const SEARCH_RADIUS = 800;
    const MAX_RESULTS = 30;
    const MAX_FAVORITES = 100;

    const FAVORITES_KEY = "ekichika:personal:favorites:v1";
    const HISTORY_KEY = "ekichika:personal:history:v1";

    const STATION_TTL = 7 * 24 * 60 * 60 * 1000;
    const RESTAURANT_TTL = 30 * 60 * 1000;
    const EMPTY_TTL = 2 * 60 * 1000;

    const genreLabels = {
      all: "すべて",
      ramen: "ラーメン",
      japanese: "和食",
      cafe: "カフェ",
      curry: "カレー",
      chinese: "中華",
      yakiniku: "焼肉",
      izakaya: "居酒屋",
      italian: "洋食・イタリアン",
      sushi: "寿司"
    };

    const genreMatchers = {
      ramen: /ramen|ラーメン|らーめん|拉麺|中華そば/i,
      japanese:
        /japanese|和食|sushi|寿司|すし|鮨|tempura|天ぷら|udon|うどん|soba|そば|定食/i,
      cafe: /cafe|café|coffee|カフェ|喫茶|コーヒー/i,
      curry: /curry|カレー/i,
      chinese: /chinese|中華|餃子|dumpling/i,
      yakiniku: /yakiniku|焼肉|barbecue|bbq/i,
      izakaya: /izakaya|居酒屋|pub|酒場/i,
      italian: /italian|pizza|pasta|洋食|イタリアン|ピザ|パスタ/i,
      sushi: /sushi|寿司|すし|鮨/i
    };

    const initialButton = genreButtons.find(button =>
      button.classList.contains("active") ||
      button.getAttribute("aria-pressed") === "true"
    );

    let selectedGenre =
      Object.prototype.hasOwnProperty.call(
        genreLabels,
        initialButton?.dataset.genre
      )
        ? initialButton.dataset.genre
        : "all";

    let isSearching = false;
    let cachedRestaurants = null;
    let searchedStation = "";
    let lastStationRequestAt = 0;

    const memoryCache = new Map();
    const originalButtonHTML = searchButton.innerHTML;
    const wait = ms =>
      new Promise(resolve => setTimeout(resolve, ms));

    function notify(message) {
      if (noticeBox) {
        noticeBox.textContent = message;
      }
    }

    function setStatus(message, icon = "🔎") {
      const iconElement = document.createElement("div");
      iconElement.className = "status-icon";
      iconElement.textContent = icon;
      iconElement.setAttribute("aria-hidden", "true");

      const paragraph = document.createElement("p");
      paragraph.textContent = message;
      paragraph.style.whiteSpace = "pre-line";

      statusBox.replaceChildren(iconElement, paragraph);
      statusBox.hidden = false;
    }

    function readArray(key) {
      try {
        const value = JSON.parse(
          localStorage.getItem(key) || "[]"
        );
        return Array.isArray(value) ? value : [];
      } catch {
        notify(
          "保存データを読み込めませんでした。" +
          "この画面内では引き続き使えます。"
        );
        return [];
      }
    }

    function saveArray(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        notify(
          "端末に保存できませんでした。" +
          "この画面を閉じると変更が失われる場合があります。"
        );
        return false;
      }
    }

    function readCache(key) {
      let entry = memoryCache.get(key);

      if (!entry) {
        try {
          entry = JSON.parse(
            localStorage.getItem(key) || "null"
          );
        } catch {
          return null;
        }
      }

      if (
        !entry ||
        !Number.isFinite(entry.expiresAt) ||
        Date.now() >= entry.expiresAt ||
        !Object.prototype.hasOwnProperty.call(entry, "value")
      ) {
        memoryCache.delete(key);

        try {
          localStorage.removeItem(key);
        } catch {}

        return null;
      }

      memoryCache.set(key, entry);
      return entry.value;
    }

    function writeCache(key, value, ttl) {
      const entry = {
        expiresAt: Date.now() + ttl,
        value
      };

      memoryCache.set(key, entry);

      try {
        localStorage.setItem(key, JSON.stringify(entry));
      } catch {
        // 保存できない場合も、画面内のキャッシュは利用します。
      }
    }

    function normalizeStation(value) {
      return String(value || "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .replace(/駅$/, "");
    }

    function tagsOf(item) {
      return item.tags || {};
    }

    function nameOf(item) {
      const tags = tagsOf(item);
      return (
        tags["name:ja"] ||
        tags.name ||
        tags.brand ||
        "店名未登録のお店"
      );
    }

    function typeOf(item) {
      const tags = tagsOf(item);
      const values = [
        tags.cuisine,
        tags.amenity,
        tags.shop
      ]
        .filter(Boolean)
        .flatMap(value => String(value).split(";"));

      return [...new Set(values)].join("・") || "飲食店";
    }

    function addressOf(item) {
      const tags = tagsOf(item);

      return (
        tags["addr:full"] ||
        [
          tags["addr:province"] || tags["addr:state"],
          tags["addr:city"],
          tags["addr:suburb"],
          tags["addr:quarter"],
          tags["addr:neighbourhood"],
          tags["addr:street"] || tags["addr:place"],
          tags["addr:housenumber"]
        ]
          .filter(Boolean)
          .join("") ||
        "住所情報は登録されていません"
      );
    }

    function matchesGenre(item, genre) {
      if (genre === "all") return true;

      const matcher = genreMatchers[genre];
      if (!matcher) return false;

      const tags = tagsOf(item);

      return matcher.test(
        [
          tags.name,
          tags["name:ja"],
          tags.cuisine,
          tags.amenity,
          tags.shop,
          tags.description,
          tags["description:ja"],
          tags.brand
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    function distanceMeters(a, b) {
      const rad = value => value * Math.PI / 180;
      const dLat = rad(b.lat - a.lat);
      const dLon = rad(b.lon - a.lon);

      const raw =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) *
          Math.cos(rad(b.lat)) *
          Math.sin(dLon / 2) ** 2;

      const value = Math.max(0, Math.min(1, raw));

      return (
        6371000 *
        2 *
        Math.atan2(
          Math.sqrt(value),
          Math.sqrt(1 - value)
        )
      );
    }

    function formatDistance(meters) {
      if (meters < 10) return "10m未満";
      if (meters < 1000) {
        return `約${Math.round(meters / 10) * 10}m`;
      }
      return `約${(meters / 1000).toFixed(1)}km`;
    }

    function favoriteKey(item) {
      return `${item.type}/${item.id}`;
    }

    function validItem(item) {
      return (
        item &&
        ["node", "way", "relation"].includes(item.type) &&
        Number.isSafeInteger(item.id) &&
        item.id > 0 &&
        Number.isFinite(item.lat) &&
        Math.abs(item.lat) <= 90 &&
        Number.isFinite(item.lon) &&
        Math.abs(item.lon) <= 180 &&
        item.tags &&
        typeof item.tags === "object" &&
        !Array.isArray(item.tags)
      );
    }

    function loadFavorites() {
      const seen = new Set();

      return readArray(FAVORITES_KEY)
        .filter(item => {
          if (!validItem(item)) return false;

          const key = favoriteKey(item);
          if (seen.has(key)) return false;

          seen.add(key);
          return true;
        })
        .slice(0, MAX_FAVORITES);
    }

    function loadHistory() {
      return [
        ...new Set(
          readArray(HISTORY_KEY)
            .filter(value => typeof value === "string")
            .map(value =>
              value.normalize("NFKC").trim().slice(0, 160)
            )
            .filter(Boolean)
        )
      ].slice(0, 5);
    }

    let favorites = loadFavorites();
    let stationHistory = loadHistory();

    function updateFavoriteButton(button) {
      const saved = favorites.some(
        item =>
          favoriteKey(item) === button.dataset.favoriteKey
      );

      button.textContent = saved
        ? "★ 保存済み（押すと解除）"
        : "☆ お気に入りに保存";

      button.setAttribute("aria-pressed", String(saved));
      button.classList.toggle("is-saved", saved);
    }

    function refreshFavoriteButtons() {
      document
        .querySelectorAll("[data-favorite-key]")
        .forEach(updateFavoriteButton);
    }

    function makeLink(text, href, primary = false) {
      const link = document.createElement("a");

      link.className = primary
        ? "card-link primary"
        : "card-link";

      link.textContent = text;
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      return link;
    }

    function createRestaurantCard(
      item,
      station,
      savedView = false
    ) {
      const article = document.createElement("article");
      article.className = "restaurant-card";

      const top = document.createElement("div");
      top.className = "card-top";

      const heading = document.createElement("h3");
      heading.textContent = nameOf(item);

      const badge = document.createElement("span");
      badge.className = "type-badge";
      badge.textContent = typeOf(item);

      top.append(heading, badge);

      const address = document.createElement("p");
      address.className = "address";

      address.textContent = savedView
        ? (
          `📍 保存時の検索駅：${item.savedStation || "未登録"}` +
          `・${addressOf(item)}`
        )
        : (
          `📍 直線距離 ${formatDistance(item.distance)}` +
          `・${addressOf(item)}`
        );

      const actions = document.createElement("div");
      actions.className = "card-actions";

      const mapURL =
        "https://www.openstreetmap.org/" +
        `?mlat=${item.lat}&mlon=${item.lon}` +
        `#map=18/${item.lat}/${item.lon}`;

      const searchURL =
        "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(`${nameOf(item)} ${station}`);

      actions.append(
        makeLink("地図で見る", mapURL),
        makeLink("店舗情報", searchURL, true)
      );

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "favorite-button";
      saveButton.dataset.favoriteKey = favoriteKey(item);

      saveButton.addEventListener("click", () => {
        toggleFavorite(item, station);
      });

      updateFavoriteButton(saveButton);
      article.append(top, address, actions, saveButton);

      return article;
    }

    function renderFavorites() {
      if (!favoritesBox) return;

      favoritesBox.replaceChildren();

      if (favoritesCount) {
        favoritesCount.textContent = `${favorites.length}件`;
      }

      if (favoritesEmpty) {
        favoritesEmpty.hidden = favorites.length > 0;
      }

      const fragment = document.createDocumentFragment();

      favorites.forEach(item => {
        fragment.appendChild(
          createRestaurantCard(
            item,
            item.savedStation || "",
            true
          )
        );
      });

      favoritesBox.appendChild(fragment);
    }

    function toggleFavorite(item, station) {
      const key = favoriteKey(item);
      const exists = favorites.some(
        saved => favoriteKey(saved) === key
      );

      if (exists) {
        favorites = favorites.filter(
          saved => favoriteKey(saved) !== key
        );
      } else {
        if (!validItem(item)) {
          notify("このお店の情報が不完全なため保存できません。");
          return;
        }

        if (favorites.length >= MAX_FAVORITES) {
          notify(
            "お気に入りは100件までです。" +
            "不要なお店を解除してから保存してください。"
          );
          return;
        }

        favorites.unshift({
          type: item.type,
          id: item.id,
          lat: item.lat,
          lon: item.lon,
          tags: { ...tagsOf(item) },
          savedStation: String(station).slice(0, 160),
          savedAt: Date.now()
        });
      }

      const persisted = saveArray(
        FAVORITES_KEY,
        favorites
      );

      refreshFavoriteButtons();
      renderFavorites();

      if (persisted) {
        notify(
          exists
            ? "お気に入りを解除しました。"
            : "お気に入りに保存しました。"
        );
      }
    }

    function renderHistory() {
      if (!historyBox) return;

      historyBox.replaceChildren();

      if (historyEmpty) {
        historyEmpty.hidden = stationHistory.length > 0;
      }

      stationHistory.forEach(station => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "history-chip";
        button.textContent = station;
        button.disabled = isSearching;

        button.addEventListener("click", () => {
          if (isSearching) return;

          stationInput.value = station;
          stationInput.focus();

          notify(
            `${station}を入力しました。` +
            "ジャンルを選んで「お店を探す」を押してください。"
          );
        });

        historyBox.appendChild(button);
      });
    }

    function rememberStation(station) {
      const name = station
        .normalize("NFKC")
        .trim()
        .slice(0, 160);

      const key = normalizeStation(name);

      stationHistory = [
        name,
        ...stationHistory.filter(
          saved => normalizeStation(saved) !== key
        )
      ].slice(0, 5);

      saveArray(HISTORY_KEY, stationHistory);
      renderHistory();
    }

    function renderCurrentResults() {
      if (cachedRestaurants === null) return;

      const matches = cachedRestaurants.filter(
        item => matchesGenre(item, selectedGenre)
      );

      const visible = matches.slice(0, MAX_RESULTS);

      resultsTitle.textContent =
        `${searchedStation}周辺 / ${genreLabels[selectedGenre]}`;

      resultCount.textContent =
        matches.length > MAX_RESULTS
          ? `${matches.length}件中 ${visible.length}件表示`
          : `${matches.length}件`;

      resultsBox.replaceChildren();

      if (!matches.length) {
        setStatus(
          "このジャンルのお店が見つかりませんでした。\n" +
          "別のジャンルや駅名でも試してください。",
          "🫤"
        );
        return;
      }

      const fragment = document.createDocumentFragment();

      visible.forEach(item => {
        fragment.appendChild(
          createRestaurantCard(item, searchedStation)
        );
      });

      resultsBox.appendChild(fragment);
      statusBox.hidden = true;
    }

    function updateGenreButtons() {
      genreButtons.forEach(button => {
        const active =
          button.dataset.genre === selectedGenre;

        button.classList.toggle("active", active);
        button.setAttribute(
          "aria-pressed",
          String(active)
        );
      });
    }

    function setSearching(searching) {
      isSearching = searching;
      searchButton.disabled = searching;
      stationInput.disabled = searching;

      genreButtons.forEach(button => {
        button.disabled = searching;
      });

      document
        .querySelectorAll(".history-chip")
        .forEach(button => {
          button.disabled = searching;
        });

      form.setAttribute("aria-busy", String(searching));

      if (searching) {
        searchButton.textContent = "⏳ 検索しています…";
      } else {
        searchButton.innerHTML = originalButtonHTML;
      }
    }

    async function fetchAPI(
      url,
      timeout,
      restaurantRequest = false
    ) {
      const controller = new AbortController();
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          const error = new Error(
            response.status === 429
              ? (
                "検索サーバーの利用制限に達しました。" +
                "時間をおいて再検索してください。"
              )
              : (
                "検索サーバーでエラーが発生しました" +
                `（HTTP ${response.status}）。`
              )
          );

          error.retryable =
            restaurantRequest &&
            [502, 503, 504].includes(response.status);

          throw error;
        }

        return await response.json();
      } catch (error) {
        if (timedOut) {
          throw new Error(
            "通信がタイムアウトしました。" +
            "少し時間をおいて再検索してください。"
          );
        }

        if (error instanceof TypeError) {
          const networkError = new Error(
            "検索サーバーの応答を受け取れませんでした。" +
            "通信経路やサーバー側の問題の可能性があります。"
          );

          networkError.retryable = restaurantRequest;
          throw networkError;
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function fetchOverpassJSON(url) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await fetchAPI(url, 60000, true);
        } catch (error) {
          if (
            attempt !== 0 ||
            error.retryable !== true
          ) {
            throw error;
          }

          console.warn(
            "店舗検索を15秒後に1回だけ再試行:",
            error
          );

          setStatus(
            "店舗検索サーバーとの通信が一時的に失敗しました。\n" +
            "15秒待って、もう一度だけ自動で試します。",
            "⏳"
          );

          await wait(15000);

          setStatus(
            "店舗情報を再取得しています。\n" +
            "そのままお待ちください。",
            "⏳"
          );
        }
      }
    }

    async function geocodeStation(station) {
      const normalized = normalizeStation(station);
      const key =
        `ekichika:station:personal-1:${normalized}`;

      const cached = readCache(key);

      if (
        cached &&
        Number.isFinite(cached.lat) &&
        Number.isFinite(cached.lon)
      ) {
        return cached;
      }

      const delay = Math.max(
        0,
        1100 - (Date.now() - lastStationRequestAt)
      );

      if (delay > 0) await wait(delay);
      lastStationRequestAt = Date.now();

      const query = /駅$/.test(station)
        ? station
        : `${station}駅`;

      const params = new URLSearchParams({
        format: "jsonv2",
        limit: "10",
        countrycodes: "jp",
        q: query,
        "accept-language": "ja"
      });

      const places = await fetchAPI(
        `https://nominatim.openstreetmap.org/search?${params}`,
        15000
      );

      if (!Array.isArray(places) || !places.length) {
        throw new Error(
          "駅が見つかりませんでした。" +
          "都道府県名を添えるなど、入力を変えてください。"
        );
      }

      const isStation = place => {
        const category = place.category || place.class;

        return (
          (
            category === "railway" &&
            ["station", "halt", "tram_stop"].includes(
              place.type
            )
          ) ||
          (
            category === "public_transport" &&
            place.type === "station"
          )
        );
      };

      const stationCandidates = places.filter(isStation);

      const exactStation = stationCandidates.find(
        place =>
          normalizeStation(place.name) === normalized
      );

      const nameCandidate = places.find(place => {
        const name = String(place.name || "").trim();

        return (
          /駅$/.test(name) &&
          normalizeStation(name) === normalized
        );
      });

      const best =
        exactStation ||
        stationCandidates[0] ||
        nameCandidate;

      if (!best) {
        throw new Error(
          "駅の候補を特定できませんでした。" +
          "都道府県名を添えるなど、入力を変えてください。"
        );
      }

      const center = {
        lat: Number(best.lat),
        lon: Number(best.lon),
        displayName: best.display_name || query
      };

      if (
        !Number.isFinite(center.lat) ||
        !Number.isFinite(center.lon)
      ) {
        throw new Error("駅の位置情報を取得できませんでした。");
      }

      writeCache(key, center, STATION_TTL);
      return center;
    }

    async function fetchRestaurants(center) {
      const key =
        `ekichika:restaurants:personal-1:${SEARCH_RADIUS}:` +
        `${center.lat.toFixed(6)},${center.lon.toFixed(6)}`;

      const cached = readCache(key);

      if (
        Array.isArray(cached) &&
        cached.every(item =>
          validItem(item) &&
          Number.isFinite(item.distance)
        )
      ) {
        return cached;
      }

      const query = `
[out:json][25];
nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream)$"]
(around:${SEARCH_RADIUS},${center.lat},${center.lon});
out body center qt;
      `.trim();

      const params = new URLSearchParams({
        data: query
      });

      const data = await fetchOverpassJSON(
        `https://overpass-api.de/api/interpreter?${params}`
      );

      if (data.remark) {
        console.warn("Overpassの応答:", data.remark);

        throw new Error(
          "店舗検索を完了できませんでした。" +
          "少し時間をおいて再検索してください。"
        );
      }

      if (!Array.isArray(data.elements)) {
        throw new Error(
          "お店の情報を正しく取得できませんでした。"
        );
      }

      const seen = new Set();
      const restaurants = [];

      for (const element of data.elements) {
        const rawLat =
          element.lat ?? element.center?.lat;
        const rawLon =
          element.lon ?? element.center?.lon;

        if (rawLat == null || rawLon == null) continue;

        const item = {
          type: element.type,
          id: element.id,
          tags: tagsOf(element),
          lat: Number(rawLat),
          lon: Number(rawLon)
        };

        if (!validItem(item)) continue;

        const id = favoriteKey(item);
        if (seen.has(id)) continue;
        seen.add(id);

        item.distance = distanceMeters(center, item);

        if (item.distance > SEARCH_RADIUS) continue;

        restaurants.push(item);
      }

      restaurants.sort(
        (a, b) => a.distance - b.distance
      );

      writeCache(
        key,
        restaurants,
        restaurants.length
          ? RESTAURANT_TTL
          : EMPTY_TTL
      );

      return restaurants;
    }

    genreButtons.forEach(button => {
      button.type = "button";

      button.addEventListener("click", event => {
        event.preventDefault();

        if (isSearching) return;

        const genre = button.dataset.genre;

        if (
          !Object.prototype.hasOwnProperty.call(
            genreLabels,
            genre
          )
        ) {
          return;
        }

        selectedGenre = genre;
        updateGenreButtons();
        renderCurrentResults();
      });
    });

    clearHistoryButton?.addEventListener("click", () => {
      stationHistory = [];

      const persisted = saveArray(
        HISTORY_KEY,
        stationHistory
      );

      renderHistory();

      if (persisted) {
        notify("検索履歴を消しました。");
      }
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();

      if (isSearching) return;

      const station = stationInput.value
        .normalize("NFKC")
        .trim();

      if (!station) {
        setStatus("駅名を入力してください。", "⚠️");
        stationInput.focus();
        return;
      }

      setSearching(true);
      cachedRestaurants = null;
      resultsBox.replaceChildren();

      resultCount.textContent = "検索中";
      resultsTitle.textContent = `${station}周辺`;
      setStatus("駅の位置を確認しています…", "⏳");

      try {
        let center;

        try {
          center = await geocodeStation(station);
        } catch (error) {
          throw new Error(
            "【駅の検索】" +
            (
              error instanceof Error
                ? error.message
                : "取得に失敗しました。"
            )
          );
        }

        setStatus(
          "駅の位置を確認できました。\n" +
          "近くのお店を調べています…",
          "⏳"
        );

        let restaurants;

        try {
          restaurants = await fetchRestaurants(center);
        } catch (error) {
          throw new Error(
            "【お店の検索】" +
            (
              error instanceof Error
                ? error.message
                : "取得に失敗しました。"
            )
          );
        }

        searchedStation = station;
        cachedRestaurants = restaurants;

        rememberStation(station);
        renderCurrentResults();
      } catch (error) {
        console.error("飲食店検索に失敗:", error);

        resultCount.textContent = "検索失敗";

        setStatus(
          error instanceof Error
            ? error.message
            : "検索中にエラーが発生しました。",
          "⚠️"
        );
      } finally {
        setSearching(false);
      }
    });

    window.addEventListener("storage", event => {
      if (
        event.key === FAVORITES_KEY ||
        event.key === null
      ) {
        favorites = loadFavorites();
        refreshFavoriteButtons();
        renderFavorites();
      }

      if (
        event.key === HISTORY_KEY ||
        event.key === null
      ) {
        stationHistory = loadHistory();
        renderHistory();
      }
    });

    statusBox.setAttribute("role", "status");
    statusBox.setAttribute("aria-live", "polite");
    resultCount.setAttribute("aria-live", "polite");

    updateGenreButtons();
    renderHistory();
    renderFavorites();

    if (
      "serviceWorker" in navigator &&
      ["http:", "https:"].includes(location.protocol)
    ) {
      const register = () => {
        navigator.serviceWorker
          .register("./sw.js")
          .catch(error => {
            console.warn(
              "Service Workerの登録に失敗:",
              error
            );
          });
      };

      if (document.readyState === "complete") {
        register();
      } else {
        window.addEventListener("load", register, {
          once: true
        });
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {
      once: true
    });
  } else {
    init();
  }
})();
