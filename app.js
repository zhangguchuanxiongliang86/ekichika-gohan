(() => {
  "use strict";

  function init() {
    const form = document.querySelector("#search-form");
    const stationInput = document.querySelector("#station");
    const genreButtons = [...document.querySelectorAll(".genre")];
    const searchButton = document.querySelector("#search-button");
    const statusBox = document.querySelector("#status");
    const resultsBox = document.querySelector("#results");
    const resultCount = document.querySelector("#result-count");
    const resultsTitle = document.querySelector("#results-title");

    const requiredElements = {
      form,
      stationInput,
      searchButton,
      statusBox,
      resultsBox,
      resultCount,
      resultsTitle
    };

    const missing = Object.entries(requiredElements)
      .filter(([, element]) => !element)
      .map(([name]) => name);

    if (missing.length) {
      console.error("必要なHTML要素が見つかりません:", missing);
      return;
    }

    const SEARCH_RADIUS = 800;
    const MAX_RESULTS = 30;

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

    // キーワードによる推定分類。ジャンルは重複する場合があります。
    const genreMatchers = {
      ramen: /ramen|ラーメン|らーめん|拉麺|中華そば/i,
      japanese:
        /japanese|和食|sushi|寿司|tempura|天ぷら|udon|うどん|soba|そば|定食/i,
      cafe: /cafe|café|coffee|カフェ|喫茶|コーヒー/i,
      curry: /curry|カレー/i,
      chinese: /chinese|中華|餃子|dumpling/i,
      yakiniku: /yakiniku|焼肉|barbecue|bbq/i,
      izakaya: /izakaya|居酒屋|pub|酒場/i,
      italian: /italian|pizza|pasta|洋食|イタリアン|ピザ|パスタ/i,
      sushi: /sushi|寿司|すし|鮨/i
    };

    const initialGenreButton = genreButtons.find(button =>
      button.classList.contains("active") ||
      button.getAttribute("aria-pressed") === "true"
    );

    let selectedGenre =
      initialGenreButton?.dataset.genre in genreLabels
        ? initialGenreButton.dataset.genre
        : "all";

    let isSearching = false;
    let cachedRestaurants = null;
    let searchedStation = "";

    const originalSearchButtonHTML = searchButton.innerHTML;

    function setStatus(message, icon = "🔎") {
      const iconElement = document.createElement("div");
      iconElement.className = "status-icon";
      iconElement.textContent = icon;
      iconElement.setAttribute("aria-hidden", "true");

      const messageElement = document.createElement("p");
      messageElement.textContent = message;
      messageElement.style.whiteSpace = "pre-line";

      statusBox.replaceChildren(iconElement, messageElement);
      statusBox.hidden = false;
    }

    function getTags(element) {
      return element.tags || {};
    }

    function getName(element) {
      const tags = getTags(element);

      return (
        tags["name:ja"] ||
        tags.name ||
        tags.brand ||
        "店名未登録のお店"
      );
    }

    function getType(element) {
      const tags = getTags(element);

      const values = [tags.cuisine, tags.amenity, tags.shop]
        .filter(Boolean)
        .flatMap(value => String(value).split(";"));

      return [...new Set(values)].join("・") || "飲食店";
    }

    function matchesGenre(element, genre) {
      if (genre === "all") return true;

      const matcher = genreMatchers[genre];
      if (!matcher) return false;

      const tags = getTags(element);
      const searchable = [
        tags.name,
        tags["name:ja"],
        tags.cuisine,
        tags.amenity,
        tags.shop,
        tags.description,
        tags.brand,
        tags["description:ja"]
      ]
        .filter(Boolean)
        .join(" ");

      return matcher.test(searchable);
    }

    function getAddress(element) {
      const tags = getTags(element);

      const parts = [
        tags["addr:province"] || tags["addr:state"],
        tags["addr:city"],
        tags["addr:suburb"],
        tags["addr:quarter"],
        tags["addr:neighbourhood"],
        tags["addr:street"] || tags["addr:place"],
        tags["addr:housenumber"]
      ].filter(Boolean);

      return (
        tags["addr:full"] ||
        parts.join("") ||
        "住所情報は登録されていません"
      );
    }

    function distanceMeters(a, b) {
      const radius = 6371000;
      const rad = value => (value * Math.PI) / 180;

      const dLat = rad(b.lat - a.lat);
      const dLon = rad(b.lon - a.lon);

      const value =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) *
          Math.cos(rad(b.lat)) *
          Math.sin(dLon / 2) ** 2;

      const clamped = Math.min(1, Math.max(0, value));

      return (
        2 *
        radius *
        Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped))
      );
    }

    function formatDistance(meters) {
      if (meters < 10) return "10m未満";

      if (meters < 1000) {
        return `約${Math.round(meters / 10) * 10}m`;
      }

      return `約${(meters / 1000).toFixed(1)}km`;
    }

    function mapURL(element) {
      const { lat, lon } = element;

      return (
        `https://www.openstreetmap.org/` +
        `?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`
      );
    }

    function googleSearchURL(name, station) {
      const query = encodeURIComponent(`${name} ${station}`);

      return (
        "https://www.google.com/maps/search/" +
        `?api=1&query=${query}`
      );
    }

    function createLink(text, href, primary = false) {
      const link = document.createElement("a");

      link.className = primary
        ? "card-link primary"
        : "card-link";

      link.href = href;
      link.textContent = text;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      return link;
    }

    function createRestaurantCard(item, station) {
      const article = document.createElement("article");
      article.className = "restaurant-card";

      const top = document.createElement("div");
      top.className = "card-top";

      const heading = document.createElement("h3");
      heading.textContent = getName(item);

      const badge = document.createElement("span");
      badge.className = "type-badge";
      badge.textContent = getType(item);

      top.append(heading, badge);

      const address = document.createElement("p");
      address.className = "address";
      address.textContent =
        `📍 直線距離 ${formatDistance(item.distance)}` +
        `・${getAddress(item)}`;

      const actions = document.createElement("div");
      actions.className = "card-actions";

      actions.append(
        createLink("地図で見る", mapURL(item)),
        createLink(
          "店舗情報",
          googleSearchURL(getName(item), station),
          true
        )
      );

      article.append(top, address, actions);

      return article;
    }

    function renderCurrentResults() {
      if (cachedRestaurants === null) return;

      const matches = cachedRestaurants.filter(item =>
        matchesGenre(item, selectedGenre)
      );

      const visible = matches.slice(0, MAX_RESULTS);

      resultsTitle.textContent =
        `${searchedStation}周辺` +
        ` / ${genreLabels[selectedGenre]}`;

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
        const active = button.dataset.genre === selectedGenre;

        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    function setSearching(searching) {
      isSearching = searching;
      searchButton.disabled = searching;
      stationInput.disabled = searching;

      genreButtons.forEach(button => {
        button.disabled = searching;
      });

      form.setAttribute("aria-busy", String(searching));

      if (searching) {
        searchButton.textContent = "⏳ 検索しています…";
      } else {
        searchButton.innerHTML = originalSearchButtonHTML;
      }
    }

        async function fetchOverpassJSON(url) {
      const wait = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

      // 最初の通信＋再試行1回まで。
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, 60000);

        let shouldRetry = false;

        try {
          let response;

          try {
            response = await fetch(url, {
              signal: controller.signal,
              headers: {
                Accept: "application/json"
              }
            });
          } catch (error) {
            if (timedOut) {
              throw new Error(
                "店舗検索の通信が60秒以内に完了しませんでした。" +
                "少し時間をおいて再検索してください。"
              );
            }

            if (error instanceof TypeError) {
              const networkError = new Error(
                "店舗検索サーバーの応答を受け取れませんでした。" +
                "通信経路やサーバー側の問題の可能性があります。"
              );

              networkError.retryable = true;
              throw networkError;
            }

            throw error;
          }

          if (!response.ok) {
            const httpError = new Error(
              response.status === 429
                ? "検索サーバーの利用制限に達しました。" +
                  "時間をおいて再検索してください。"
                : `店舗検索サーバーでエラーが発生しました` +
                  `（HTTP ${response.status}）。`
            );

            // 429は自動再試行しません。
            httpError.retryable =
              [502, 503, 504].includes(response.status);

            throw httpError;
          }

          return await response.json();
        } catch (error) {
          if (timedOut) {
            throw new Error(
              "店舗情報の受信が60秒以内に完了しませんでした。" +
              "少し時間をおいて再検索してください。"
            );
          }

          shouldRetry =
            attempt === 0 && error?.retryable === true;

          if (!shouldRetry) throw error;

          console.warn("店舗検索を15秒後に1回だけ再試行:", error);
        } finally {
          clearTimeout(timer);
        }

        if (shouldRetry) {
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

    async function fetchJSON(url, options = {}, timeout = 15000) {
      const controller = new AbortController();
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        if (!response.ok) {
          if (response.status === 429) {
            throw new Error(
              "検索が混み合っています。少し時間をおいて再度お試しください。"
            );
          }

                    const errorBody = await response.text();

          const errorDocument = new DOMParser().parseFromString(
            errorBody,
            "text/html"
          );

          const detail = (
            errorDocument.body.textContent || errorBody
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 1500);

          console.error("APIのエラー本文:", errorBody);

          throw new Error(
            `情報を取得できませんでした（HTTP ${response.status}）。\n` +
            detail
          );

        }

        return await response.json();
      } catch (error) {
        if (timedOut) {
          throw new Error(
            "通信がタイムアウトしました。少し時間をおいて再度お試しください。"
          );
        }

        if (error instanceof TypeError) {
  const endpoint = new URL(url, location.href);

  console.error("API通信の詳細:", {
    endpoint: endpoint.origin + endpoint.pathname,
    errorName: error.name,
    errorMessage: error.message,
    originalError: error
  });

  throw new Error(
    "APIとの通信に失敗しました。\n" +
    `接続先: ${endpoint.hostname}\n` +
    `詳細: ${error.message}\n` +
    "Wi-Fiとモバイル回線で結果が変わるか確認してください。"
  );
}


        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function geocodeStationFromAPI(station) {
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

      const places = await fetchJSON(
        `https://nominatim.openstreetmap.org/search?${params}`
      );

      if (!Array.isArray(places) || !places.length) {
        throw new Error(
          "駅が見つかりませんでした。都道府県名を添えるなど、駅名を変えて試してください。"
        );
      }

            const normalizeStationName = value =>
        String(value ?? "")
          .normalize("NFKC")
          .replace(/\s+/g, "")
          .replace(/駅$/, "");

      // まずは分類が明確に駅になっている候補を探す。
      const stationCandidate = places.find(place => {
        const category = place.category || place.class;

        return (
          (category === "railway" &&
            ["station", "halt", "tram_stop"].includes(place.type)) ||
          (category === "public_transport" &&
            place.type === "station")
        );
      });

      // 分類で見つからない場合は、候補自体の名前で確認する。
      // display_name 全体には住所や周辺施設名が含まれるため使わない。
      const nameCandidate = places.find(place => {
        const name = String(place.name ?? "").trim();

        return (
          /駅$/.test(name) &&
          normalizeStationName(name) ===
            normalizeStationName(query)
        );
      });

      const best = stationCandidate || nameCandidate;

      if (!best) {
        console.warn("駅検索の候補:", places);

        throw new Error(
          "駅の候補を特定できませんでした。都道府県名を添えるなど、入力を変えて試してください。"
        );
      }

      // display_name 内の「駅」だけでは駅施設と断定しない。
      
      const lat = Number(best.lat);
      const lon = Number(best.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error("駅の位置情報を取得できませんでした。");
      }

      return {
        lat,
        lon,
        displayName: best.display_name
      };
    }

        async function fetchRestaurantsFromAPI(center) {
      if (
        !Number.isFinite(center.lat) ||
        !Number.isFinite(center.lon)
      ) {
        throw new Error("駅の位置情報が正しくありません。");
      }

      const query = `
[out:json][timeout:25];
nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream)$"]
(around:${SEARCH_RADIUS},${center.lat},${center.lon});
out center tags;
      `.trim();

      const params = new URLSearchParams({
        data: query
      });

      const data = await fetchJSON(
        `https://overpass-api.de/api/interpreter?${params}`,
        {
          headers: {
            Accept: "application/json"
          },
          referrerPolicy: "strict-origin-when-cross-origin"
        },
        60000
      );

      if (!Array.isArray(data.elements)) {
        throw new Error("お店の情報を正しく取得できませんでした。");
      }

      if (data.remark) {
        console.warn("Overpassの応答:", data.remark);

        throw new Error(
          "検索処理を完了できませんでした。少し時間をおいて再度お試しください。"
        );
      }

      const seen = new Set();
      const restaurants = [];

      for (const element of data.elements) {
        const rawLat = element.lat ?? element.center?.lat;
        const rawLon = element.lon ?? element.center?.lon;

        if (rawLat == null || rawLon == null) continue;

        const lat = Number(rawLat);
        const lon = Number(rawLon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          continue;
        }

        const key = `${element.type}/${element.id}`;

        if (seen.has(key)) continue;
        seen.add(key);

        const distance = distanceMeters(center, { lat, lon });

        if (distance > SEARCH_RADIUS) continue;

        restaurants.push({
          ...element,
          lat,
          lon,
          distance
        });
      }

      return restaurants.sort((a, b) => a.distance - b.distance);
    }

        // 保存期間：
    // 駅の位置は7日、店舗情報は30分。
    // 店舗が0件の場合は2分だけ保存します。
    const STATION_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
    const RESTAURANT_CACHE_TTL = 30 * 60 * 1000;
    const EMPTY_CACHE_TTL = 2 * 60 * 1000;

    const memoryCache = new Map();
    let lastStationRequestAt = 0;

    function readSearchCache(key, ttl) {
      let entry = memoryCache.get(key);

      if (!entry) {
        try {
          const saved = sessionStorage.getItem(key);
          if (saved) entry = JSON.parse(saved);
        } catch {
          // 保存領域が使えない場合も検索は続けます。
        }
      }

      if (
        !entry ||
        !Number.isFinite(entry.savedAt) ||
        !Object.prototype.hasOwnProperty.call(entry, "value")
      ) {
        return null;
      }

      const age = Date.now() - entry.savedAt;

      if (age < 0 || age >= ttl) {
        memoryCache.delete(key);

        try {
          sessionStorage.removeItem(key);
        } catch {}

        return null;
      }

      memoryCache.set(key, entry);
      return entry.value;
    }

    function writeSearchCache(key, value) {
      const entry = {
        savedAt: Date.now(),
        value
      };

      memoryCache.set(key, entry);

      try {
        sessionStorage.setItem(key, JSON.stringify(entry));
      } catch {
        // 容量不足などの場合はメモリ内だけで再利用します。
      }
    }

    function normalizeStationInput(value) {
      return String(value)
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .replace(/駅$/, "");
    }

    async function geocodeStation(station) {
      const normalized = normalizeStationInput(station);
      const key = `ekichika:station:v2:${normalized}`;

      const cached = readSearchCache(key, STATION_CACHE_TTL);

      if (
        cached &&
        Number.isFinite(cached.lat) &&
        Number.isFinite(cached.lon)
      ) {
        return cached;
      }

      // この画面からの駅検索リクエストを連続させません。
      const waitMs = Math.max(
        0,
        1100 - (Date.now() - lastStationRequestAt)
      );

      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      lastStationRequestAt = Date.now();

      const center = await geocodeStationFromAPI(station);

      writeSearchCache(key, center);
      return center;
    }

    async function fetchRestaurants(center) {
      const key =
        `ekichika:restaurants:v2:${SEARCH_RADIUS}:` +
        `${center.lat.toFixed(6)},${center.lon.toFixed(6)}`;

      const cached = readSearchCache(
        key,
        RESTAURANT_CACHE_TTL
      );

      if (Array.isArray(cached)) {
        // 0件だった検索結果は、短い期間だけ再利用します。
        if (cached.length > 0) {
          return cached;
        }

        const recentEmpty = readSearchCache(
          key,
          EMPTY_CACHE_TTL
        );

        if (Array.isArray(recentEmpty)) {
          return recentEmpty;
        }
      }

      const restaurants = await fetchRestaurantsFromAPI(center);

      writeSearchCache(key, restaurants);
      return restaurants;
    }



    genreButtons.forEach(button => {
      // フォーム内でもジャンル選択だけで送信されないようにする。
      button.setAttribute("type", "button");

      button.addEventListener("click", event => {
        event.preventDefault();

        if (isSearching) return;

        const genre = button.dataset.genre;

        if (!Object.prototype.hasOwnProperty.call(genreLabels, genre)) {
          return;
        }

        selectedGenre = genre;
        updateGenreButtons();

        // 取得済みデータを使うため、ジャンル変更では再通信しない。
        renderCurrentResults();
      });
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();

      if (isSearching) return;

      const station = stationInput.value.trim();

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

      setStatus(
        "駅の場所と近くのお店を調べています。\n" +
          "少し時間がかかることがあります。",
        "⏳"
      );

      try {
                let center;

        try {
          center = await geocodeStation(station);
        } catch (error) {
          throw new Error(
            "【駅の検索】" +
            (error instanceof Error ? error.message : "取得に失敗しました。")
          );
        }

        let restaurants;

        try {
          restaurants = await fetchRestaurants(center);
        } catch (error) {
          throw new Error(
            "【お店の検索】" +
            (error instanceof Error ? error.message : "取得に失敗しました。")
          );
        }


        searchedStation = station;
        cachedRestaurants = restaurants;

        renderCurrentResults();
      } catch (error) {
        console.error("飲食店検索に失敗しました:", error);

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

    statusBox.setAttribute("role", "status");
    statusBox.setAttribute("aria-live", "polite");
    resultCount.setAttribute("aria-live", "polite");

    updateGenreButtons();

    if (
      "serviceWorker" in navigator &&
      ["http:", "https:"].includes(location.protocol)
    ) {
      const registerServiceWorker = () => {
        navigator.serviceWorker.register("./sw.js").catch(error => {
          console.warn("Service Workerの登録に失敗しました:", error);
        });
      };

      if (document.readyState === "complete") {
        registerServiceWorker();
      } else {
        window.addEventListener("load", registerServiceWorker, {
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

