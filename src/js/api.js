/**
 * VK Video AdFree 4K - API Client
 * Clean, ad-free stream extraction with Anonymous & VK ID OAuth support.
 */

class VKApi {
  constructor() {
    this.userToken = localStorage.getItem('vk_user_token') || null;
    this.cachedAnonymToken = localStorage.getItem('vk_anonym_token') || null;
    this.apiVersion = '5.199';
    // Official VK Video Smart TV application ID
    this.clientId = '512000384397';
    // Primary API endpoint specifically designed by VK for Smart TVs (Global SSL + CORS)
    this.apiBase = 'https://proxy.vkvideo.ru/api/method';
    this.apiFallback = 'https://api.vk.com/method';
  }

  isAuthorized() {
    return !!this.userToken;
  }

  setToken(token) {
    this.userToken = token;
    try {
      localStorage.setItem('vk_user_token', token);
    } catch (e) {
      console.warn('[VKApi] localStorage setToken error:', e);
    }
  }

  logout() {
    this.userToken = null;
    try {
      localStorage.removeItem('vk_user_token');
      localStorage.removeItem('vk_user_info');
    } catch (e) {
      console.warn('[VKApi] localStorage logout error:', e);
    }
  }

  async getValidToken() {
    if (this.userToken) return this.userToken;

    const expiry = parseInt(localStorage.getItem('vk_anonym_expiry') || '0', 10);
    const now = Math.floor(Date.now() / 1000);

    // If cached token is still valid (with 5-minute safety margin), use it
    if (this.cachedAnonymToken && expiry > now + 300) {
      return this.cachedAnonymToken;
    }

    // Otherwise, fetch a fresh anonymous web token from VK
    try {
      const data = await this.fetchAnonymousToken();
      if (data && data.token) {
        this.cachedAnonymToken = data.token;
        localStorage.setItem('vk_anonym_token', data.token);
        if (data.expiry) {
          localStorage.setItem('vk_anonym_expiry', data.expiry.toString());
        }
        return data.token;
      }
    } catch (e) {
      console.warn('[VKApi] Failed to fetch anonymous token, falling back to public feed:', e);
    }
    return null;
  }

  async fetchAnonymousToken() {
    try {
      const resp = await fetch(`${this.apiBase}/auth.getAnonymToken?client_id=4171611&client_secret=4zY5SwZXWDcXXLat9s0c&v=5.162`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.response && data.response.token) {
          console.log('[VKApi] Obtained valid anonymous token for VK Video Smart TV');
          return {
            token: data.response.token,
            expiry: data.response.expired_at || Math.floor(Date.now() / 1000) + 86400
          };
        }
      }
    } catch (err) {
      console.error('[VKApi] fetchAnonymousToken error:', err);
    }
    return null;
  }

  async getSmartTVAnonymToken() {
    try {
      const cached = localStorage.getItem('vk_smarttv_anonym_token');
      const expiry = parseInt(localStorage.getItem('vk_smarttv_anonym_expiry') || '0', 10);
      const now = Math.floor(Date.now() / 1000);
      if (cached && expiry > now + 300) {
        return cached;
      }
    } catch (e) {}

    const tokenData = await this.fetchAnonymousToken();
    if (tokenData && tokenData.token) {
      try {
        localStorage.setItem('vk_smarttv_anonym_token', tokenData.token);
        localStorage.setItem('vk_smarttv_anonym_expiry', tokenData.expiry.toString());
      } catch (e) {}
      return tokenData.token;
    }
    return null;
  }

  /**
   * Official VK Video Smart TV Flow (auth.getAuthCode via qr.vk.ru)
   */
  async getDeviceAuthCode() {
    const token = await this.getSmartTVAnonymToken();
    const params = new URLSearchParams({
      access_token: token || '',
      scope: 'video,offline,wall,groups',
      device_name: 'LG webOS TV',
      auth_code_type: 1,
      need_qr_code: 1,
      v: '5.162'
    });

    const resp = await fetch('https://api.vk.com/method/auth.getAuthCode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!resp.ok) {
      throw new Error(`Ошибка auth.getAuthCode: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    if (data.error) {
      throw new Error(data.error.error_msg || 'Ошибка получения кода');
    }

    const res = data.response;
    return {
      authCode: res.auth_code,
      authHash: res.auth_hash,
      qrUrl: res.auth_url || `https://qr.vk.ru/ca?q=${res.auth_code}`,
      expiresIn: res.expires_in
    };
  }

  /**
   * Poll VK servers for user approval on phone/PC via auth.checkAuthCode
   */
  async pollDeviceToken(authHash) {
    const token = await this.getSmartTVAnonymToken();
    const params = new URLSearchParams({
      access_token: token || '',
      auth_hash: authHash,
      v: '5.162'
    });

    try {
      const resp = await fetch('https://api.vk.com/method/auth.checkAuthCode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      if (!resp.ok) {
        return { status: 'error', code: resp.status };
      }

      const data = await resp.json();
      if (data.error) {
        if (data.error.error_code === 100 || data.error.error_code === 17) {
          return { status: 'expired' };
        }
        return { status: 'pending' };
      }

      const res = data.response;
      if (res && res.access_token) {
        return {
          status: 'success',
          token: res.access_token,
          photo: res.photo_200,
          phone: res.phone
        };
      }

      // res.status === 0 means waiting for user confirmation
      return { status: 'pending' };
    } catch (e) {
      return { status: 'pending' };
    }
  }

  async fetchUserProfile(token, userId = '') {
    try {
      const userParam = userId ? `&user_ids=${encodeURIComponent(userId)}` : '';
      const url = `https://api.vk.com/method/users.get?access_token=${token}${userParam}&fields=photo_100,first_name,last_name&v=${this.apiVersion}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.response && data.response[0]) {
          const u = data.response[0];
          return {
            id: u.id,
            name: `${u.first_name} ${u.last_name}`,
            photo: u.photo_100
          };
        }
        if (data && data.error) {
          console.warn('[VKApi] fetchUserProfile error:', data.error);
          if (data.error.error_code === 5) {
            return { isRevoked: true };
          }
        }
      }
    } catch (e) {
      console.warn('[VKApi] fetchUserProfile error:', e);
    }
    return null;
  }

  /**
   * Generic VK API Call (with Smart TV Proxy & Global SSL)
   */
  async callMethod(method, params = {}) {
    const token = await this.getValidToken();
    const queryParams = new URLSearchParams({
      ...params,
      v: this.apiVersion,
      ...(token ? { access_token: token } : {})
    });

    const primaryUrl = `${this.apiBase}/${method}?${queryParams.toString()}`;
    try {
      const resp = await fetch(primaryUrl, {
        headers: {
          'User-Agent': 'VKVideoSmartTV/1.0 (webOS 6.0; LG C1)'
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (!data.error) return data.response;
        // If method restricted on proxy, continue to fallback
        console.warn(`[VKApi] Proxy API returned error:`, data.error);
      }
    } catch (e) {
      console.warn(`[VKApi] Primary proxy ${this.apiBase} unreachable, trying fallback:`, e);
    }

    // Fallback directly to api.vk.com
    const fallbackUrl = `${this.apiFallback}/${method}?${queryParams.toString()}`;
    const fbResp = await fetch(fallbackUrl, {
      headers: {
        'User-Agent': 'VKVideoSmartTV/1.0 (webOS 6.0; LG C1)'
      }
    });

    if (!fbResp.ok) {
      throw new Error(`HTTP Error ${fbResp.status}`);
    }

    const fbData = await fbResp.json();
    if (fbData.error) {
      throw new Error(`VK API Error: ${fbData.error.error_msg} (code: ${fbData.error.error_code})`);
    }
    return fbData.response;
  }

  /**
   * Get Video Streams and Details (Clean and Pure - 100% Ad-Free)
   */
  async getVideoDetails(videoId) {
    // videoId format: owner_id_id (e.g. -22822305_456241859 or 205387401_165548505)
    const cleanedId = videoId.replace('video', '').trim();
    const resp = await this.callMethod('video.get', {
      videos: cleanedId,
      extended: 1
    });

    if (!resp || !resp.items || resp.items.length === 0) {
      throw new Error('Видео не найдено или доступ ограничен');
    }

    const item = resp.items[0];
    const files = item.files || {};

    // Resolve authentic channel/creator name from extended response (never expose numeric owner_id in UI)
    let authorName = item.owner_name || '';
    if (!authorName && item.owner_id < 0 && Array.isArray(resp.groups)) {
      const grp = resp.groups.find(g => Math.abs(g.id) === Math.abs(item.owner_id));
      if (grp && grp.name) authorName = grp.name;
    } else if (!authorName && item.owner_id > 0 && Array.isArray(resp.profiles)) {
      const prof = resp.profiles.find(p => p.id === item.owner_id);
      if (prof) authorName = `${prof.first_name || ''} ${prof.last_name || ''}`.trim();
    }

    // Extract all available stream qualities (prioritize AV1 / VP9 hardware DASH and HLS)
    const streamSources = {
      dash_webm_av1: files.dash_webm_av1 || null,
      dash_webm: files.dash_webm || null,
      hls: files.hls_fmp4 || files.hls_ondemand || files.hls || files.hls_live_playback || null,
      dash: files.dash_ondemand || files.dash || files.dash_sep || null,
      mp4_2160: files.mp4_2160 || null,
      mp4_1440: files.mp4_1440 || null,
      mp4_1080: files.mp4_1080 || null,
      mp4_720: files.mp4_720 || null,
      mp4_480: files.mp4_480 || null,
      mp4_360: files.mp4_360 || null
    };

    // Calculate maximum available resolution
    let maxQuality = '720p';
    if (streamSources.mp4_2160 || (streamSources.hls && item.height >= 2160)) maxQuality = '4K 2160p';
    else if (streamSources.mp4_1440 || (streamSources.hls && item.height >= 1440)) maxQuality = '2K 1440p';
    else if (streamSources.mp4_1080 || (streamSources.hls && item.height >= 1080)) maxQuality = '1080p FHD';
    else if (item.height >= 720) maxQuality = '720p HD';

    return {
      id: `${item.owner_id}_${item.id}`,
      title: item.title || 'Без названия',
      description: item.description || '',
      duration: item.duration || 0,
      views: item.views || 0,
      date: item.date,
      ownerId: item.owner_id,
      author: authorName || '',
      isLive: item.live === 2 || Boolean(item.is_live),
      maxQuality: maxQuality,
      thumbnail: this.getBestThumbnail(item),
      streams: streamSources
    };
  }

  /**
   * Search Videos across VK Video
   * Multi-Source Hybrid Engine:
   * 1. Query Normalization & Expansion (strips generic prefixes like "шоу", "сериал" to find true entity).
   * 2. Live Web Platform Catalog (al_video.php) queried in parallel with REST API (video.search).
   *    Ensures that fresh episodes (e.g. from today/yesterday) are never missed due to API latency.
   * 3. Intelligent Entity Tiering + Chronological ordering: fresh episodes of the target show are ALWAYS #1!
   */
  async search(query, count = 60, minDuration = 120) {
    if (!query || !query.trim()) return [];
    const cleanQuery = query.trim();
    console.log(`[VKApi] Executing multi-source video search for: "${cleanQuery}" (minDuration: ${minDuration}s)`);

    const results = [];
    const seen = new Set();

    // Query Normalization: extract core entity name without intent prefixes ("шоу", "сериал", etc.)
    const strippedQuery = cleanQuery.replace(/^(шоу|передача|сериал|фильм|смотреть|вк|новое|новый)\s+/i, '').trim();
    const queryVariants = [cleanQuery];
    if (strippedQuery && strippedQuery.toLowerCase() !== cleanQuery.toLowerCase()) {
      queryVariants.push(strippedQuery);
    }

    // Helper: query official VK API video.search
    const fetchApiSearch = async () => {
      try {
        const apiResp = await this.callMethod('video.search', {
          q: cleanQuery,
          sort: 2,
          count: Math.min(count * 2, 100),
          extended: 1
        });
        return (apiResp && apiResp.items) || [];
      } catch (e) {
        return [];
      }
    };

    // Execute API and Live Web Catalog queries in parallel
    const tasks = [fetchApiSearch()];
    for (let i = 0; i < queryVariants.length; i++) {
      tasks.push(this.fetchWebSearch(queryVariants[i]));
    }

    let searchOutputs;
    try {
      searchOutputs = await Promise.all(tasks);
    } catch (e) {
      searchOutputs = [[], []];
    }

    const apiItems = searchOutputs[0] || [];
    const webLists = searchOutputs.slice(1);

    // Detect canonical show/creator channel from primary web results
    let dominantChannel = null;
    if (webLists.length > 0 && webLists[0].length > 0) {
      dominantChannel = this.detectCanonicalChannel(webLists[0], cleanQuery);
    }

    // If a canonical channel was identified (e.g. "Шоу ВПИСКА", "ШАСТУН", "LABELCOM"),
    // fetch its newest uploads directly so fresh episodes that lack the show name in the title
    // (e.g. "Андрей Гайдулян – о новом прайме...") are NEVER missed due to keyword indexing blindspots.
    if (dominantChannel && dominantChannel.ownerId) {
      try {
        const channelResp = await this.callMethod('video.get', {
          owner_id: dominantChannel.ownerId,
          count: 30,
          extended: 1
        });
        const chItems = (channelResp && channelResp.items) || [];
        for (let i = 0; i < chItems.length; i++) {
          const v = chItems[i];
          if (!v || v.duration < minDuration) continue;
          const vidKey = `${v.owner_id}_${v.id}`;
          if (seen.has(vidKey)) continue;
          seen.add(vidKey);

          const titleLower = (v.title || '').toLowerCase();
          const has4k = titleLower.includes('4k') || titleLower.includes('2160') || Boolean(v.width && v.width >= 3840);
          const has1080 = titleLower.includes('1080') || (v.duration > 600) || Boolean(v.width && v.width >= 1920);

          results.push({
            id: vidKey,
            ownerId: v.owner_id,
            title: v.title,
            author: dominantChannel.author,
            duration: this.formatDuration(v.duration),
            views: this.formatViews(v.views || 0),
            thumbnail: this.getBestThumbnail(v),
            date: v.date || null,
            is4K: Boolean(has4k),
            isHD: Boolean(has1080),
            isVerified: true,
            fromChannelDirect: true
          });
        }
      } catch (err) {
        // Fallback gracefully if channel video.get fails or is rate limited
      }
    }

    // 1. Process Live Web Catalog results (highest freshness and accuracy)
    for (let w = 0; w < webLists.length; w++) {
      const rawList = webLists[w];
      for (let i = 0; i < rawList.length; i++) {
        const it = rawList[i];
        const ownerId = it[0];
        const videoId = it[1];
        const vidKey = `${ownerId}_${videoId}`;
        if (seen.has(vidKey)) continue;

        const thumb = it[2] || 'assets/splashBackground.png';
        const rawTitle = it[3] || 'Видео';
        const durStr = it[5] || '0:00';
        const authorHtml = it[8] || 'VK Video';
        const viewsCount = it[10] || 0;
        const timestamp = Number(it[9]) || Number(it[40]) || 0;

        const author = authorHtml.replace(/<[^>]+>/g, '').trim() || 'VK Video';
        const title = this.unescapeHtml(rawTitle);
        const sec = Number(it[19]) || this.parseDurationStr(durStr);

        // Strictly filter out short videos (< minDuration seconds)
        if (sec < minDuration) continue;

        const titleLower = title.toLowerCase();
        if (
          titleLower.includes('#shorts') ||
          titleLower.includes('#клипы') ||
          titleLower.includes('#клип') ||
          titleLower.includes('#рилс') ||
          titleLower.includes('#reels') ||
          titleLower.includes('#тикток') ||
          titleLower.startsWith('clip by') ||
          titleLower.includes('короткие видео')
        ) {
          continue;
        }

        const has4k = titleLower.includes('4k') || titleLower.includes('2160') || Boolean(it[4] && (it[4] & 16384));
        const has1080 = titleLower.includes('1080') || (!has4k && sec > 600);

        seen.add(vidKey);
        results.push({
          id: vidKey,
          ownerId: ownerId,
          title: title,
          author: author,
          duration: durStr,
          views: this.formatViews(viewsCount),
          thumbnail: thumb,
          date: timestamp || null,
          is4K: has4k,
          isHD: has1080,
          isVerified: authorHtml.includes('page_verified')
        });
      }
    }

    // 2. Supplement with official API items (if any new items found)
    for (let i = 0; i < apiItems.length; i++) {
      const item = apiItems[i];
      if (!this.isFullLengthVideo(item, minDuration)) continue;

      const formatted = this.formatVideoItem(item);
      if (formatted && formatted.id && !seen.has(formatted.id)) {
        seen.add(formatted.id);
        results.push(formatted);
      }
    }

    // 3. Fallback to curated catalog if absolutely nothing found
    if (results.length === 0) {
      const backup = this.getCuratedBackupVideos(cleanQuery);
      if (backup && backup.length > 0) return backup;
    }

    // 4. Apply intelligent multi-factor relevance & freshness ranking
    const ranked = this.rankSearchResults(results, cleanQuery, dominantChannel);
    return ranked.slice(0, count);
  }

  /**
   * Helper: Query live VK Video web search catalog (real-time platform index)
   */
  async fetchWebSearch(qText) {
    try {
      const params = new URLSearchParams({
        act: 'search_video',
        al: '1',
        q: qText,
        hd: '1',
        offset: '0'
      });

      const resp = await fetch('https://vk.com/al_video.php', {
        method: 'POST',
        body: params.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=windows-1251',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://vk.com/video',
          'Origin': 'https://vk.com'
        }
      });

      if (!resp.ok) return [];
      const buf = await resp.arrayBuffer();
      const decoder = new TextDecoder('windows-1251');
      const text = decoder.decode(buf);
      const data = JSON.parse(text);

      if (data && data.payload && data.payload[1] && data.payload[1][2]) {
        return data.payload[1][2].list || [];
      }
      return [];
    } catch (err) {
      return [];
    }
  }

  /**
   * Fast Canonical Show Registry for Instant Query Entity Mapping
   */
  getCanonicalShowEntity(query) {
    if (!query) return null;
    const q = query.toLowerCase().trim();
    
    const SHOWS = [
      {
        keywords: ['ида галич', 'иды галич', 'галич', 'есть вопросики', '1-11', 'не молчи'],
        ownerId: -125215074,
        author: 'Ида Галич'
      },
      {
        keywords: ['шастун', 'контакты', 'шоу контакты', 'неигры', 'цитаты'],
        ownerId: -213802301,
        author: 'ШАСТУН'
      },
      {
        keywords: ['вписка', 'шоу вписка', 'трунов', 'редькин'],
        ownerId: -149430811,
        author: 'Шоу ВПИСКА'
      },
      {
        keywords: ['азамат', 'мусагалиев', 'большое шоу', 'я себя знаю'],
        ownerId: -110135406,
        author: 'Азамат Мусагалиев'
      },
      {
        keywords: ['кстати', 'шоу кстати', 'харламов мусагалиев'],
        ownerId: -220754053,
        author: 'VK Видео'
      },
      {
        keywords: ['натальная карта', 'олеся иванченко', 'дима журавлев', 'журавлев иванченко'],
        ownerId: -211232966,
        author: 'Натальная карта'
      },
      {
        keywords: ['женский форум', 'варя щербакова', 'наташа борисова', 'парфенюк'],
        ownerId: -211229778,
        author: 'Женский Форум'
      },
      {
        keywords: ['вопрос ребром', 'баста вопрос ребром', 'газгольдер', 'gazgolder'],
        ownerId: -1415705,
        author: 'GAZ'
      },
      {
        keywords: ['чбд', 'что было дальше', 'labelcom'],
        ownerId: -209976560,
        author: 'LABELCOM'
      },
      {
        keywords: ['минаев', 'минаев live', 'уроки истории'],
        ownerId: -196446247,
        author: 'Минаев Live'
      },
      {
        keywords: ['badcomedian', 'бэдкомедиан', 'баженов'],
        ownerId: -25557243,
        author: 'BadComedian'
      }
    ];

    for (const s of SHOWS) {
      for (const kw of s.keywords) {
        if (q.includes(kw) || kw.includes(q)) {
          return {
            ownerId: s.ownerId,
            author: s.author,
            isVerified: true,
            score: 500
          };
        }
      }
    }
    return null;
  }

  /**
   * Detects the canonical creator/channel entity from initial live web search results.
   * Evaluates channel name relevance against query tokens, verified badges, and top-result dominance.
   */
  detectCanonicalChannel(rawWeb, query) {
    const directCanonical = this.getCanonicalShowEntity(query);
    if (directCanonical) return directCanonical;

    if (!rawWeb || rawWeb.length === 0 || !query) return null;
    const cleanQuery = query.toLowerCase().trim();
    const rawWords = cleanQuery.split(/\s+/).filter(w => w.length > 1);
    const stopWords = new Set(['шоу', 'передача', 'выпуск', 'выпуски', 'серия', 'серии', 'сезон', 'сезоны', 'видео', 'вк', 'vk', 'новое', 'новый', 'новые', 'все', 'смотреть']);
    const coreWords = rawWords.filter(w => !stopWords.has(w));

    const channelStats = new Map();

    for (let i = 0; i < Math.min(rawWeb.length, 15); i++) {
      const it = rawWeb[i];
      const ownerId = it[0];
      const authorHtml = it[8] || '';
      const author = authorHtml.replace(/<[^>]+>/g, '').trim();
      const isVerified = authorHtml.includes('page_verified');

      if (!channelStats.has(ownerId)) {
        channelStats.set(ownerId, {
          ownerId: ownerId,
          author: author,
          isVerified: isVerified,
          frequency: 0,
          isFirstItem: i === 0,
          score: 0
        });
      }
      const stat = channelStats.get(ownerId);
      stat.frequency++;
    }

    for (const [ownerId, stat] of channelStats.entries()) {
      const authorLower = stat.author.toLowerCase();
      const matchesCoreWord = coreWords.some(w => authorLower.includes(w));
      if (matchesCoreWord) stat.score += 60;
      if (stat.isFirstItem) stat.score += 40;
      if (stat.isVerified) stat.score += 25;
      stat.score += stat.frequency * 5;
    }

    const sorted = [...channelStats.values()].sort((a, b) => b.score - a.score);
    return (sorted[0] && sorted[0].score >= 35) ? sorted[0] : null;
  }

  /**
   * Fallback channel detector for cases where raw web results are unavailable (e.g. unit tests or API-only)
   */
  detectDominantChannelFromResults(results, query) {
    const directCanonical = this.getCanonicalShowEntity(query);
    if (directCanonical) return directCanonical;

    if (!results || results.length === 0 || !query) return null;
    const cleanQuery = query.toLowerCase().trim();
    const rawWords = cleanQuery.split(/\s+/).filter(w => w.length > 1);
    const stopWords = new Set(['шоу', 'передача', 'выпуск', 'выпуски', 'серия', 'серии', 'сезон', 'сезоны', 'видео', 'вк', 'vk', 'новое', 'новый', 'новые', 'все', 'смотреть']);
    const coreWords = rawWords.filter(w => !stopWords.has(w));

    const authorCounts = {};
    const topSample = results.slice(0, 15);
    topSample.forEach((it, idx) => {
      const a = (it.author || '').toLowerCase();
      if (a) {
        if (!authorCounts[a]) authorCounts[a] = { author: it.author, ownerId: it.ownerId, count: 0, isFirst: idx === 0, score: 0 };
        authorCounts[a].count++;
      }
    });

    for (const a in authorCounts) {
      const stat = authorCounts[a];
      const matchesCoreWord = coreWords.some(w => a.includes(w));
      if (matchesCoreWord) stat.score += 60;
      if (stat.isFirst) stat.score += 40;
      stat.score += stat.count * 10;
    }

    const sorted = Object.values(authorCounts).sort((a, b) => b.score - a.score);
    return (sorted[0] && sorted[0].score >= 30) ? sorted[0] : null;
  }

  /**
   * Multi-Factor Relevance & Recency Scoring Engine:
   * 1. Intent Classification: Detects whether query is a navigational show browse (e.g. "шоу вписка", "чбд")
   *    or a specific guest/episode search (e.g. "вписка гайдулян", "контакты медведева").
   * 2. Authoritative Channel Boost: Content from the verified/canonical show channel receives massive authority score.
   * 3. Specific Guest / Topic Boost: Guest names give top priority to targeted episodes.
   * 4. Freshness Decay Function:
   *    - For broad show queries: smooth chronological decay ensures the newest episode is strictly #1.
   *    - For general queries: exponential half-life recency decay.
   * 5. Negative Signal Penalization: Reactions, review cuts, parodies, and clips are heavily penalized.
   */
  rankSearchResults(results, query, dominantChannel = null) {
    if (!results || results.length <= 1 || !query) return results || [];

    if (!dominantChannel) {
      dominantChannel = this.detectDominantChannelFromResults(results, query);
    }

    const cleanQuery = query.trim().toLowerCase();
    const rawWords = cleanQuery.split(/\s+/).filter(w => w.length > 1);
    const stopWords = new Set(['шоу', 'передача', 'выпуск', 'выпуски', 'серия', 'серии', 'сезон', 'сезоны', 'видео', 'вк', 'vk', 'новое', 'новый', 'новые', 'все', 'смотреть']);
    const coreWords = rawWords.filter(w => !stopWords.has(w));
    const effectiveWords = coreWords.length > 0 ? coreWords : rawWords;

    const channelNameLower = (dominantChannel && dominantChannel.author ? dominantChannel.author : '').toLowerCase();
    const guestWords = coreWords.filter(w => !channelNameLower.includes(w));
    const isNavigationalShowQuery = Boolean(dominantChannel && guestWords.length === 0);

    const now = Math.floor(Date.now() / 1000);

    const scored = results.map((item, originalRank) => {
      const titleLower = (item.title || '').toLowerCase();
      const authorLower = (item.author || '').toLowerCase();
      const timestamp = Number(item.date) || 0;

      let relevanceScore = 0;

      // 1. Channel Authority
      const isOfficial = Boolean(
        dominantChannel &&
        ((dominantChannel.ownerId && item.ownerId === dominantChannel.ownerId) ||
         (channelNameLower && authorLower.includes(channelNameLower)) ||
         item.fromChannelDirect)
      );

      if (isOfficial) {
        relevanceScore += 600;
      } else if (item.isVerified) {
        relevanceScore += 150;
      }

      // 2. Query matching: full query phrase vs core words
      if (titleLower.includes(cleanQuery)) {
        relevanceScore += 200;
      }

      for (let i = 0; i < effectiveWords.length; i++) {
        const w = effectiveWords[i];
        if (titleLower.includes(w) || authorLower.includes(w)) {
          relevanceScore += 60;
        }
      }

      // 3. Guest / Topic Specific Words
      if (guestWords.length > 0) {
        for (let i = 0; i < guestWords.length; i++) {
          const gw = guestWords[i];
          if (titleLower.includes(gw)) {
            relevanceScore += 800; // Major priority for matching specific guest
          }
        }
      }

      // 4. Negative signals: reactions, parodies, cut clips
      if (
        titleLower.includes('реакция') ||
        titleLower.includes('смотрит') ||
        titleLower.includes('нарезка') ||
        titleLower.includes('разбор') ||
        titleLower.includes('пародия')
      ) {
        relevanceScore -= 500;
      }

      return {
        item: item,
        relevanceScore: relevanceScore,
        timestamp: timestamp,
        originalRank: originalRank
      };
    });

    scored.sort((a, b) => {
      // If there is a distinct relevance difference (> 50 points), relevance dominates
      if (Math.abs(b.relevanceScore - a.relevanceScore) > 50) {
        return b.relevanceScore - a.relevanceScore;
      }
      // Within similar relevance tier, strictly order newest episodes first
      if (b.timestamp !== a.timestamp) {
        return b.timestamp - a.timestamp;
      }
      return a.originalRank - b.originalRank;
    });

    return scored.map(s => s.item);
  }

  parseDurationStr(durStr) {
    if (!durStr) return 0;
    const parts = durStr.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(durStr) || 0;
  }

  unescapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
  }

  /**
   * Universal filter: Strictly full-length, horizontal widescreen videos only
   * Eliminates short clips, mobile reels, vertical shorts, teasers, and announcements.
   */
  isFullLengthVideo(item, minDuration = 120) {
    if (!item) return false;

    // 1. Duration: Minimum duration (default 120s, in Smart TV feeds 240s)
    const dur = item.duration || 0;
    if (dur < minDuration) return false;

    // 2. Geometry: strictly horizontal widescreen (aspect ratio >= 1.18).
    // Eliminates all 9:16 vertical and 1:1 square mobile videos/reels.
    const w = item.width || 0;
    const h = item.height || 0;
    if (w > 0 && h > 0 && (w <= h || (w / h) < 1.18)) return false;

    // 3. VK Clip markers
    if (item.type === 'short_video' || item.is_clip || item.clip_type) return false;

    // 4. Title keywords, hashtags, and short promo markers
    const title = (item.title || '').trim().toLowerCase();
    const shortMarkers = [
      'clip by', '#shorts', '#short', '#клипы', '#клип', '#рилс', '#reels',
      '#тикток', '#shorts_video', '#видеоклип',
      '[анонс]', '(анонс)', 'анонс:', 'тизер', 'teaser', 'трейлер', 'trailer',
      'промо', 'promo', 'отрывок', 'бэкстейдж', 'backstage'
    ];
    for (const sm of shortMarkers) {
      if (title.includes(sm)) return false;
    }

    return true;
  }

  /**
   * Check if video is playable, full-length, and horizontal (Strictly NO vertical clips/shorts)
   */
  isPlayableFullVideo(item, minDuration = 120) {
    if (!this.isFullLengthVideo(item, minDuration)) return false;

    // Must have playable direct stream files (HLS or MP4)
    const files = item.files || {};
    const hasStream = Boolean(
      files.hls || files.hls_fmp4 || files.hls_ondemand ||
      files.mp4_2160 || files.mp4_1440 || files.mp4_1080 || files.mp4_720 || files.mp4_480 || files.mp4_360
    );
    if (!hasStream) return false;

    // Must have valid thumbnail
    const thumb = this.getBestThumbnail(item);
    if (!thumb || thumb.includes('splashBackground.png')) return false;

    return true;
  }

  /**
   * Verified Community Channels per Category
   */
  getCategoryMapping() {
    return {
      movies: [
        { id: -108468, name: 'Кинопоиск' },
        { id: -25557243, name: 'BadComedian' },
        { id: -29534144, name: 'Ленфильм' },
        { id: -22822305, name: 'VK Фильмы' }
      ],
      series: [
        { id: -108468, name: 'Кинопоиск Сериалы' },
        { id: -29534144, name: 'Ленфильм' }
      ],
      shows: [
        { id: -125215074, name: 'Ида Галич' },
        { id: -213802301, name: 'ШАСТУН' },
        { id: -149430811, name: 'Шоу ВПИСКА' },
        { id: -110135406, name: 'Азамат Мусагалиев' },
        { id: -211232966, name: 'Натальная карта' },
        { id: -211229778, name: 'Женский Форум' },
        { id: -220754053, name: 'VK Видео' },
        { id: -1415705, name: 'GAZ' },
        { id: -209976560, name: 'LABELCOM' },
        { id: -196446247, name: 'Минаев Live' }
      ],
      kids: [
        { id: -73154028, name: 'Союзмультфильм' }
      ],
      games: [
        { id: -30602036, name: 'IGM' },
        { id: -388266, name: 'Навигатор игрового мира' },
        { id: -387766, name: 'StopGame' },
        { id: -1112285, name: 'Игромания' }
      ],
      tech: [
        { id: -39447662, name: 'IXBT.com' },
        { id: -26284064, name: 'Wylsacom' },
        { id: -1112285, name: 'Игромания' }
      ],
      nature: [
        { id: -237581709, name: 'Планета "4K ULTRA HD"' }
      ],
      sports: [
        { id: -101982925, name: 'МАТЧ ТВ' }
      ],
      music: [
        { id: -28905875, name: 'Муз-ТВ Клипы' }
      ]
    };
  }

  /**
   * Top Premier Creator Channels on VK Video
   */
  getPremierPopularChannels() {
    return [
      { id: -125215074, name: 'Ида Галич' },
      { id: -213802301, name: 'ШАСТУН' },
      { id: -149430811, name: 'Шоу ВПИСКА' },
      { id: -110135406, name: 'Азамат Мусагалиев' },
      { id: -211232966, name: 'Натальная карта' },
      { id: -211229778, name: 'Женский Форум' },
      { id: -220754053, name: 'VK Видео' },
      { id: -1415705, name: 'GAZ' },
      { id: -209976560, name: 'LABELCOM' },
      { id: -196446247, name: 'Минаев Live' },
      { id: -25557243, name: 'BadComedian' },
      { id: -108468, name: 'Кинопоиск' },
      { id: -39447662, name: 'IXBT.com' },
      { id: -26284064, name: 'Wylsacom' },
      { id: -237581709, name: 'Планета "4K ULTRA HD"' }
    ];
  }

  /**
   * Get Trending / Popular Catalog (Live Dynamic Aggregation with Zero Dummy Data)
   */
  async getTrending(count = 32, offset = 0) {
    if (this.isAuthorized()) {
      try {
        const resp = await this.callMethod('video.getCatalog', {
          count: count,
          offset: offset,
          extended: 1
        });
        const items = [];
        if (resp && resp.items) {
          for (const block of resp.items) {
            if (block.items) {
              items.push(...block.items);
            }
          }
        }
        const filtered = items
          .filter(item => this.isPlayableFullVideo(item))
          .map(item => this.formatVideoItem(item));
        if (filtered.length > 0) return filtered;
      } catch (e) {
        console.warn('[VKApi] getCatalog failed, trying direct channels:', e);
      }
    }

    // Dynamic aggregation from premier popular channels with verified streams
    try {
      const topGroups = this.getPremierPopularChannels();

      const groupPromises = topGroups.map(async g => {
        try {
          const resp = await this.callMethod('video.get', {
            owner_id: g.id,
            count: 8,
            offset: offset,
            extended: 1
          });

          // Build dynamic map of REAL groups and profiles returned directly by the API
          const groupsMap = {};
          if (resp && resp.groups && Array.isArray(resp.groups)) {
            for (const grp of resp.groups) {
              groupsMap[grp.id] = grp.name;
            }
          }
          const profilesMap = {};
          if (resp && resp.profiles && Array.isArray(resp.profiles)) {
            for (const pr of resp.profiles) {
              profilesMap[pr.id] = `${pr.first_name || ''} ${pr.last_name || ''}`.trim();
            }
          }

          const list = [];
          if (resp && resp.items) {
            for (const item of resp.items) {
              if (this.isPlayableFullVideo(item, 240)) {
                const formatted = this.formatVideoItem(item);
                // ALWAYS use the authentic author name from API response!
                let realAuthor = '';
                if (item.owner_id < 0) {
                  realAuthor = groupsMap[Math.abs(item.owner_id)] || g.name || formatted.author;
                } else if (item.owner_id > 0) {
                  realAuthor = profilesMap[item.owner_id] || g.name || formatted.author;
                }
                formatted.author = realAuthor || formatted.author;
                list.push(formatted);
              }
            }
          }
          return list;
        } catch (err) {
          return [];
        }
      });

      const groupResults = await Promise.all(groupPromises);
      const dynamicVideos = groupResults.flat();

      if (dynamicVideos.length >= 6) {
        dynamicVideos.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
        return dynamicVideos;
      }
    } catch (e) {
      console.warn('[VKApi] Dynamic feed failed, using verified catalog pool:', e);
    }

    // High quality verified pool fallback
    return this.getPopularPublicVideos();
  }

  /**
   * Get Videos for a Specific Category (Always 100% Real Videos and Previews)
   */
  async getCategory(categoryId) {
    const mapping = this.getCategoryMapping();
    const channels = mapping[categoryId] || [];

    if (channels.length > 0) {
      const categoryVideos = [];
      for (const ch of channels) {
        try {
          const resp = await this.callMethod('video.get', {
            owner_id: ch.id,
            count: 20,
            extended: 1
          });
          if (resp && resp.items) {
            for (const item of resp.items) {
              if (this.isPlayableFullVideo(item, 240)) {
                categoryVideos.push({
                  ...this.formatVideoItem(item),
                  author: ch.name
                });
              }
            }
          }
        } catch (err) {
          console.warn(`[VKApi] Error fetching category channel ${ch.name}:`, err);
        }
      }

      if (categoryVideos.length > 0) {
        return categoryVideos;
      }
    }

    // Fallback to verified catalog for this category
    if (typeof window !== 'undefined' && window.VK_CURATED_CATALOG && window.VK_CURATED_CATALOG[categoryId]) {
      return window.VK_CURATED_CATALOG[categoryId];
    }

    return this.getPopularPublicVideos();
  }

  /**
   * Get Videos for a Specific Channel / Community (Strictly Full-Length, NO Shorts)
   */
  async getChannelVideos(ownerId, count = 50, channelName = '', minDuration = 120, offset = 0) {
    try {
      const resp = await this.callMethod('video.get', {
        owner_id: ownerId,
        count: count,
        offset: offset,
        extended: 1
      });
      if (resp && resp.items && resp.items.length > 0) {
        const groupsMap = {};
        if (resp.groups && Array.isArray(resp.groups)) {
          for (const g of resp.groups) {
            groupsMap[g.id] = g.name;
          }
        }
        const profilesMap = {};
        if (resp.profiles && Array.isArray(resp.profiles)) {
          for (const p of resp.profiles) {
            profilesMap[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim();
          }
        }

        const fullVideos = [];
        for (const item of resp.items) {
          if (this.isFullLengthVideo(item, minDuration)) {
            const formatted = this.formatVideoItem(item);
            const resolvedName = channelName || (item.owner_id < 0 ? groupsMap[Math.abs(item.owner_id)] : profilesMap[item.owner_id]);
            if (resolvedName) {
              formatted.author = resolvedName;
            }
            fullVideos.push(formatted);
          }
        }
        if (fullVideos.length > 0) return fullVideos;
      }
    } catch (e) {
      console.warn('[VKApi] getChannelVideos error:', e);
    }
    return [];
  }

  /**
   * Subscribe to a channel / community / creator
   */
  async subscribeChannel(ownerId) {
    if (!this.isAuthorized()) throw new Error('Требуется авторизация');
    const id = parseInt(ownerId, 10);
    if (id < 0) {
      return this.callMethod('groups.join', { group_id: Math.abs(id) });
    } else if (id > 0) {
      return this.callMethod('friends.add', { user_id: id });
    }
    throw new Error('Некорректный ID канала');
  }

  /**
   * Unsubscribe from a channel / community / creator
   */
  async unsubscribeChannel(ownerId) {
    if (!this.isAuthorized()) throw new Error('Требуется авторизация');
    const id = parseInt(ownerId, 10);
    if (id < 0) {
      return this.callMethod('groups.leave', { group_id: Math.abs(id) });
    } else if (id > 0) {
      return this.callMethod('friends.delete', { user_id: id });
    }
    throw new Error('Некорректный ID канала');
  }

  /**
   * Check if user is subscribed to a channel
   */
  async checkIsSubscribed(ownerId) {
    if (!this.isAuthorized()) return false;
    const id = parseInt(ownerId, 10);
    try {
      if (id < 0) {
        const resp = await this.callMethod('groups.isMember', { group_id: Math.abs(id) });
        return resp === 1 || (resp && resp.response === 1);
      } else if (id > 0) {
        const resp = await this.callMethod('friends.areFriends', { user_ids: id });
        const items = Array.isArray(resp) ? resp : (resp && resp.response) || [];
        return items.length > 0 && (items[0].friend_status === 3 || items[0].friend_status === 1);
      }
    } catch (e) {
      console.warn('[VKApi] checkIsSubscribed error:', e);
    }
    return false;
  }

  /**
   * Extract meaningful semantic search seeds from user watch history
   */
  extractRecommendationSeeds(localHistory = []) {
    const seeds = [];
    const seen = new Set();

    const addSeed = (text) => {
      if (!text) return;
      let clean = text.replace(/#\d+/g, '')
                      .replace(/\([^)]*\)/g, '')
                      .replace(/\b(202[0-9]|сезон\s*\d+|выпуск\s*\d+)\b/gi, '')
                      .trim();
      if (clean.length >= 4 && clean.length <= 40) {
        const lower = clean.toLowerCase();
        if (!seen.has(lower) && !lower.includes('доклад') && !lower.includes('видео')) {
          seen.add(lower);
          seeds.push(clean);
        }
      }
    };

    for (const h of localHistory) {
      if (!h) continue;
      if (h.title) {
        const t = h.title.trim();
        const parts = t.split(/[|—:\/«»]/).map(s => s.trim()).filter(s => s.length >= 3);
        
        if (parts.length > 0) {
          addSeed(parts[0]);
        }
        if (parts.length > 1) {
          addSeed(parts[1]);
        }
      }

      if (h.author && typeof h.author === 'string') {
        const a = h.author.trim();
        const aLower = a.toLowerCase();
        if (a.length >= 4 && a.length <= 35 && !aLower.includes('vk') && !aLower.includes('видео') && !aLower.includes('video')) {
          addSeed(a);
        }
      }

      if (seeds.length >= 20) break;
    }
    return seeds;
  }

  /**
   * Compute genre and creator affinity scores from user watch history, subscriptions, server feed and fave pages
   */
  analyzeUserPreferences(localHistory = [], userChannels = [], serverFeedVideos = [], favePages = []) {
    const GENRE_POOLS = {
      comedy: {
        name: 'Шоу и комедия',
        keywords: [
          'шоу', 'ида галич', 'иды галич', 'галич', 'есть вопросики', '1-11', 'не молчи',
          'контакты', 'неигры', 'громкий вопрос', 'стыдно', 'женский форум', 'кстати', 'чбд',
          'плюшки', 'стендап', 'stand up', 'разгоны', 'натальная карта', 'юмор', 'комик', 'пвн',
          'битва за время', 'дорохов', 'харламов', 'мусагалиев', 'шастун', 'импроком', 'сатир',
          'соболев', 'labelsmart', 'вписка', 'шоу вписка', 'вопрос ребром', 'баста', 'минаев'
        ],
        channels: [-125215074, -213802301, -149430811, -110135406, -211232966, -211229778, -209976560, -1415705, -196446247, -220754053]
      },
      cinema: {
        name: 'Кино и обзоры',
        keywords: ['фильм', 'сериал', 'кино', 'кинопоиск', 'badcomedian', 'обзор фильма', 'трейлер', 'серия', 'актер', 'режиссер', 'экранизация', 'разбор', 'ленфильм'],
        channels: [-108468, -25557243, -29534144, -22822305, -73154028]
      },
      tech: {
        name: 'Технологии и гаджеты',
        keywords: ['обзор', 'тест', 'ноутбук', 'смартфон', 'пк', 'процессор', 'видеокарта', 'ixbt', 'rozetked', 'wylsa', 'wylsacom', 'гаджет', 'apple', 'iphone', 'android', 'amd', 'nvidia', 'intel', 'монитор', '3d'],
        channels: [-39447662, -26284064, -1112285]
      },
      gaming: {
        name: 'Игры',
        keywords: ['игра', 'геймплей', 'летсплей', 'igm', 'stopgame', 'steam', 'ps5', 'игры', 'прохождение'],
        channels: [-30602036, -27638890]
      },
      nature_4k: {
        name: 'Природа и 4K',
        keywords: ['природа', '4k', 'hdr', 'ultra hd', 'планета', 'wildlife', 'животные', 'релакс', 'пейзаж', 'dolby vision', '8k'],
        channels: [-237581709, -184206533]
      }
    };

    const scores = {
      comedy: 5,
      cinema: 3,
      tech: 2,
      gaming: 1,
      nature_4k: 1
    };

    // 1. Score from watch history (heavily weighted towards recent watches)
    localHistory.forEach((h, idx) => {
      if (!h) return;
      const weight = Math.max(1.0 - idx * 0.1, 0.2);
      const text = `${h.title || ''} ${h.author || ''}`.toLowerCase();
      const ownerId = h.id ? parseInt(h.id.split('_')[0], 10) : 0;

      for (const [genreKey, def] of Object.entries(GENRE_POOLS)) {
        if (ownerId && def.channels.includes(ownerId)) {
          scores[genreKey] = (scores[genreKey] || 0) + 12 * weight;
        }
        for (const kw of def.keywords) {
          if (text.includes(kw)) {
            scores[genreKey] = (scores[genreKey] || 0) + 3.5 * weight;
            break;
          }
        }
      }
    });

    // 2. Score from user subscriptions (groups.get)
    userChannels.forEach(ch => {
      if (!ch) return;
      const text = `${ch.name || ''} ${ch.activity || ''}`.toLowerCase();
      const chOwnerId = -Math.abs(ch.id);

      for (const [genreKey, def] of Object.entries(GENRE_POOLS)) {
        if (def.channels.includes(chOwnerId)) {
          scores[genreKey] = (scores[genreKey] || 0) + 6;
        }
        for (const kw of def.keywords) {
          if (text.includes(kw)) {
            scores[genreKey] = (scores[genreKey] || 0) + 2.0;
            break;
          }
        }
      }
    });

    // 3. Score from server fave pages (fave.getPages)
    if (Array.isArray(favePages)) {
      favePages.forEach(p => {
        const g = p.group || p;
        if (!g) return;
        const text = `${g.name || ''} ${g.activity || ''}`.toLowerCase();
        const chOwnerId = -Math.abs(g.id || 0);

        for (const [genreKey, def] of Object.entries(GENRE_POOLS)) {
          if (def.channels.includes(chOwnerId)) {
            scores[genreKey] = (scores[genreKey] || 0) + 15;
          }
          for (const kw of def.keywords) {
            if (text.includes(kw)) {
              scores[genreKey] = (scores[genreKey] || 0) + 4.0;
              break;
            }
          }
        }
      });
    }

    // 4. Score from server newsfeed video feed (newsfeed.get)
    if (Array.isArray(serverFeedVideos)) {
      serverFeedVideos.forEach(v => {
        if (!v) return;
        const text = `${v.title || ''} ${v.author || ''}`.toLowerCase();
        const ownerId = v.id ? parseInt(v.id.split('_')[0], 10) : 0;

        for (const [genreKey, def] of Object.entries(GENRE_POOLS)) {
          if (ownerId && def.channels.includes(ownerId)) {
            scores[genreKey] = (scores[genreKey] || 0) + 8;
          }
          for (const kw of def.keywords) {
            if (text.includes(kw)) {
              scores[genreKey] = (scores[genreKey] || 0) + 2.5;
              break;
            }
          }
        }
      });
    }

    return Object.entries(GENRE_POOLS)
      .map(([key, def]) => ({
        key,
        score: scores[key] || 0,
        channels: def.channels
      }))
      .sort((a, b) => b.score - a.score);
  }

  parseSearchRecommendationResponse(resp, userGroupIds, excludedIds, maxAgeDays = 540) {
    if (!resp || !resp.items || !Array.isArray(resp.items)) return [];

    const now = Math.floor(Date.now() / 1000);
    const maxAgeSeconds = maxAgeDays * 86400;

    const groupsMap = {};
    if (resp.groups && Array.isArray(resp.groups)) {
      for (const g of resp.groups) groupsMap[g.id] = g.name;
    }
    const profilesMap = {};
    if (resp.profiles && Array.isArray(resp.profiles)) {
      for (const p of resp.profiles) {
        profilesMap[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      }
    }

    const allVideos = [];
    const freshVideos = [];
    for (const item of resp.items) {
      const vidId = `${item.owner_id}_${item.id}`;
      if (excludedIds.has(vidId)) continue;
      if (userGroupIds.has(item.owner_id)) continue;
      if (!this.isFullLengthVideo(item, 240)) continue;

      const titleLower = (item.title || '').toLowerCase();
      if (
        titleLower.includes('своими руками') ||
        titleLower.includes('обточим ваш') ||
        titleLower.includes('реакция') ||
        titleLower.includes('пародия') ||
        titleLower.includes('нарезка')
      ) {
        continue;
      }

      const formatted = this.formatVideoItem(item);
      const author = item.owner_id < 0
        ? (groupsMap[Math.abs(item.owner_id)] || formatted.author)
        : (profilesMap[item.owner_id] || formatted.author);
      formatted.author = author;
      allVideos.push(formatted);

      if (!item.date || (now - Number(item.date)) <= maxAgeSeconds) {
        freshVideos.push(formatted);
      }
    }
    return freshVideos.length > 0 ? freshVideos : allVideos;
  }

  /**
   * Format raw catalog/block video objects with resolved group/profile authors & server viewed_duration
   */
  formatCatalogVideos(rawVideos = [], groupsList = [], profilesList = [], minDuration = 120) {
    if (!Array.isArray(rawVideos) || rawVideos.length === 0) return [];
    const groupsMap = {};
    if (Array.isArray(groupsList)) {
      for (const g of groupsList) {
        if (g && g.id) groupsMap[Math.abs(g.id)] = g.name || '';
      }
    }
    const profilesMap = {};
    if (Array.isArray(profilesList)) {
      for (const p of profilesList) {
        if (p && p.id) {
          profilesMap[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim();
        }
      }
    }

    const out = [];
    const seen = new Set();
    for (const v of rawVideos) {
      if (!v || !v.id || v.owner_id === undefined) continue;
      if (!this.isFullLengthVideo(v, minDuration)) continue;
      const formatted = this.formatVideoItem(v);
      if (seen.has(formatted.id)) continue;
      seen.add(formatted.id);

      const resolvedAuthor = v.owner_id < 0
        ? groupsMap[Math.abs(v.owner_id)]
        : profilesMap[v.owner_id];
      if (resolvedAuthor) formatted.author = resolvedAuthor;

      formatted.rawDuration = Number(v.duration) || 0;
      formatted.viewedDuration = Number(v.viewed_duration) || 0;
      out.push(formatted);
    }
    return out;
  }

  /**
   * Fetch cross-device server Watch History ("Продолжить просмотр") + server Personal Feed ("Все")
   * from official VK Video Smart TV catalog endpoints (catalog.getVideoSmartTV -> catalog.getSectionBlocksLinks -> catalog.getBlockItems).
   */
  async getSmartTVServerContext(forceRefresh = false, historyLimit = 40) {
    const empty = { watchHistory: [], personalFeedVideos: [], serverProgress: {} };
    if (!this.isAuthorized()) return empty;

    const nowMs = Date.now();
    if (
      !forceRefresh &&
      this._smartTvContextCache &&
      this._smartTvContextToken === this.userToken &&
      (nowMs - (this._smartTvContextCacheTime || 0) < 45000)
    ) {
      return this._smartTvContextCache;
    }

    try {
      const smartResp = await this.callMethod('catalog.getVideoSmartTV', {
        need_stub_blocks: 1,
        ref: 'main'
      }).catch(() => null);

      const sections = (smartResp && smartResp.catalog && Array.isArray(smartResp.catalog.sections))
        ? smartResp.catalog.sections
        : [];
      if (sections.length === 0) return empty;

      const mainSec = sections.find(s => s && (s.url === 'https://vkvideo.ru' || s.title === 'Главная')) || sections[1] || sections[0];
      if (!mainSec || !mainSec.id) return empty;

      const linksResp = await this.callMethod('catalog.getSectionBlocksLinks', {
        section_id: mainSec.id,
        need_first_block_data: 1,
        count: 20
      }).catch(() => null);

      if (!linksResp) return empty;

      // 1. Personal server feed ("Все" first block)
      let personalFeedVideos = [];
      const fbd = linksResp.first_block_data;
      if (fbd && Array.isArray(fbd.videos)) {
        personalFeedVideos = this.formatCatalogVideos(fbd.videos, fbd.groups || [], fbd.profiles || [], 180)
          .map(v => ({ ...v, isRecommended: true }));
      }

      // 2. Server-side Watch History ("Продолжить просмотр" block)
      const blocks = Array.isArray(linksResp.blocks) ? linksResp.blocks : [];
      const cwBlock = blocks.find(b => b && typeof b.title === 'string' && b.title.toLowerCase().includes('продолжить')) || blocks[1];

      let watchHistory = [];
      const serverProgress = {};

      if (cwBlock && cwBlock.block_id) {
        const cwResp = await this.callMethod('catalog.getBlockItems', {
          block_id: cwBlock.block_id
        }).catch(() => null);

        if (cwResp && Array.isArray(cwResp.videos)) {
          watchHistory.push(...this.formatCatalogVideos(cwResp.videos, cwResp.groups || [], cwResp.profiles || [], 120));

          const nextFrom = cwResp.block && cwResp.block.next_from;
          if (historyLimit > 20 && nextFrom) {
            const cwResp2 = await this.callMethod('catalog.getBlockItems', {
              block_id: cwBlock.block_id,
              start_from: nextFrom
            }).catch(() => null);
            if (cwResp2 && Array.isArray(cwResp2.videos)) {
              const seenIds = new Set(watchHistory.map(v => v.id));
              for (const item of this.formatCatalogVideos(cwResp2.videos, cwResp2.groups || [], cwResp2.profiles || [], 120)) {
                if (!seenIds.has(item.id)) {
                  seenIds.add(item.id);
                  watchHistory.push(item);
                }
              }
            }
          }
        }
      }

      for (const v of watchHistory) {
        if (v.viewedDuration > 15 && v.rawDuration > 30 && v.viewedDuration < v.rawDuration - 12) {
          const pct = Math.min(100, Math.round((v.viewedDuration / v.rawDuration) * 100));
          if (pct <= 92) {
            serverProgress[v.id] = {
              currentTime: Math.floor(v.viewedDuration),
              duration: Math.floor(v.rawDuration),
              percent: pct,
              timestamp: nowMs,
              fromServer: true
            };
            v.progressPercent = pct;
          }
        }
      }

      const ctx = {
        watchHistory: watchHistory.slice(0, historyLimit),
        personalFeedVideos,
        serverProgress
      };
      this._smartTvContextCache = ctx;
      this._smartTvContextToken = this.userToken;
      this._smartTvContextCacheTime = nowMs;
      return ctx;
    } catch (e) {
      console.warn('[VKApi] getSmartTVServerContext error:', e);
      return empty;
    }
  }

  /**
   * Fetch user's cross-device VK Video watch history from server
   */
  async getServerWatchHistory(limit = 40) {
    const ctx = await this.getSmartTVServerContext(false, limit);
    return (ctx && Array.isArray(ctx.watchHistory)) ? ctx.watchHistory : [];
  }

  /**
   * Fetch VK's native "Similar / Discover" recommendations for recent watched videos
   * using video.getVideoDiscover.
   */
  async getVideoDiscoverRecommendations(seedVideos = [], excludedIds = new Set(), perSeedCount = 8) {
    if (!Array.isArray(seedVideos) || seedVideos.length === 0) return [];
    const seeds = seedVideos.filter(v => v && v.id && v.id.includes('_')).slice(0, 5);
    if (seeds.length === 0) return [];

    try {
      const results = await Promise.all(seeds.map(seed => {
        const parts = String(seed.id).split('_');
        const ownerId = parseInt(parts[0], 10);
        const videoId = parseInt(parts[1], 10);
        if (!ownerId || !videoId || isNaN(ownerId) || isNaN(videoId)) return Promise.resolve([]);

        return this.callMethod('video.getVideoDiscover', {
          owner_id: ownerId,
          video_id: videoId,
          ref: 'main',
          count: perSeedCount,
          extended: 1
        }).then(resp => {
          if (!resp || !Array.isArray(resp.items)) return [];
          return this.formatCatalogVideos(resp.items, resp.groups || [], resp.profiles || [], 240)
            .filter(v => !excludedIds.has(v.id))
            .map(v => ({ ...v, isRecommended: true, isDiscover: true }));
        }).catch(() => []);
      }));

      const seen = new Set();
      const merged = [];
      const maxLen = Math.max(...results.map(r => r.length), 0);
      for (let i = 0; i < maxLen; i++) {
        for (const list of results) {
          if (list[i] && !seen.has(list[i].id)) {
            seen.add(list[i].id);
            merged.push(list[i]);
          }
        }
      }
      return merged;
    } catch (e) {
      console.warn('[VKApi] getVideoDiscoverRecommendations error:', e);
      return [];
    }
  }

  /**
   * Normalize video title for cross-source deduplication (catches reposts/duplicates with vs without recommendation badges)
   */
  normalizeVideoTitleKey(title) {
    if (!title || typeof title !== 'string') return '';
    return title
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Deduplicate a video array by exact ID and normalized title (for titles >= 12 chars)
   */
  deduplicateVideos(videos = [], seenIds = null, seenTitles = null) {
    const ids = seenIds || new Set();
    const titles = seenTitles || new Set();
    const result = [];
    for (const v of videos) {
      if (!v || !v.id) continue;
      if (ids.has(v.id)) continue;
      const tKey = this.normalizeVideoTitleKey(v.title);
      if (tKey.length >= 12 && titles.has(tKey)) continue;
      ids.add(v.id);
      if (tKey.length >= 12) titles.add(tKey);
      result.push(v);
    }
    return result;
  }

  /**
   * Merge local watch history with server cross-device watch history (preserving local order first)
   */
  mergeHistories(localHistory = [], serverHistory = []) {
    const merged = [];
    const seen = new Set();
    for (const list of [localHistory, serverHistory]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && item.id && !seen.has(item.id)) {
          seen.add(item.id);
          merged.push(item);
        }
      }
    }
    return merged;
  }

  /**
   * Smart Contextual & Affinity Recommendations:
   * 1. Analyzes user watch history, subscriptions, fave creators & server newsfeed to compute genre affinity.
   * 2. Fetches VK native similarity matches via video.getVideoDiscover for recent watched videos.
   * 3. Extracts dynamic semantic search seeds from recently watched titles to find fresh episodes/related content.
   * 4. Fetches candidate videos from premier channels and lookalikes.
   * 5. Excludes videos already watched and applies hybrid affinity scoring.
   */
  async getSmartRecommendations(userGroupIds, localHistory = [], watchProgress = {}, userChannels = [], targetCount = 72, serverFeedVideos = [], favePages = []) {
    try {
      const excludedIds = new Set();
      for (const h of localHistory) {
        if (h && h.id) excludedIds.add(h.id);
      }
      for (const [vidId, p] of Object.entries(watchProgress)) {
        if (p && (p.percent > 40 || p.currentTime > 180)) {
          excludedIds.add(vidId);
        }
      }

      // 1. Analyze genre preferences with server signals
      const genreProfile = this.analyzeUserPreferences(localHistory, userChannels, serverFeedVideos, favePages);
      
      // 2. Extract seeds from history items
      const seeds = this.extractRecommendationSeeds(localHistory);

      // 3. Parallel fetch: Native VK Video Discover + Premier creator channels + Semantic searches on user seeds
      const discoverPromise = this.getVideoDiscoverRecommendations(localHistory, excludedIds, 8).catch(() => []);

      // A. Top Premier Popular Channels (Ida Galich, Shastun, Vpiska, Azamat, Natalnaya Karta, Minaev Live, etc.)
      const premierChannels = this.getPremierPopularChannels();
      const targetChannels = [];
      const addedChannelIds = new Set();

      for (const p of premierChannels) {
        if (!userGroupIds.has(p.id) && !addedChannelIds.has(p.id)) {
          addedChannelIds.add(p.id);
          targetChannels.push(p);
        }
      }

      // Merge lookalike channels for user-specific top genres
      const topGenres = genreProfile.slice(0, 3);
      for (const g of topGenres) {
        for (const chId of g.channels) {
          if (!userGroupIds.has(chId) && !addedChannelIds.has(chId)) {
            addedChannelIds.add(chId);
            targetChannels.push({ id: chId, name: '' });
            if (targetChannels.length >= 24) break;
          }
        }
      }

      const premierPromises = targetChannels.slice(0, 18).map(ch =>
        this.getChannelVideos(ch.id, 6, ch.name, 240).catch(() => [])
      );

      // B. Semantic seed searches from user history (for personalized affinity discovery)
      const seedPromises = seeds.slice(0, 8).map(seed =>
        this.callMethod('video.search', {
          q: seed,
          count: 8,
          filters: 'long',
          sort: 0,
          extended: 1
        }).then(resp => this.parseSearchRecommendationResponse(resp, userGroupIds, excludedIds, 540)).catch(() => [])
      );

      const [discoverVideos, premierChannelResults, searchResults] = await Promise.all([
        discoverPromise,
        Promise.all(premierPromises),
        Promise.all(seedPromises)
      ]);

      const seen = new Set();
      const now = Math.floor(Date.now() / 1000);
      const MAX_REC_AGE = 540 * 86400; // 1.5 years freshness

      // Native VK Video Discover results (highest similarity to user's actual watch history)
      const discoverList = [];
      for (const v of discoverVideos) {
        if (v && v.id && !seen.has(v.id) && !excludedIds.has(v.id)) {
          if (!v.date || (now - Number(v.date)) <= MAX_REC_AGE) {
            seen.add(v.id);
            discoverList.push(v);
          }
        }
      }

      // Balanced premier list
      const premierList = [];
      const maxPerCh = Math.max(...premierChannelResults.map(l => (Array.isArray(l) ? l.length : 0)), 0);
      for (let i = 0; i < maxPerCh; i++) {
        for (const list of premierChannelResults) {
          if (Array.isArray(list) && list[i]) {
            const v = list[i];
            if (v && v.id && !seen.has(v.id) && !excludedIds.has(v.id)) {
              if (!v.date || (now - Number(v.date)) <= MAX_REC_AGE) {
                seen.add(v.id);
                premierList.push({ ...v, isRecommended: true });
              }
            }
          }
        }
      }

      // Personalized seed results
      const seedList = [];
      const flatSeeds = searchResults.flat().filter(Boolean);
      for (const v of flatSeeds) {
        if (v && v.id && !seen.has(v.id) && !excludedIds.has(v.id)) {
          seen.add(v.id);
          seedList.push({ ...v, isRecommended: true });
        }
      }

      // Server newsfeed & SmartTV "Все" videos (VK's algorithmic server recommendations)
      const serverNewsfeedList = [];
      if (Array.isArray(serverFeedVideos)) {
        for (const sv of serverFeedVideos) {
          if (sv && sv.id && !seen.has(sv.id) && !excludedIds.has(sv.id)) {
            seen.add(sv.id);
            serverNewsfeedList.push({ ...sv, isRecommended: true });
          }
        }
      }

      // 4. Hybrid Scoring for true relevance (No flat destructive date sort)
      const faveOwnerIds = new Set((favePages || []).map(p => -Math.abs((p.group || p).id || 0)));
      const premierOwnerIds = new Set(premierChannels.map(c => c.id));
      const topKeywords = topGenres.flatMap(g => g.key === 'comedy' ? ['шоу', 'вопрос', 'галич', 'шастун', 'вписка', 'карта', 'юмор', 'чбд', 'большое'] : []);

      const allCandidates = [...discoverList, ...serverNewsfeedList, ...seedList, ...premierList];
      const scored = allCandidates.map(v => {
        let score = 50;
        const ownerId = parseInt((v.id || '').split('_')[0], 10);
        if (v.isDiscover) score += 45;
        if (faveOwnerIds.has(ownerId)) score += 40;
        if (userGroupIds.has(ownerId)) score += 30;
        if (premierOwnerIds.has(ownerId)) score += 35;

        const text = `${v.title || ''} ${v.author || ''}`.toLowerCase();
        for (const kw of topKeywords) {
          if (text.includes(kw)) { score += 15; break; }
        }

        const viewsNum = typeof v.views === 'number' ? v.views : (parseInt(String(v.views).replace(/\D/g, ''), 10) || 0);
        if (viewsNum > 500000) score += 20;
        else if (viewsNum > 100000) score += 10;
        if (v.is4K) score += 10;

        // Smooth decay over 180 days half-life (preserves week-old top show premieres over random 10-minute clips)
        const ageDays = v.date ? Math.max(0, (now - Number(v.date)) / 86400) : 30;
        const freshnessFactor = Math.max(0.35, 1.0 - (ageDays / 240) * 0.65);
        return { video: v, score: score * freshnessFactor };
      });

      scored.sort((a, b) => b.score - a.score);

      // Diversity enforcement: max 3 videos per channel in top shelf
      const channelCounts = {};
      const blended = [];
      for (const item of scored) {
        const ownerId = (item.video.id || '').split('_')[0];
        if ((channelCounts[ownerId] || 0) < 3) {
          channelCounts[ownerId] = (channelCounts[ownerId] || 0) + 1;
          blended.push(item.video);
        }
        if (blended.length >= targetCount) break;
      }

      // Fallback: if blended is empty (e.g. in offline unit tests), pull trending
      if (blended.length === 0) {
        const fallback = await this.getTrending(targetCount).catch(() => []);
        return fallback.map(v => ({ ...v, isRecommended: true }));
      }

      return blended.slice(0, targetCount);
    } catch (e) {
      console.warn('[VKApi] getSmartRecommendations error:', e);
      return [];
    }
  }

  /**
   * Flagship Smart TV Home Showcase Catalog:
   * Generates Hero Spotlight Banner + Thematic Horizontal Shelves (Rails):
   * 1. Hero Showcase (Latest premier flagship show: Ida Galich / Shastun / Azamat / Vpiska)
   * 2. Continue Watching (if videos in progress exist: percent 5% to 92%)
   * 3. For You / Personal Recommendations (Hybrid Affinity Score combining server signals + smooth freshness decay)
   * 4. New from Subscriptions (Chronological uploads from user's 400+ channels)
   * 5. Popular Shows & Comedy (Ida Galich, Shastun, Vpiska, Azamat, Natalnaya Karta, Zhenskiy Forum, Labelcom, Gaz, Minaev)
   * 6. Cinema & Reviews (Kinopoisk, BadComedian, etc.)
   * 7. Tech & Science (Wylsacom, Rozetked, iXBT, etc.)
   * 8. Trending Platform Hits (From VK Catalog / Trends)
   */
  async getHomeCatalog(passedHistory = null, passedProgress = null) {
    const isAuth = this.isAuthorized();
    let localHistory = [];
    let watchProgress = {};

    if (Array.isArray(passedHistory)) {
      localHistory = passedHistory;
    } else {
      try {
        const activeId = (typeof localStorage !== 'undefined') ? localStorage.getItem('vk_active_user_id') : null;
        const scopedKey = activeId ? `vk_history_${activeId}` : 'vk_history';
        localHistory = (typeof localStorage !== 'undefined')
          ? JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('vk_history') || '[]')
          : [];
      } catch (e) {}
    }

    if (passedProgress && typeof passedProgress === 'object') {
      watchProgress = passedProgress;
    } else {
      try {
        const activeId = (typeof localStorage !== 'undefined') ? localStorage.getItem('vk_active_user_id') : null;
        const scopedKey = activeId ? `vk_watch_progress_${activeId}` : 'vk_watch_progress';
        watchProgress = (typeof localStorage !== 'undefined')
          ? JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('vk_watch_progress') || '{}')
          : {};
      } catch (e) {}
    }

    const now = Math.floor(Date.now() / 1000);
    const MAX_SHOW_AGE = 540 * 86400; // 1.5 years freshness
    const premierChannels = this.getPremierPopularChannels();

    // 1. GUEST MODE (Not Authorized)
    if (!isAuth) {
      try {
        const [trending, premierResults] = await Promise.all([
          this.getTrending(36).catch(() => []),
          Promise.all(premierChannels.slice(0, 8).map(ch =>
            this.getChannelVideos(ch.id, 6, ch.name, 240).catch(() => [])
          ))
        ]);

        // Interleave premier show episodes
        const popularShows = [];
        const maxPerCh = Math.max(...premierResults.map(l => (Array.isArray(l) ? l.length : 0)), 0);
        const seenShowIds = new Set();
        for (let i = 0; i < maxPerCh; i++) {
          for (const list of premierResults) {
            if (Array.isArray(list) && list[i]) {
              const v = list[i];
              if (v && v.id && !seenShowIds.has(v.id)) {
                seenShowIds.add(v.id);
                popularShows.push(v);
              }
            }
          }
        }

        const heroCandidate = popularShows[0] || trending[0] || null;
        const shelves = [];

        if (popularShows.length > 0) {
          shelves.push({
            id: 'popular_shows',
            title: 'Популярные шоу и юмор',
            subtitle: 'Ида Галич, ШАСТУН, Шоу ВПИСКА, Азамат, Натальная карта, Женский Форум',
            items: popularShows.slice(0, 24)
          });
        }

        if (trending.length > 0) {
          shelves.push({
            id: 'trending',
            title: 'Тренды VK Видео',
            subtitle: 'Главные хиты и популярные ролики платформы',
            items: trending.slice(0, 24)
          });
        }

        return {
          hero: heroCandidate,
          shelves
        };
      } catch (e) {
        console.warn('[VKApi] getHomeCatalog guest error:', e);
        const fallbackTrending = await this.getTrending(24).catch(() => []);
        return {
          hero: fallbackTrending[0] || null,
          shelves: [{ id: 'trending', title: 'Тренды', subtitle: 'Популярное в VK Видео', items: fallbackTrending }]
        };
      }
    }

    // 2. AUTHORIZED MODE: Full 10-Foot UI Showcase
    try {
      // Step A: Fetch user channels, favorite pages and server newsfeed video recommendations in parallel
      const [groupsResp, faveResp, newsfeedResp] = await Promise.all([
        this.callMethod('groups.get', {
          extended: 1,
          count: 200,
          fields: 'activity,members_count,verified,description'
        }).catch(() => ({ items: [] })),
        this.callMethod('fave.getPages', {
          type: 'groups',
          count: 50
        }).catch(() => ({ items: [] })),
        this.callMethod('newsfeed.get', {
          filters: 'video',
          count: 40
        }).catch(() => ({ items: [] }))
      ]);

      const allGroups = (groupsResp && groupsResp.items) ? groupsResp.items : [];
      const favePages = (faveResp && faveResp.items) ? faveResp.items : [];

      const stopWords = [
        'администрация', 'муниципал', 'оханск', 'мбоу', 'сош', 'дума',
        'орган власти', 'госуслуг', 'подслушано', 'объявлен', 'барахолк',
        'детский сад', 'поликлиника', 'больница', 'жкх', 'суд', 'газета',
        'wildberries', 'ozon', 'lamoda', 'wb', 'находки', 'aliexpress',
        'маникюр', 'ногти', 'прически', 'макияж',
        'доставка', 'суши', 'роллы', 'кафе', 'торт', 'клубника',
        'цветы', 'букет',
        'дизайн интерьер', 'интерьер и декор',
        'выкройки', 'пошив', 'аренда', 'мебели', 'обои', 'финунивер', 'нсо '
      ];

      const isEntertainment = (g) => {
        if (!g) return false;
        const name = (g.name || '').toLowerCase();
        const act = (g.activity || '').toLowerCase();
        for (const sw of stopWords) {
          if (name.includes(sw) || act.includes(sw)) return false;
        }
        return true;
      };

      const entertainmentChannels = allGroups.filter(isEntertainment);
      const userGroupIds = new Set(allGroups.map(g => -Math.abs(g.id)));

      // Extract server newsfeed video items
      const serverFeedVideos = [];
      const nfGroupsMap = {};
      if (newsfeedResp && Array.isArray(newsfeedResp.groups)) {
        for (const g of newsfeedResp.groups) nfGroupsMap[g.id] = g.name;
      }
      if (newsfeedResp && Array.isArray(newsfeedResp.items)) {
        for (const item of newsfeedResp.items) {
          const itemVids = [];
          if (item.video && Array.isArray(item.video.items)) itemVids.push(...item.video.items);
          if (item.attachments && Array.isArray(item.attachments)) {
            for (const att of item.attachments) {
              if (att.type === 'video' && att.video) itemVids.push(att.video);
            }
          }
          for (const v of itemVids) {
            if (this.isFullLengthVideo(v, 180)) {
              const formatted = this.formatVideoItem(v);
              if (v.owner_id < 0 && nfGroupsMap[Math.abs(v.owner_id)]) {
                formatted.author = nfGroupsMap[Math.abs(v.owner_id)];
              }
              serverFeedVideos.push(formatted);
            }
          }
        }
      }

      // Rank user's subscribed channels (prioritizing verified creators and member volume)
      const rankedSubscribedChannels = [...entertainmentChannels].sort((a, b) => {
        const scoreA = (a.verified ? 60 : 0) + (a.members_count > 0 ? Math.log10(a.members_count) * 20 : 0);
        const scoreB = (b.verified ? 60 : 0) + (b.members_count > 0 ? Math.log10(b.members_count) * 20 : 0);
        return scoreB - scoreA;
      });

      // Step B: Parallel fetch channel videos across categories
      // 1. Subscribed channels (top 14)
      const subChannelPromises = rankedSubscribedChannels.slice(0, 14).map(ch =>
        this.getChannelVideos(-ch.id, 8, ch.name, 240).catch(() => [])
      );

      // 2. Premier Russian Creator Channels (Ida Galich, Shastun, Vpiska, Azamat, Natalnaya Karta, Zhenskiy Forum, Labelcom, Gaz, Minaev)
      const premierPromises = premierChannels.slice(0, 10).map(ch =>
        this.getChannelVideos(ch.id, 8, ch.name, 240).catch(() => [])
      );

      // 3. Cinema Channels (Kinopoisk, BadComedian, Lenfilm)
      const cinemaChannels = [
        { id: -108468, name: 'Кинопоиск' },
        { id: -25557243, name: 'BadComedian' },
        { id: -29534144, name: 'Киностудия «Ленфильм»' }
      ];
      const cinemaPromises = cinemaChannels.map(ch =>
        this.getChannelVideos(ch.id, 8, ch.name, 240).catch(() => [])
      );

      // 4. Tech Channels (Rozetked, Wylsacom, iXBT)
      const techChannels = [
        { id: -39447662, name: 'Rozetked' },
        { id: -26284064, name: 'Wylsacom' },
        { id: -1112285, name: 'iXBT.com' }
      ];
      const techPromises = techChannels.map(ch =>
        this.getChannelVideos(ch.id, 8, ch.name, 240).catch(() => [])
      );

      // 5. Smart Personalized Recommendations (Hybrid Affinity Scoring)
      const recPromise = this.getSmartRecommendations(
        userGroupIds,
        localHistory,
        watchProgress,
        rankedSubscribedChannels,
        28,
        serverFeedVideos,
        favePages
      ).catch(() => []);

      // 6. Trending hits
      const trendingPromise = this.getTrending(24).catch(() => []);

      const [
        subResults,
        premierResults,
        cinemaResults,
        techResults,
        recVideos,
        trendingVideos
      ] = await Promise.all([
        Promise.all(subChannelPromises),
        Promise.all(premierPromises),
        Promise.all(cinemaPromises),
        Promise.all(techPromises),
        recPromise,
        trendingPromise
      ]);

      // Step C: Build Shelves

      // 1. Continue Watching Shelf (if uncompleted videos exist)
      const continueWatchingVideos = [];
      const watchedVideoIds = new Set();
      for (const [vidId, p] of Object.entries(watchProgress)) {
        if (p && p.percent >= 5 && p.percent <= 92 && (p.currentTime >= 20 || p.percent > 8)) {
          watchedVideoIds.add(vidId);
          const foundInHistory = localHistory.find(h => h && h.id === vidId);
          if (foundInHistory) {
            continueWatchingVideos.push({
              ...foundInHistory,
              progressPercent: Math.round(p.percent),
              lastPosition: p.currentTime
            });
          }
        }
      }

      // 2. Recommendations Shelf («Для вас»)
      const seenGlobal = new Set();
      continueWatchingVideos.forEach(v => seenGlobal.add(v.id));

      const cleanRecVideos = [];
      for (const v of recVideos) {
        if (v && v.id && !seenGlobal.has(v.id)) {
          seenGlobal.add(v.id);
          cleanRecVideos.push({ ...v, isRecommended: true });
        }
      }

      // 3. New from Subscriptions Shelf («Новинки по подпискам»)
      const subFlat = subResults.flat().filter(Boolean);
      const cleanSubVideos = [];
      const subSeen = new Set();
      for (const v of subFlat) {
        if (v && v.id && !subSeen.has(v.id) && !seenGlobal.has(v.id)) {
          if (!v.date || (now - Number(v.date)) <= MAX_SHOW_AGE) {
            subSeen.add(v.id);
            cleanSubVideos.push(v);
          }
        }
      }
      // Subscriptions sorted chronologically (newest uploads first)
      cleanSubVideos.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));

      // 4. Popular Shows & Comedy Shelf («Популярные шоу и юмор»)
      // Round-robin interleave across premier channels
      const popularShows = [];
      const showSeen = new Set();
      const maxPerShow = Math.max(...premierResults.map(l => (Array.isArray(l) ? l.length : 0)), 0);
      for (let i = 0; i < maxPerShow; i++) {
        for (const list of premierResults) {
          if (Array.isArray(list) && list[i]) {
            const v = list[i];
            if (v && v.id && !showSeen.has(v.id)) {
              if (!v.date || (now - Number(v.date)) <= MAX_SHOW_AGE) {
                showSeen.add(v.id);
                popularShows.push(v);
              }
            }
          }
        }
      }

      // 5. Cinema Shelf («Фильмы и обзоры»)
      const cleanCinemaVideos = [];
      const cinemaFlat = cinemaResults.flat().filter(Boolean);
      for (const v of cinemaFlat) {
        if (v && v.id && !seenGlobal.has(v.id)) {
          seenGlobal.add(v.id);
          cleanCinemaVideos.push(v);
        }
      }
      cleanCinemaVideos.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));

      // 6. Tech Shelf («Технологии и наука»)
      const cleanTechVideos = [];
      const techFlat = techResults.flat().filter(Boolean);
      for (const v of techFlat) {
        if (v && v.id && !seenGlobal.has(v.id)) {
          seenGlobal.add(v.id);
          cleanTechVideos.push(v);
        }
      }
      cleanTechVideos.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));

      // 7. Trending Shelf («Тренды платформы»)
      const cleanTrendingVideos = [];
      for (const v of trendingVideos) {
        if (v && v.id && !seenGlobal.has(v.id)) {
          seenGlobal.add(v.id);
          cleanTrendingVideos.push(v);
        }
      }

      // Step D: Hero Showcase (The #1 premier flagship episode)
      // Prioritize top fresh release of Ida Galich, Shastun, Vpiska, or Azamat
      let heroVideo = null;
      if (popularShows.length > 0) {
        heroVideo = popularShows[0];
      } else if (cleanRecVideos.length > 0) {
        heroVideo = cleanRecVideos[0];
      } else if (cleanSubVideos.length > 0) {
        heroVideo = cleanSubVideos[0];
      }

      // Assemble final structured shelves list
      const shelves = [];

      if (continueWatchingVideos.length > 0) {
        shelves.push({
          id: 'continue',
          title: 'Продолжить просмотр',
          subtitle: 'Недосмотренные выпуски и ролики',
          type: 'continue',
          items: continueWatchingVideos.slice(0, 16)
        });
      }

      if (cleanRecVideos.length > 0) {
        shelves.push({
          id: 'recommendations',
          title: 'Для вас',
          subtitle: 'Персональные рекомендации на основе ваших подписок и вкусов',
          items: cleanRecVideos.slice(0, 24)
        });
      }

      if (cleanSubVideos.length > 0) {
        shelves.push({
          id: 'subscriptions',
          title: 'Новинки по подпискам',
          subtitle: `Свежие выпуски от каналов, на которые вы подписаны (${entertainmentChannels.length} каналов)`,
          items: cleanSubVideos.slice(0, 24)
        });
      }

      if (popularShows.length > 0) {
        shelves.push({
          id: 'popular_shows',
          title: 'Популярные шоу и юмор',
          subtitle: 'Ида Галич, ШАСТУН, Шоу ВПИСКА, Азамат, Натальная карта, Женский Форум, Баста',
          items: popularShows.slice(0, 24)
        });
      }

      if (cleanCinemaVideos.length > 0) {
        shelves.push({
          id: 'cinema',
          title: 'Фильмы и обзоры',
          subtitle: 'Кинопоиск, BadComedian, киноленты и обзоры кино',
          items: cleanCinemaVideos.slice(0, 20)
        });
      }

      if (cleanTechVideos.length > 0) {
        shelves.push({
          id: 'tech',
          title: 'Технологии и наука',
          subtitle: 'Wylsacom, Rozetked, iXBT, обзоры гаджетов и новинок',
          items: cleanTechVideos.slice(0, 20)
        });
      }

      if (cleanTrendingVideos.length > 0) {
        shelves.push({
          id: 'trending',
          title: 'Тренды VK Видео',
          subtitle: 'Самые просматриваемые видео платформы',
          items: cleanTrendingVideos.slice(0, 20)
        });
      }

      return {
        hero: heroVideo,
        shelves
      };
    } catch (e) {
      console.warn('[VKApi] getHomeCatalog authorized error:', e);
      const fallback = await this.getTrending(24).catch(() => []);
      return {
        hero: fallback[0] || null,
        shelves: [{ id: 'trending', title: 'Тренды', subtitle: 'Популярное в VK Видео', items: fallback }]
      };
    }
  }

  /**
   * Smart Personalized Feed:
   * 1. Extracts top entertainment/creator channels (VK Affinity ranking + TV watch history + verified creators)
   * 2. Enforces channel diversity: max 6 videos per channel (keyed by owner ID)
   * 3. Fetches fresh full-length widescreen videos from top 80 channels
   * 4. Discovers high-affinity recommendations from related channels and search seeds (up to 72 recommendations)
   * 5. Seamlessly blends them into a rich, expansive 4K TV grid (up to 192 videos)
   */
  async getSmartFeed(count = 192, passedHistory = null, passedProgress = null) {
    if (!this.isAuthorized()) {
      let guestHistory = Array.isArray(passedHistory) ? passedHistory : [];
      if (!guestHistory || guestHistory.length === 0) {
        try {
          guestHistory = JSON.parse((typeof localStorage !== 'undefined') ? localStorage.getItem('vk_history') || '[]' : '[]');
        } catch (e) {}
      }
      if (guestHistory && guestHistory.length > 0) {
        try {
          const recs = await this.getSmartRecommendations(new Set(), guestHistory, passedProgress || {}, [], 64).catch(() => []);
          const trending = await this.getTrending(count).catch(() => []);
          if (recs && recs.length > 0) {
            const seenGuestIds = new Set();
            const seenGuestTitles = new Set();
            const pushUnique = (target, item) => {
              if (!item || !item.id || seenGuestIds.has(item.id)) return false;
              const tKey = this.normalizeVideoTitleKey(item.title);
              if (tKey.length >= 12 && seenGuestTitles.has(tKey)) return false;
              seenGuestIds.add(item.id);
              if (tKey.length >= 12) seenGuestTitles.add(tKey);
              target.push(item);
              return true;
            };
            const merged = [];
            let rIdx = 0;
            for (let i = 0; i < trending.length; i++) {
              pushUnique(merged, trending[i]);
              if (merged.length % 3 === 0) {
                while (rIdx < recs.length && !pushUnique(merged, recs[rIdx++])) {}
              }
            }
            while (rIdx < recs.length && merged.length < count) {
              pushUnique(merged, recs[rIdx++]);
            }
            return merged.slice(0, count);
          }
        } catch (e) {}
      }
      return this.getTrending(count);
    }

    try {
      // 1. Fetch user channels/groups, fave pages, and SmartTV server context (watch history + personal feed) in parallel
      const [topChannelsResp, faveResp, serverCtx] = await Promise.all([
        this.callMethod('groups.get', {
          extended: 1,
          count: 150,
          fields: 'activity,members_count,verified,description'
        }),
        this.callMethod('fave.getPages', {
          type: 'groups',
          count: 50
        }).catch(() => ({ items: [] })),
        this.getSmartTVServerContext(false, 40).catch(() => ({ watchHistory: [], personalFeedVideos: [], serverProgress: {} }))
      ]);

      const stopWords = [
        'администрация', 'муниципал', 'оханск', 'мбоу', 'сош', 'дума',
        'орган власти', 'госуслуг', 'подслушано', 'объявлен', 'барахолк',
        'детский сад', 'поликлиника', 'больница', 'жкх', 'суд', 'новости', 'газета',
        'wildberries', 'ozon', 'lamoda', 'wb', 'находки', 'aliexpress',
        'маникюр', 'ногти', 'прически', 'макияж',
        'доставка', 'суши', 'роллы', 'кафе', 'торт', 'клубника',
        'цветы', 'букет',
        'дизайн интерьер', 'интерьер и декор',
        'выкройки', 'пошив', 'аренда', 'мебели', 'обои', 'финунивер', 'нсо '
      ];

      const isEntertainmentChannel = (g) => {
        if (!g) return false;
        const name = (g.name || '').toLowerCase();
        const act = (g.activity || '').toLowerCase();
        for (const sw of stopWords) {
          if (name.includes(sw) || act.includes(sw)) return false;
        }
        return true;
      };

      const allChannels = (topChannelsResp && topChannelsResp.items) ? topChannelsResp.items : [];
      const entertainmentChannels = allChannels.filter(isEntertainmentChannel);
      const userGroupIds = new Set(allChannels.map(g => -Math.abs(g.id)));
      const favePages = (faveResp && faveResp.items) ? faveResp.items : [];

      // Check user-scoped watch history and progress to boost channels user actually watches
      let localHistory = [];
      let watchProgress = {};
      if (Array.isArray(passedHistory)) {
        localHistory = passedHistory;
      } else {
        try {
          const activeId = (typeof localStorage !== 'undefined') ? localStorage.getItem('vk_active_user_id') : null;
          const scopedKey = activeId ? `vk_history_${activeId}` : 'vk_history';
          localHistory = (typeof localStorage !== 'undefined')
            ? JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('vk_history') || '[]')
            : [];
        } catch (e) {}
      }

      if (passedProgress && typeof passedProgress === 'object') {
        watchProgress = passedProgress;
      } else {
        try {
          const activeId = (typeof localStorage !== 'undefined') ? localStorage.getItem('vk_active_user_id') : null;
          const scopedKey = activeId ? `vk_watch_progress_${activeId}` : 'vk_watch_progress';
          watchProgress = (typeof localStorage !== 'undefined')
            ? JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('vk_watch_progress') || '{}')
            : {};
        } catch (e) {}
      }

      // Merge local TV history with cross-device server history ("Продолжить просмотр")
      const effectiveHistory = this.mergeHistories(localHistory, serverCtx.watchHistory || []);
      this.lastServerProgress = serverCtx.serverProgress || {};
      const effectiveProgress = { ...(serverCtx.serverProgress || {}), ...(watchProgress || {}) };

      const localWatchCounts = {};
      for (const h of effectiveHistory) {
        if (h && h.id) {
          const ownerId = parseInt(h.id.split('_')[0], 10);
          if (ownerId) {
            localWatchCounts[ownerId] = (localWatchCounts[ownerId] || 0) + 1;
          }
        }
      }

      // Rank channels: heavily boost TV & cross-device watched channels, then prioritize verified creators and member volume
      const rankedChannels = [...entertainmentChannels].sort((a, b) => {
        const watchA = (localWatchCounts[-a.id] || 0) * 100;
        const watchB = (localWatchCounts[-b.id] || 0) * 100;
        const scoreA = watchA + (a.verified ? 60 : 0) + (a.members_count > 0 ? Math.log10(a.members_count) * 20 : 0);
        const scoreB = watchB + (b.verified ? 60 : 0) + (b.members_count > 0 ? Math.log10(b.members_count) * 20 : 0);
        return scoreB - scoreA;
      });

      // 2. Concurrently fetch fresh full videos from top 80 channels AND 4x smart personalized recommendations
      // Using minDuration = 240s (4 minutes) to strictly eliminate short clips, teasers, and looping videos
      const topChannelsToQuery = rankedChannels.slice(0, 80);
      const channelPromises = topChannelsToQuery.map(ch =>
        this.getChannelVideos(-ch.id, 10, ch.name, 240).catch(() => [])
      );

      // Smart contextual & affinity recommendations (server history + video.getVideoDiscover + personal feed + keyword seeds)
      const recPromise = this.getSmartRecommendations(
        userGroupIds,
        effectiveHistory,
        effectiveProgress,
        rankedChannels,
        72,
        serverCtx.personalFeedVideos || [],
        favePages
      ).catch(() => []);

      const [channelVideosResults, similarVideos] = await Promise.all([
        Promise.all(channelPromises),
        recPromise
      ]);

      // Combine with diversity limit: max 6 videos per channel (keyed by owner ID)
      const seen = new Set();
      const seenTitles = new Set();
      const channelCounts = {};
      const topChannelVideos = [];

      const addVideoIfEligible = (v) => {
        if (!v || !v.id) return false;
        if (seen.has(v.id)) return false;
        const tKey = this.normalizeVideoTitleKey(v.title);
        if (tKey.length >= 12 && seenTitles.has(tKey)) return false;
        const ownerId = v.id.split('_')[0];
        if ((channelCounts[ownerId] || 0) >= 6) return false;
        seen.add(v.id);
        if (tKey.length >= 12) seenTitles.add(tKey);
        channelCounts[ownerId] = (channelCounts[ownerId] || 0) + 1;
        topChannelVideos.push(v);
        return true;
      };

      // Interleave videos round-robin from top channels
      const maxPerCh = Math.max(...channelVideosResults.map(list => list.length), 0);
      for (let i = 0; i < maxPerCh; i++) {
        for (const list of channelVideosResults) {
          if (list[i]) {
            addVideoIfEligible(list[i]);
          }
        }
      }

      // Filter out stale channel uploads older than 1.5 years if we have enough fresh videos
      const now = Math.floor(Date.now() / 1000);
      const MAX_FEED_AGE = 540 * 86400; // 1.5 years
      const freshChannelVideos = topChannelVideos.filter(v => !v.date || (now - Number(v.date)) <= MAX_FEED_AGE);
      const effectiveChannelVideos = freshChannelVideos.length >= 24 ? freshChannelVideos : topChannelVideos;

      // Rebuild seen sets strictly from what survived into effectiveChannelVideos before blending recommendations
      const finalSeenIds = new Set();
      const finalSeenTitles = new Set();
      const markFinalSeen = (v) => {
        if (!v || !v.id) return false;
        if (finalSeenIds.has(v.id)) return false;
        const tKey = this.normalizeVideoTitleKey(v.title);
        if (tKey.length >= 12 && finalSeenTitles.has(tKey)) return false;
        finalSeenIds.add(v.id);
        if (tKey.length >= 12) finalSeenTitles.add(tKey);
        return true;
      };

      // 3. Interleave smart recommendations evenly across the feed (strictly deduplicated by ID and title!)
      const finalVideos = [];
      let simIdx = 0;
      for (let i = 0; i < effectiveChannelVideos.length; i++) {
        if (markFinalSeen(effectiveChannelVideos[i])) {
          finalVideos.push(effectiveChannelVideos[i]);
        }
        if (finalVideos.length % 3 === 0) {
          while (simIdx < similarVideos.length) {
            const candidate = similarVideos[simIdx++];
            if (markFinalSeen(candidate)) {
              finalVideos.push(candidate);
              break;
            }
          }
        }
      }

      // If any similar videos remaining, append remaining unique ones at end
      while (simIdx < similarVideos.length && finalVideos.length < count) {
        const candidate = similarVideos[simIdx++];
        if (markFinalSeen(candidate)) {
          finalVideos.push(candidate);
        }
      }

      // 5. Chronological sorting for flat feed
      finalVideos.sort((a, b) => {
        const dateA = Number(a.date) || 0;
        const dateB = Number(b.date) || 0;
        return dateB - dateA;
      });

      return finalVideos.slice(0, count);
    } catch (e) {
      console.warn('[VKApi] getSmartFeed error, fallback to feed/trending:', e);
      const fallback = await this.getUserFeed(count, 240);
      return (fallback && fallback.length > 0) ? fallback : this.getTrending(count);
    }
  }

  /**
   * Fetch Next Batch of Videos for Dynamic Endless Scrolling (Infinite Scroll)
   */
  async getMoreSmartFeedVideos(offset = 48, count = 24, passedHistory = null, passedProgress = null) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const MAX_REC_AGE = 540 * 86400; // 1.5 years freshness

      if (!this.isAuthorized()) {
        const trendingNext = await this.getTrending(count, offset % 100);
        let guestHistory = Array.isArray(passedHistory) ? passedHistory : [];
        if (!guestHistory || guestHistory.length === 0) {
          try {
            guestHistory = JSON.parse((typeof localStorage !== 'undefined') ? localStorage.getItem('vk_history') || '[]' : '[]');
          } catch (e) {}
        }
        if (guestHistory && guestHistory.length > 0) {
          const seeds = this.extractRecommendationSeeds(guestHistory);
          const baseSeeds = seeds.length > 0 ? seeds : ['новые шоу', 'комедия', 'стендап', 'обзор', 'новости', 'технологии'];
          const sIdx = Math.floor(offset / 24) * 2;
          const nextSeeds = [
            baseSeeds[sIdx % baseSeeds.length],
            baseSeeds[(sIdx + 1) % baseSeeds.length]
          ];
          const recPromises = nextSeeds.map(s =>
            this.callMethod('video.search', {
              q: s,
              count: 8,
              filters: 'long',
              sort: 0,
              extended: 1
            }).then(resp => this.parseSearchRecommendationResponse(resp, new Set(), new Set(), 540)).catch(() => [])
          );
          const searchResults = await Promise.all(recPromises);
          const flatRecs = searchResults.flat().filter(Boolean).map(v => ({ ...v, isRecommended: true }));
          if (flatRecs.length > 0) {
            const merged = [];
            let rIdx = 0;
            for (let i = 0; i < trendingNext.length; i++) {
              merged.push(trendingNext[i]);
              if (i % 3 === 0 && rIdx < flatRecs.length) {
                merged.push(flatRecs[rIdx++]);
              }
            }
            while (rIdx < flatRecs.length && merged.length < count) {
              merged.push(flatRecs[rIdx++]);
            }
            merged.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
            return merged.slice(0, count);
          }
        }
        return trendingNext.slice(0, count);
      }

      // Authorized user dynamic feed
      let localHistory = [];
      let watchProgress = {};
      if (Array.isArray(passedHistory)) {
        localHistory = passedHistory;
      } else {
        try {
          const activeId = (typeof localStorage !== 'undefined') ? localStorage.getItem('vk_active_user_id') : null;
          const scopedKey = activeId ? `vk_history_${activeId}` : 'vk_history';
          localHistory = (typeof localStorage !== 'undefined')
            ? JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('vk_history') || '[]')
            : [];
        } catch (e) {}
      }

      if (passedProgress && typeof passedProgress === 'object') {
        watchProgress = passedProgress;
      }

      const [topChannelsResp, serverCtx] = await Promise.all([
        this.callMethod('groups.get', {
          extended: 1,
          count: 150,
          fields: 'activity,members_count,verified,description'
        }).catch(() => ({ items: [] })),
        this.getSmartTVServerContext(false, 40).catch(() => ({ watchHistory: [], personalFeedVideos: [], serverProgress: {} }))
      ]);

      const effectiveHistory = this.mergeHistories(localHistory, serverCtx.watchHistory || []);
      const allChannels = (topChannelsResp && topChannelsResp.items) ? topChannelsResp.items : [];
      const userGroupIds = new Set(allChannels.map(g => -Math.abs(g.id)));

      // Next tier of channels - circular wrap-around ensures genuinely infinite feed
      const totalCh = allChannels.length;
      let channelsBatch = [];
      const chOffset = totalCh > 0 ? (Math.floor(offset / 12) * 6) % totalCh : 0;
      if (totalCh > 0) {
        for (let i = 0; i < Math.min(8, totalCh); i++) {
          channelsBatch.push(allChannels[(chOffset + i) % totalCh]);
        }
      }

      const videoOffset = totalCh > 0 ? (Math.floor(offset / totalCh) * 6) % 30 : 0;
      const channelPromises = channelsBatch.map(ch =>
        this.getChannelVideos(-ch.id, 6, ch.name, 240, videoOffset).catch(() => [])
      );

      // Rotate deeper through cross-device server history for native video.getVideoDiscover recommendations
      const discoverExcluded = new Set(effectiveHistory.map(h => h.id));
      let discoverPromise = Promise.resolve([]);
      if (effectiveHistory.length > 0) {
        const dStart = (Math.floor(offset / 36) * 3) % effectiveHistory.length;
        const rotatedSeeds = [];
        for (let i = 0; i < Math.min(3, effectiveHistory.length); i++) {
          rotatedSeeds.push(effectiveHistory[(dStart + i) % effectiveHistory.length]);
        }
        discoverPromise = this.getVideoDiscoverRecommendations(rotatedSeeds, discoverExcluded, 6).catch(() => []);
      }

      // Next tier of recommendations - circular wrap-around seeds
      const seeds = this.extractRecommendationSeeds(effectiveHistory);
      const baseSeeds = seeds.length > 0 ? seeds : [
        'шоу', 'стендап', 'новости', 'обзор', 'интервью', 'гаджеты', 'кино', 'игры'
      ];
      const sIdx = Math.floor(offset / 24) * 2;
      const nextSeeds = [
        baseSeeds[sIdx % baseSeeds.length],
        baseSeeds[(sIdx + 1) % baseSeeds.length],
        baseSeeds[(sIdx + 2) % baseSeeds.length]
      ];

      const recPromises = nextSeeds.map(s =>
        this.callMethod('video.search', {
          q: s,
          count: 8,
          filters: 'long',
          sort: 0,
          extended: 1
        }).then(resp => this.parseSearchRecommendationResponse(resp, userGroupIds, new Set(), 540)).catch(() => [])
      );

      // Next tier of premier popular channels (Ida Galich, Shastun, Vpiska, Azamat, Natalnaya Karta, etc.)
      const premierChannels = this.getPremierPopularChannels();
      const pIdx = (Math.floor(offset / 24) * 2) % premierChannels.length;
      const ch1 = premierChannels[pIdx];
      const ch2 = premierChannels[(pIdx + 1) % premierChannels.length];
      const premierPromises = [
        this.getChannelVideos(ch1.id, 4, ch1.name, 240, Math.floor(offset / 48) * 2).catch(() => []),
        this.getChannelVideos(ch2.id, 4, ch2.name, 240, Math.floor(offset / 48) * 2).catch(() => [])
      ];

      const [channelVideosResults, discoverResults, searchResults, premierResults] = await Promise.all([
        Promise.all(channelPromises),
        discoverPromise,
        Promise.all(recPromises),
        Promise.all(premierPromises)
      ]);

      const flatCh = channelVideosResults.flat().filter(Boolean);
      const flatRecs = [
        ...(discoverResults || []),
        ...searchResults.flat().filter(Boolean),
        ...premierResults.flat().filter(Boolean)
      ].map(v => ({ ...v, isRecommended: true }));

      const merged = [];
      const seen = new Set();
      const seenTitles = new Set();
      const pushUnique = (item) => {
        if (!item || !item.id || seen.has(item.id)) return false;
        const tKey = this.normalizeVideoTitleKey(item.title);
        if (tKey.length >= 12 && seenTitles.has(tKey)) return false;
        seen.add(item.id);
        if (tKey.length >= 12) seenTitles.add(tKey);
        merged.push(item);
        return true;
      };

      let rIdx = 0;
      for (let i = 0; i < flatCh.length; i++) {
        pushUnique(flatCh[i]);
        if (merged.length % 3 === 0) {
          while (rIdx < flatRecs.length && !pushUnique(flatRecs[rIdx++])) {}
        }
        if (merged.length >= count) break;
      }
      while (rIdx < flatRecs.length && merged.length < count) {
        pushUnique(flatRecs[rIdx++]);
      }

      // If channels and seeds yielded less than desired count, pull from trending buffer
      if (merged.length < count) {
        const trendingBuffer = await this.getTrending(count, offset % 100).catch(() => []);
        for (const t of trendingBuffer) {
          pushUnique(t);
          if (merged.length >= count) break;
        }
      }

      // Filter out stale videos older than 1.5 years if we have enough items
      const freshMerged = merged.filter(v => !v.date || (now - Number(v.date)) <= MAX_REC_AGE);
      const result = (freshMerged.length >= 6) ? freshMerged : merged;

      // Sort batch chronologically (newest first)
      result.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));

      return result.slice(0, count);
    } catch (e) {
      console.warn('[VKApi] getMoreSmartFeedVideos error:', e);
      return [];
    }
  }

  /**
   * Get User Personalized Video Feed (Subscriptions & Friends)
   * Strictly full-length, horizontal videos only (NO shorts/clips/reels)
   */
  async getUserFeed(count = 80, minDuration = 120) {
    if (!this.isAuthorized()) return [];

    try {
      const resp = await this.callMethod('newsfeed.get', {
        filters: 'video',
        count: count,
        extended: 1
      });

      if (!resp || !resp.items) return [];

      const groupsMap = {};
      if (resp.groups && Array.isArray(resp.groups)) {
        for (const g of resp.groups) {
          groupsMap[g.id] = g.name || 'Сообщество';
        }
      }

      const profilesMap = {};
      if (resp.profiles && Array.isArray(resp.profiles)) {
        for (const p of resp.profiles) {
          profilesMap[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Пользователь';
        }
      }

      const videos = [];
      const seen = new Set();

      for (const item of resp.items) {
        const itemVids = [];
        if (item.video && Array.isArray(item.video.items)) {
          itemVids.push(...item.video.items);
        }
        if (item.attachments && Array.isArray(item.attachments)) {
          for (const att of item.attachments) {
            if (att.type === 'video' && att.video) {
              itemVids.push(att.video);
            }
          }
        }

        for (const v of itemVids) {
          const vidId = `${v.owner_id}_${v.id}`;
          if (seen.has(vidId)) continue;

          // STRICT FILTER: eliminate all short videos, vertical clips, and mobile reels
          if (!this.isFullLengthVideo(v, minDuration)) continue;

          let author = v.owner_name || 'VK Видео';
          const ownerId = v.owner_id || 0;
          if (ownerId < 0 && groupsMap[Math.abs(ownerId)]) {
            author = groupsMap[Math.abs(ownerId)];
          } else if (ownerId > 0 && profilesMap[ownerId]) {
            author = profilesMap[ownerId];
          }

          // Filter out municipal, administrative, and school community dumps
          const authorLower = (typeof author === 'string' ? author : '').toLowerCase();
          const stopWords = [
            'администрация', 'муниципал', 'оханск', 'мбоу', 'сош', 'дума',
            'орган власти', 'госуслуг', 'подслушано', 'объявлен', 'барахолк',
            'детский сад', 'поликлиника', 'больница', 'жкх', 'суд',
            'дизайн интерьер', 'интерьер и декор'
          ];
          if (stopWords.some(sw => authorLower.includes(sw))) {
            continue;
          }

          // Eliminate low-view internal recordings (views < 200)
          if ((v.views || 0) < 200) {
            continue;
          }

          seen.add(vidId);

          const formatted = this.formatVideoItem(v);
          formatted.author = author;
          videos.push(formatted);
        }
      }

      videos.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
      return videos;
    } catch (e) {
      console.warn('[VKApi] getUserFeed error:', e);
      return [];
    }
  }

  /**
   * Get User Subscriptions / Channels
   */
  async getUserSubscriptions(count = 60) {
    if (!this.isAuthorized()) return [];

    try {
      const resp = await this.callMethod('groups.get', {
        extended: 1,
        count: count,
        fields: 'photo_200,description,members_count'
      });

      if (!resp || !resp.items) return [];

      return resp.items.map(g => ({
        id: -Math.abs(g.id),
        name: g.name || 'Канал',
        avatar: g.photo_200 || g.photo_100 || 'assets/icon.png',
        members: g.members_count || 0,
        description: g.description || ''
      }));
    } catch (e) {
      console.warn('[VKApi] getUserSubscriptions error:', e);
      return [];
    }
  }

  /**
   * Get Pure Subscriptions Video Feed:
   * Strictly full-length horizontal videos from channels the user is subscribed to (NO external recommendations, NO shorts)
   * 4x expanded pool: up to 80 channels and 160 fresh uploads
   * Sorted chronologically (newest uploads first)
   */
  async getUserSubscriptionsFeed(count = 160, minDuration = 240) {
    if (!this.isAuthorized()) return [];

    try {
      const resp = await this.callMethod('groups.get', {
        extended: 1,
        count: 150,
        fields: 'photo_200,description,members_count,verified,activity'
      });

      const stopWords = [
        'администрация', 'муниципал', 'оханск', 'мбоу', 'сош', 'дума',
        'орган власти', 'госуслуг', 'подслушано', 'объявлен', 'барахолк',
        'детский сад', 'поликлиника', 'больница', 'жкх', 'суд', 'новости', 'газета',
        'wildberries', 'ozon', 'lamoda', 'wb', 'находки', 'aliexpress',
        'маникюр', 'ногти', 'прически', 'макияж',
        'доставка', 'суши', 'роллы', 'кафе', 'торт', 'клубника',
        'цветы', 'букет',
        'дизайн интерьер', 'интерьер и декор',
        'выкройки', 'пошив', 'аренда', 'мебели', 'обои', 'финунивер', 'нсо '
      ];

      const items = (resp && resp.items) || [];
      const validChannels = items.filter(g => {
        if (!g) return false;
        const name = (g.name || '').toLowerCase();
        const act = (g.activity || '').toLowerCase();
        for (const sw of stopWords) {
          if (name.includes(sw) || act.includes(sw)) return false;
        }
        return true;
      });

      // Rank subscribed channels by popularity / verified status
      const ranked = [...validChannels].sort((a, b) => {
        const scoreA = (a.verified ? 60 : 0) + (a.members_count > 0 ? Math.log10(a.members_count) * 20 : 0);
        const scoreB = (b.verified ? 60 : 0) + (b.members_count > 0 ? Math.log10(b.members_count) * 20 : 0);
        return scoreB - scoreA;
      });

      // 4x expanded pool: up to 80 channels with 12 videos each
      const topChannels = ranked.slice(0, 80);
      const channelResults = await Promise.all(
        topChannels.map(ch => this.getChannelVideos(-ch.id, 12, ch.name, minDuration).catch(() => []))
      );

      // Collect all full videos strictly from these subscribed channels
      const allVids = [];
      const freshVids = [];
      const seen = new Set();
      const now = Math.floor(Date.now() / 1000);
      const MAX_SUBSCRIPTION_AGE = 365 * 86400; // 1 year freshness for Subscriptions Feed

      for (const list of channelResults) {
        for (const v of list) {
          if (v && v.id && !seen.has(v.id)) {
            seen.add(v.id);
            allVids.push(v);
            if (!v.date || (now - Number(v.date)) <= MAX_SUBSCRIPTION_AGE) {
              freshVids.push(v);
            }
          }
        }
      }

      // If we have enough fresh uploads (>= 8), strictly filter out stale archival episodes
      const candidatePool = (freshVids.length >= 8) ? freshVids : allVids;

      // Sort strictly by publication date (newest uploads first)
      candidatePool.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));

      // Diversity limiter: max 6 videos per channel to ensure rich variety across subscriptions
      const perChannel = {};
      const finalFeed = [];
      for (const v of candidatePool) {
        const ownerId = v.id.split('_')[0];
        if ((perChannel[ownerId] || 0) < 6) {
          perChannel[ownerId] = (perChannel[ownerId] || 0) + 1;
          finalFeed.push(v);
        }
        if (finalFeed.length >= count) break;
      }

      finalFeed.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
      return finalFeed;
    } catch (e) {
      console.warn('[VKApi] getUserSubscriptionsFeed error:', e);
      return [];
    }
  }

  formatVideoItem(item) {
    const h = item.height || 0;
    const title = item.title || 'Видео';
    const has4k = h >= 2160 || title.toLowerCase().includes('4k');
    const has1080 = (h >= 1080 || title.toLowerCase().includes('1080')) && !has4k;

    return {
      id: `${item.owner_id}_${item.id}`,
      title: title,
      author: item.owner_name || (item.owner_id < 0 ? 'Сообщество' : 'VK Видео'),
      duration: this.formatDuration(item.duration || 0),
      views: this.formatViews(item.views || 0),
      thumbnail: this.getBestThumbnail(item),
      lqip: this.getLqipThumbnail(item),
      date: item.date || item.adding_date || null,
      is4K: has4k,
      isHD: has1080
    };
  }

  /**
   * Optimized TV Thumbnail Selector:
   * Chooses the optimal ~800px width preview image from VK CDN (matches 787 physical px on 4K OLED perfectly).
   * Reduces image download weight by ~75% (from 354 KB down to 85 KB) and saves ~330 MB of GPU texture memory.
   */
  getBestThumbnail(item) {
    if (!item) return 'assets/splashBackground.png';

    const images = (item.image && Array.isArray(item.image) && item.image.length > 0) ? item.image :
                   (item.first_frame && Array.isArray(item.first_frame) && item.first_frame.length > 0) ? item.first_frame : null;

    if (images) {
      const candidates = images.filter(img => img && img.url);
      if (candidates.length > 0) {
        // Look for optimal range ~720 - 960px (ideal 1:1 match for TV grid card)
        const optimal = candidates.find(img => img.width >= 640 && img.width <= 960);
        if (optimal) return optimal.url;

        // If exact range not found, pick the one closest to 800px
        const sorted = [...candidates].sort((a, b) => Math.abs((a.width || 0) - 800) - Math.abs((b.width || 0) - 800));
        return sorted[0].url;
      }
    }

    if (item.photo_800) return item.photo_800;
    if (item.photo_640) return item.photo_640;
    if (item.photo_1280) return item.photo_1280;
    if (item.photo_320) return item.photo_320;
    if (item.photo_130) return item.photo_130;
    return 'assets/splashBackground.png';
  }

  /**
   * Low-Quality Image Placeholder (LQIP):
   * Tiny ~60-160px preview (1-2 KB) that loads in < 50ms for instant blur-up rendering.
   */
  getLqipThumbnail(item) {
    if (!item) return '';

    const images = (item.image && Array.isArray(item.image) && item.image.length > 0) ? item.image :
                   (item.first_frame && Array.isArray(item.first_frame) && item.first_frame.length > 0) ? item.first_frame : null;

    if (images) {
      const tiny = images.find(img => img && img.url && img.width >= 60 && img.width <= 160) ||
                   images.find(img => img && img.url && img.width <= 320);
      if (tiny) return tiny.url;
    }

    if (item.photo_130) return item.photo_130;
    if (item.photo_320) return item.photo_320;
    return '';
  }

  formatDuration(seconds) {
    if (!seconds) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  formatViews(count) {
    if (!count) return '0 просмотров';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)} млн`;
    if (count >= 1000) return `${Math.round(count / 1000)} тыс.`;
    return `${count}`;
  }

  /**
   * Verified high-quality 4K & Full-length videos pool for guest mode
   */
  getPopularPublicVideos() {
    if (typeof window !== 'undefined' && window.VK_CURATED_CATALOG) {
      const catalog = window.VK_CURATED_CATALOG;
      const combined = [];
      const order = ['shows', 'games', 'movies', 'tech', 'kids', 'nature', 'music'];
      for (const k of order) {
        if (catalog[k]) {
          combined.push(...catalog[k].slice(0, 5));
        }
      }
      if (combined.length > 0) return combined;
    }
    return [];
  }

  getCuratedBackupVideos(query) {
    const popular = this.getPopularPublicVideos();
    if (!query) return popular;
    const q = query.toLowerCase().trim();
    const filtered = popular.filter(v => (v.title && v.title.toLowerCase().includes(q)) || (v.author && v.author.toLowerCase().includes(q)));
    return filtered.length > 0 ? filtered : popular;
  }
}

if (typeof window !== 'undefined') window.VKApi = VKApi;
if (typeof globalThis !== 'undefined') globalThis.VKApi = VKApi;

