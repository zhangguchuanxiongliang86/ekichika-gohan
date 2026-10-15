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

    const SEARCH_RADIUS = 1500;
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

          throw new Error(
            `情報を取得できませんでした（HTTP ${response.status}）。`
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
          throw new Error(
            "通信に失敗しました。ネット接続やAPIの稼働状況を確認してください。"
          );
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function geocodeStation(station) {
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

    async function fetchRestaurants(center) {
      const query = `
[out:json][25];
nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream)$"]
(around:${SEARCH_RADIUS},${center.lat},${center.lon});
out center tags;
      `.trim();

      const data = await fetchJSON(
        "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=UTF-8"
          },
          body: query
        },
        35000
      );

      if (!Array.isArray(data.elements)) {
        throw new Error("お店の情報を正しく取得できませんでした。");
      }

      // 一部だけ取得できた応答を、完全な検索結果として表示しない。
      if (data.remark) {
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

              const lat = Number(best.lat);
      const lon = Number(best.lon);


        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          continue;
        }

        const key = `${element.type}/${element.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const distance = distanceMeters(center, { lat, lon });

        // 面や線の中心点も、表示対象の半径内に限定する。
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

