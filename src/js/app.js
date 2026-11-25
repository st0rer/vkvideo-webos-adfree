/**
 * VK Video AdFree 4K - Main Application Logic
 */

class VKVideoApp {
  constructor() {
    this.api = new (window.VKApi || VKApi)();
    this.currentSection = 'home';
    this.keyboardLang = 'ru';
    this.searchQuery = '';
    this.qrPollTimer = null;
    this.activeDeviceAuth = null;
    this.videoMap = {};
    this.currentChannel = null;
    this.userSubscribedIds = new Set();

    // Accounts & Multi-User system
    this.accounts = [];
    this.activeUserId = null;
    this.history = [];
    this.favorites = [];
    this.watchProgress = {};
    this.initAccounts();

    // In-memory cache for instantaneous tab switching (0 ms) & SWR
    this.homeFeedCache = null;
    this.homeFeedCacheTime = 0;
    this.subsFeedCache = null;
    this.subsChannelsCache = null;
    this.subsCacheTime = 0;

    // Subsystems
    this.player = new (window.VideoPlayer || VideoPlayer)(this);
    this.nav = new (window.SpatialNavigation || SpatialNavigation)(this);
    this.thumbnailObserver = null;
    this.initThumbnailObserver();

    this.initDOM();
    this.initLifecycle();
    this.initKeyboard();
    this.updateUserCard();
    this.verifyUserAuth();
    this.loadSection('home');
  }

  initAccounts() {
    this.accounts = [];
    try {
      const raw = localStorage.getItem('vk_user_accounts');
      if (raw) this.accounts = JSON.parse(raw);
    } catch (e) {}

    // Auto-migrate legacy single user if present
    const existingToken = localStorage.getItem('vk_user_token');
    const existingInfo = JSON.parse(localStorage.getItem('vk_user_info') || '{}');
    if (existingToken && (!this.accounts || this.accounts.length === 0)) {
      const migratedAcc = {
        id: existingInfo.id || 'default_user',
        name: existingInfo.name || 'Пользователь VK',
        photo: existingInfo.photo || null,
        token: existingToken,
        addedAt: Date.now()
      };
      this.accounts = [migratedAcc];
      try {
        localStorage.setItem('vk_user_accounts', JSON.stringify(this.accounts));
        localStorage.setItem('vk_active_user_id', String(migratedAcc.id));
      } catch (e) {}
    }

    let activeId = localStorage.getItem('vk_active_user_id');
    let activeAcc = this.accounts.find(a => String(a.id) === String(activeId));
    if (!activeAcc && this.accounts.length > 0) {
      activeAcc = this.accounts[0];
      activeId = activeAcc.id;
      try {
        localStorage.setItem('vk_active_user_id', String(activeId));
      } catch (e) {}
    }

    if (activeAcc) {
      this.activeUserId = activeAcc.id;
      this.api.setToken(activeAcc.token);
      try {
        localStorage.setItem('vk_user_info', JSON.stringify(activeAcc));
      } catch (e) {}
      this.loadUserScopedData(activeAcc.id);
    } else {
      this.activeUserId = null;
      try {
        this.history = JSON.parse(localStorage.getItem('vk_history_guest') || localStorage.getItem('vk_history') || '[]');
        this.favorites = JSON.parse(localStorage.getItem('vk_favorites_guest') || localStorage.getItem('vk_favorites') || '[]');
        this.watchProgress = JSON.parse(localStorage.getItem('vk_watch_progress_guest') || localStorage.getItem('vk_watch_progress') || '{}');
      } catch (e) {
        this.history = [];
        this.favorites = [];
        this.watchProgress = {};
      }
    }
  }

  saveUserScopedData(key, data) {
    const activeId = this.activeUserId;
    if (activeId) {
      try {
        localStorage.setItem(`vk_${key}_${activeId}`, JSON.stringify(data));
      } catch (e) {}
    } else {
      try {
        localStorage.setItem(`vk_${key}_guest`, JSON.stringify(data));
        localStorage.setItem(`vk_${key}`, JSON.stringify(data));
      } catch (e) {}
    }
  }

  loadUserScopedData(userId) {
    // Only migrate from legacy un-scoped storage once, for the very first primary account
    const isFirstAccount = this.accounts.length > 0 && String(userId) === String(this.accounts[0].id);
    let alreadyMigrated = false;
    try {
      alreadyMigrated = localStorage.getItem('vk_legacy_scoped_migrated') === 'true';
    } catch (e) {}

    // 1. History
    let hist = [];
    try {
      const scopedHist = localStorage.getItem(`vk_history_${userId}`);
      if (scopedHist) {
        hist = JSON.parse(scopedHist);
      } else if (isFirstAccount && !alreadyMigrated) {
        const legacyHist = localStorage.getItem('vk_history');
        if (legacyHist) {
          hist = JSON.parse(legacyHist);
          localStorage.setItem(`vk_history_${userId}`, legacyHist);
        }
      }
    } catch (e) {}
    this.history = hist;

    // 2. Favorites
    let favs = [];
    try {
      const scopedFavs = localStorage.getItem(`vk_favorites_${userId}`);
      if (scopedFavs) {
        favs = JSON.parse(scopedFavs);
      } else if (isFirstAccount && !alreadyMigrated) {
        const legacyFavs = localStorage.getItem('vk_favorites');
        if (legacyFavs) {
          favs = JSON.parse(legacyFavs);
          localStorage.setItem(`vk_favorites_${userId}`, legacyFavs);
        }
      }
    } catch (e) {}
    this.favorites = favs;

    // 3. Watch Progress
    let prog = {};
    try {
      const scopedProg = localStorage.getItem(`vk_watch_progress_${userId}`);
      if (scopedProg) {
        prog = JSON.parse(scopedProg);
      } else if (isFirstAccount && !alreadyMigrated) {
        const legacyProg = localStorage.getItem('vk_watch_progress');
        if (legacyProg) {
          prog = JSON.parse(legacyProg);
          localStorage.setItem(`vk_watch_progress_${userId}`, legacyProg);
        }
      }
    } catch (e) {}
    this.watchProgress = prog;

    if (isFirstAccount && !alreadyMigrated) {
      try {
        localStorage.setItem('vk_legacy_scoped_migrated', 'true');
      } catch (e) {}
    }

    // 4. Invalidate feed caches
    this.homeFeedCache = null;
    this.homeFeedCacheTime = 0;
    this.subsFeedCache = null;
    this.subsChannelsCache = null;
    this.subsCacheTime = 0;
    this.userSubscribedIds = new Set();
  }

  async switchUser(userId) {
    const acc = this.accounts.find(a => String(a.id) === String(userId));
    if (!acc) return;

    this.activeUserId = acc.id;
    try {
      localStorage.setItem('vk_active_user_id', String(acc.id));
      localStorage.setItem('vk_user_token', acc.token);
      localStorage.setItem('vk_user_info', JSON.stringify(acc));
    } catch (e) {}

    this.api.setToken(acc.token);
    this.loadUserScopedData(acc.id);

    this.updateUserCard();
    this.closeAllModals();
    this.showToast(`Профиль переключен: ${acc.name}`);

    // Reload active view with fresh personalized recommendations & subscriptions
    if (this.currentSection === 'home') {
      this.renderHome();
    } else {
      this.loadSection(this.currentSection);
    }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  removeAccount(userId, triggerBtn = null) {
    const acc = this.accounts.find(a => String(a.id) === String(userId));
    if (!acc) return;

    // 2-step inline confirmation for Smart TV remote (avoids native window.confirm() freeze on webOS)
    if (triggerBtn && triggerBtn.dataset.confirmPending !== '1') {
      triggerBtn.dataset.confirmPending = '1';
      const origText = triggerBtn.textContent;
      triggerBtn.textContent = 'Подтвердить?';
      this.showToast(`Нажмите ещё раз, чтобы удалить «${acc.name}»`);
      setTimeout(() => {
        if (triggerBtn && triggerBtn.dataset.confirmPending === '1') {
          triggerBtn.dataset.confirmPending = '0';
          triggerBtn.textContent = origText;
        }
      }, 4000);
      return;
    }

    this.accounts = this.accounts.filter(a => String(a.id) !== String(userId));
    try {
      localStorage.setItem('vk_user_accounts', JSON.stringify(this.accounts));
      localStorage.removeItem(`vk_history_${userId}`);
      localStorage.removeItem(`vk_favorites_${userId}`);
      localStorage.removeItem(`vk_watch_progress_${userId}`);
      localStorage.removeItem(`vk_home_feed_cache_auth_v5_user_${userId}`);
      localStorage.removeItem(`vk_home_feed_cache_auth_v8_user_${userId}`);
      localStorage.removeItem(`vk_subs_channels_cache_user_${userId}`);
      localStorage.removeItem(`vk_subs_feed_cache_user_${userId}`);
      localStorage.removeItem(`vk_subscriptions_feed_cache_auth_user_${userId}`);
    } catch (e) {}

    if (String(this.activeUserId) === String(userId)) {
      if (this.accounts.length > 0) {
        this.switchUser(this.accounts[0].id);
      } else {
        // No accounts left: full logout to guest
        this.api.logout();
        this.activeUserId = null;
        try {
          localStorage.removeItem('vk_active_user_id');
        } catch (e) {}
        this.history = [];
        this.favorites = [];
        this.watchProgress = {};
        this.updateUserCard();
        this.closeAllModals();
        this.showToast('Вы вышли из профиля');
        this.loadSection('home');
        return;
      }
    }

    this.renderProfilesList();
    const modal = document.getElementById('profiles-modal');
    const nextFocus = (modal && modal.querySelector('.focusable')) || document.getElementById('btn-add-profile');
    if (nextFocus && this.nav) this.nav.setFocus(nextFocus);
  }

  openProfilesModal() {
    const modal = document.getElementById('profiles-modal');
    if (!modal) return;
    this.renderProfilesList();
    modal.style.display = 'flex';

    const addBtn = document.getElementById('btn-add-profile');
    if (addBtn) {
      addBtn.onclick = () => {
        this.closeAllModals();
        this.openQRModal(true); // force fresh QR code for adding new user
      };
    }
    const closeBtn = document.getElementById('btn-close-profiles');
    if (closeBtn) {
      closeBtn.onclick = () => this.closeAllModals();
    }

    const firstFocus = modal.querySelector('.focusable');
    if (firstFocus) this.nav.setFocus(firstFocus);
  }

  renderProfilesList() {
    const container = document.getElementById('profiles-list');
    if (!container) return;
    container.innerHTML = '';

    if (!this.accounts || this.accounts.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); padding:20px; font-size:18px;">Нет сохраненных профилей. Нажмите «Добавить пользователя».</div>';
      return;
    }

    this.accounts.forEach(acc => {
      const isActive = String(acc.id) === String(this.activeUserId);
      const safeName = this.escapeHtml(acc.name || 'Пользователь VK');
      const row = document.createElement('div');
      row.className = `profile-item ${isActive ? 'active-profile' : ''}`;
      row.dataset.id = acc.id;

      const avatarContent = acc.photo
        ? `<img src="${this.escapeHtml(acc.photo)}" alt="${safeName}">`
        : `<span>${this.escapeHtml((acc.name || 'VK').slice(0, 2).toUpperCase())}</span>`;

      row.innerHTML = `
        <div class="profile-avatar-wrap">
          ${avatarContent}
        </div>
        <div class="profile-details">
          <div class="profile-name">${safeName}</div>
          <div class="profile-subtext">${isActive ? '🟢 Текущий активный профиль' : 'Нажмите «Выбрать» для переключения'}</div>
        </div>
        <div class="profile-actions">
          ${!isActive ? `<button class="profile-action-btn focusable primary" data-action="switch" data-id="${acc.id}">Выбрать</button>` : ''}
          <button class="profile-action-btn focusable danger" data-action="delete" data-id="${acc.id}">
            ${isActive && this.accounts.length === 1 ? 'Выйти' : 'Удалить'}
          </button>
        </div>
      `;

      // Row click switches to profile if not active
      row.addEventListener('click', (e) => {
        if (e.target.closest('.profile-action-btn')) return;
        if (!isActive) {
          this.switchUser(acc.id);
        }
      });

      // Action buttons
      const switchBtn = row.querySelector('[data-action="switch"]');
      if (switchBtn) {
        switchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.switchUser(acc.id);
        });
      }

      const delBtn = row.querySelector('[data-action="delete"]');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeAccount(acc.id, delBtn);
        });
      }

      container.appendChild(row);
    });
  }

  initLifecycle() {
    // webOS App Lifecycle & Backgrounding
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.player && this.player.isPlaying) {
          this.player.video.pause();
          this.player.isPlaying = false;
          this.player.updatePlayBtn();
          this.player._flushWatchProgress();
          this.player.wasPlayingBeforeHidden = true;
          this.player.stopPowerKeepAlive();
        }
      } else {
        if (this.player && this.player.wasPlayingBeforeHidden) {
          this.player.wasPlayingBeforeHidden = false;
          this.player.wakeOSD();
          this.player.startPowerKeepAlive();
        }
      }
    });

    document.addEventListener('webOSRelaunch', (e) => {
      console.log('[webOS] Relaunch triggered:', e.detail);
      if (this.player && this.player.container.style.display !== 'none') {
        this.player.wakeOSD();
      }
    });
  }

  saveWatchProgress(videoId, currentTime, duration) {
    if (!videoId || !duration) return;
    const percent = Math.min(100, Math.round((currentTime / duration) * 100));
    // If watched more than 92%, consider completed and reset
    if (percent > 92) {
      delete this.watchProgress[videoId];
    } else {
      this.watchProgress[videoId] = {
        currentTime: Math.floor(currentTime),
        duration: Math.floor(duration),
        percent: percent,
        timestamp: Date.now()
      };
    }
    this.saveUserScopedData('watch_progress', this.watchProgress);
  }

  getSavedPosition(videoId) {
    if (!videoId) return 0;
    const p = this.watchProgress[videoId];
    return p ? p.currentTime : 0;
  }

  initDOM() {
    // Navigation sidebar clicks
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const section = item.dataset.section;
        if (section) this.loadSection(section);
      });
    });

    // User profile click (Profiles Switcher Modal / QR login)
    document.getElementById('user-profile-btn').addEventListener('click', () => {
      if ((this.accounts && this.accounts.length > 0) || this.api.isAuthorized()) {
        this.openProfilesModal();
      } else {
        this.openQRModal();
      }
    });

    // Player OSD buttons
    document.getElementById('btn-play-pause').addEventListener('click', () => this.player.togglePlay());
    document.getElementById('btn-rewind').addEventListener('click', () => this.player.seekBy(-10));
    document.getElementById('btn-forward').addEventListener('click', () => this.player.seekBy(10));
    document.getElementById('btn-quality').addEventListener('click', () => this.openQualityModal());
    document.getElementById('btn-speed').addEventListener('click', () => this.openSpeedModal());
    document.getElementById('btn-close-player').addEventListener('click', () => this.player.close());

    // Progress bar click / seek
    document.getElementById('progress-track').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (!rect || !rect.width) return;
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = this.player.getDuration();
      if (dur > 0) {
        this.player.seekTo(pos * dur);
      }
    });

    // Close Modals on background click
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeAllModals();
      });
    });
  }

  updateUserCard() {
    const nameEl = document.getElementById('user-name');
    const statusEl = document.getElementById('user-status');
    const avatarEl = document.getElementById('user-avatar');

    if (this.api.isAuthorized()) {
      const info = JSON.parse(localStorage.getItem('vk_user_info') || '{}');
      nameEl.textContent = info.name || 'VK Пользователь';
      statusEl.textContent = this.accounts && this.accounts.length > 1 ? 'Сменить профиль' : 'Авторизован';
      if (info.photo) {
        const initials = this.escapeHtml((info.name || 'VK').slice(0, 2).toUpperCase());
        avatarEl.innerHTML = `<img src="${this.escapeHtml(info.photo)}" alt="Avatar" onerror="this.parentElement.textContent='${initials}'">`;
      } else {
        avatarEl.textContent = (info.name || 'VK').slice(0, 2).toUpperCase();
      }
    } else {
      nameEl.textContent = 'Войти по QR';
      statusEl.textContent = 'Гостевой режим 4K';
      avatarEl.textContent = 'VK';
    }
  }

  async verifyUserAuth() {
    if (this.api.isAuthorized()) {
      const profile = await this.api.fetchUserProfile(this.api.userToken);
      if (profile && profile.isRevoked) {
        console.warn('[App] User token is explicitly revoked, removing from accounts');
        if (this.activeUserId) {
          this.accounts = this.accounts.filter(a => String(a.id) !== String(this.activeUserId));
          try {
            localStorage.setItem('vk_user_accounts', JSON.stringify(this.accounts));
          } catch (e) {}
        }
        if (this.accounts.length > 0) {
          this.switchUser(this.accounts[0].id);
        } else {
          this.api.logout();
          this.activeUserId = null;
          this.updateUserCard();
        }
      } else if (profile && profile.id) {
        const acc = this.accounts.find(a => String(a.id) === String(this.activeUserId));
        if (acc) {
          acc.name = profile.name || acc.name;
          acc.photo = profile.photo || acc.photo;
          try {
            localStorage.setItem('vk_user_accounts', JSON.stringify(this.accounts));
            localStorage.setItem('vk_user_info', JSON.stringify(acc));
          } catch (e) {}
        }
        this.updateUserCard();
      }
    }
  }

  switchSection(sectionId) {
    return this.loadSection(sectionId);
  }

  async loadSection(sectionId) {
    clearTimeout(this._navSectionTimer);
    this.isNavigatingSection = true;
    this.currentSection = sectionId;
    this.currentChannel = null;

    if (sectionId === 'search') {
      this.searchQuery = '';
    }

    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.section === sectionId);
    });

    const contentArea = document.getElementById('main-content');

    try {
      switch (sectionId) {
        case 'home':
          await this.renderHome();
          break;
        case 'subscriptions':
          await this.renderSubscriptions();
          break;
        case 'search':
          await this.renderSearch();
          break;
        case 'categories':
          this.renderCategories();
          break;
        case 'favorites':
          this.renderFavorites();
          break;
        case 'history':
          await this.renderHistory();
          break;
        case 'direct':
          this.renderDirectInput();
          break;
      }
      this.focusCurrentSection();
    } catch (err) {
      console.error('[App] Section load error:', err);
      contentArea.innerHTML = `<div class="section-title">Ошибка загрузки</div><p style="color:#f85149;margin-top:15px;">${this.escapeHtml(err.message)}</p>`;
    } finally {
      this._navSectionTimer = setTimeout(() => {
        this.isNavigatingSection = false;
      }, 200);
    }
  }

  renderSkeletons(container, count = 8) {
    container.innerHTML = Array(count).fill(0).map(() => `
      <div class="skeleton-card">
        <div class="skeleton-thumb"></div>
        <div class="skeleton-text"></div>
        <div class="skeleton-text short"></div>
      </div>
    `).join('');
  }

  async renderHome() {
    this.homeFeedOffset = 192;
    this.isLoadingMoreHome = false;
    this.hasMoreHomeVideos = true;
    this.initThumbnailObserver();

    const content = document.getElementById('main-content');
    const isAuth = this.api.isAuthorized();
    let userName = '';
    if (isAuth) {
      try {
        const u = JSON.parse(localStorage.getItem('vk_user_info') || '{}');
        if (u.name) userName = u.name;
      } catch (e) {}
    }

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">
          <span>${isAuth ? (userName ? `Для вас, ${userName}` : 'Для вас') : 'Тренды и рекомендации'}</span>
          <span class="badge-4k">4K UHD</span>
          <span class="badge-adfree">БЕЗ РЕКЛАМЫ</span>
        </div>
        <div class="section-subtitle">${isAuth ? 'Самые просматриваемые каналы, свежие видео и похожие рекомендации' : 'Автоматическое аппаратное воспроизведение в максимальном разрешении'}</div>
      </div>
      <div class="video-grid" id="video-grid"></div>
    `;

    const grid = document.getElementById('video-grid');
    if (grid) {
      grid.addEventListener('scroll', () => {
        this.onGridScrolled(grid);
      }, { passive: true });
    }

    // User-scoped storage keys for authorized vs guest feed
    const userSuffix = this.activeUserId ? `user_${this.activeUserId}` : 'guest';
    const cacheKey = isAuth ? `vk_home_feed_cache_auth_v8_${userSuffix}` : 'vk_home_feed_cache_guest_v8';
    try {
      localStorage.removeItem(`vk_home_showcase_v1_${userSuffix}`);
      localStorage.removeItem('vk_home_showcase_v1_guest');
      localStorage.removeItem(`vk_home_feed_cache_auth_v7_${userSuffix}`);
      localStorage.removeItem('vk_home_feed_cache_guest_v7');
    } catch (e) {}

    // 1. Instant Cache Render (Stale-While-Revalidate: 0-15 ms)
    let cachedVideos = this.homeFeedCache;
    if (!cachedVideos) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) cachedVideos = JSON.parse(raw);
      } catch (e) {}
    }

    let hasRenderedCache = false;
    if (cachedVideos && cachedVideos.length >= (isAuth ? 12 : 6)) {
      this.homeFeedCache = cachedVideos;
      this.renderVideoCards(grid, cachedVideos);
      this.focusCurrentSection();
      hasRenderedCache = true;
    } else {
      this.renderSkeletons(grid, 8);
    }

    // 2. Background Revalidation (Non-blocking, smooth SWR)
    const now = Date.now();
    const shouldRevalidate = !this.homeFeedCacheTime || (now - this.homeFeedCacheTime > 60000) || !hasRenderedCache;

    if (shouldRevalidate) {
      try {
        let freshVideos = [];
        if (isAuth) {
          freshVideos = await this.api.getSmartFeed(192, this.history, this.watchProgress);
        } else {
          freshVideos = await this.api.getTrending(48);
        }

        if (freshVideos && freshVideos.length > 0) {
          // Sync cross-device watch progress (from phone/PC/other VK Video apps) into local progress map
          if (this.api.lastServerProgress && typeof this.api.lastServerProgress === 'object') {
            let syncedAny = false;
            for (const [vidId, srvProg] of Object.entries(this.api.lastServerProgress)) {
              const localProg = this.watchProgress[vidId];
              if (!localProg || (srvProg.currentTime > localProg.currentTime && !localProg.timestamp)) {
                this.watchProgress[vidId] = { ...srvProg };
                syncedAny = true;
              } else if (localProg && !localProg.currentTime && srvProg.currentTime > 15) {
                this.watchProgress[vidId] = { ...srvProg };
                syncedAny = true;
              }
            }
            if (syncedAny) {
              this.saveUserScopedData('watch_progress', this.watchProgress);
            }
          }

          this.homeFeedCache = freshVideos;
          this.homeFeedCacheTime = Date.now();
          try {
            localStorage.setItem(cacheKey, JSON.stringify(freshVideos.slice(0, 120)));
          } catch (e) {}

          if (this.currentSection === 'home') {
            const userScrolled = grid && grid.scrollTop > 80;
            const modalOrPlayerActive = this.isModalOpen() || (this.player && this.player.container.style.display !== 'none');
            if (!hasRenderedCache || (!userScrolled && !modalOrPlayerActive)) {
              const prevFocusedId = (this.nav && this.nav.currentFocused && this.nav.currentFocused.dataset) ? this.nav.currentFocused.dataset.id : null;
              grid.innerHTML = '';
              this.renderVideoCards(grid, freshVideos);
              if (prevFocusedId) {
                const sameCard = grid.querySelector(`.video-card[data-id="${prevFocusedId}"]`);
                if (sameCard && this.nav) this.nav.setFocus(sameCard, false);
                else this.focusCurrentSection();
              } else {
                this.focusCurrentSection();
              }
            }
          }
        }
      } catch (err) {
        console.warn('[App] Home feed revalidation error:', err);
        if (!hasRenderedCache) {
          grid.innerHTML = `<div style="color:var(--danger-color); font-size:22px; padding:30px;">Ошибка загрузки видео: ${err.message}</div>`;
        }
      }
    }
  }

  renderChannelsRow(channelsRow, channels) {
    channelsRow.innerHTML = '';
    if (channels && channels.length > 0) {
      channels.forEach(ch => {
        const chip = document.createElement('div');
        chip.className = 'channel-chip focusable';
        chip.dataset.id = ch.id;
        const safeChName = this.escapeHtml(ch.name || 'Канал');
        chip.innerHTML = `
          <img class="channel-chip-avatar" src="${this.escapeHtml(ch.avatar || 'assets/icon.png')}" alt="${safeChName}" onerror="this.src='assets/icon.png'">
          <span class="channel-chip-name" title="${safeChName}">${safeChName}</span>
        `;
        chip.addEventListener('click', () => {
          this.renderChannel(ch.id, ch.name);
        });
        channelsRow.appendChild(chip);
      });
    } else {
      channelsRow.innerHTML = '<div style="color:var(--text-muted); font-size: 18px; padding: 10px;">Нет активных сообществ</div>';
    }
  }

  async renderSubscriptions() {
    const content = document.getElementById('main-content');
    const isAuth = this.api.isAuthorized();

    if (!isAuth) {
      content.innerHTML = `
        <div class="section-header">
          <div class="section-title">
            <span>Мои подписки</span>
          </div>
          <div class="section-subtitle">Для доступа к подпискам войдите в свой аккаунт VK</div>
        </div>
        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 50px; max-width: 800px; display: flex; flex-direction: column; gap: 24px;">
          <div style="font-size: 24px; color: #f0f6fc;">Смотрите видео из ваших любимых сообществ и каналов на большом экране 4K</div>
          <button class="player-btn focusable" id="subs-login-btn" style="background: #0077ff; padding: 18px 40px; font-size: 22px; width: fit-content;">⚡ Войти по QR-коду</button>
        </div>
      `;
      const btn = document.getElementById('subs-login-btn');
      if (btn) {
        btn.addEventListener('click', () => this.openQRModal());
        this.nav.setFocus(btn);
      }
      return;
    }

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">
          <span>Мои подписки</span>
          <span class="badge-4k">4K UHD</span>
        </div>
        <div class="section-subtitle">Каналы и свежие видео ваших подписок</div>
      </div>

      <div class="subscriptions-channels-section">
        <div class="channels-carousel-title">Каналы и сообщества</div>
        <div class="channels-carousel" id="subs-channels-row">
          <div style="color:var(--text-muted); font-size: 18px; padding: 10px;">Загрузка каналов...</div>
        </div>
      </div>

      <div class="feed-section-title" style="margin-top: 25px; margin-bottom: 15px; font-size: 26px; font-weight: 700;">Новые видео из ваших подписок</div>
      <div class="video-grid" id="subs-feed-grid"></div>
    `;

    const channelsRow = document.getElementById('subs-channels-row');
    const feedGrid = document.getElementById('subs-feed-grid');
    const userSuffix = this.activeUserId ? `user_${this.activeUserId}` : 'guest';

    // 1. Instant Cache Render (Stale-While-Revalidate: 0 ms)
    let cachedChannels = this.subsChannelsCache;
    let cachedFeed = this.subsFeedCache;
    if (!cachedChannels || !cachedFeed) {
      try {
        const rawCh = localStorage.getItem(`vk_subs_channels_cache_${userSuffix}`);
        const rawFeed = localStorage.getItem(`vk_subs_feed_cache_${userSuffix}`);
        if (rawCh) cachedChannels = JSON.parse(rawCh);
        if (rawFeed) cachedFeed = JSON.parse(rawFeed);
      } catch (e) {}
    }

    let hasRenderedCache = false;
    if (cachedChannels && cachedFeed && cachedChannels.length > 0) {
      cachedFeed.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
      this.subsChannelsCache = cachedChannels;
      this.subsFeedCache = cachedFeed;
      this.userSubscribedIds = new Set(cachedChannels.map(c => -Math.abs(c.id)));
      this.renderChannelsRow(channelsRow, cachedChannels);
      this.renderVideoCards(feedGrid, cachedFeed);
      this.focusCurrentSection();
      hasRenderedCache = true;
    } else {
      this.renderSkeletons(feedGrid, 8);
    }

    // 2. Background Revalidation
    const now = Date.now();
    const shouldRevalidate = !this.subsCacheTime || (now - this.subsCacheTime > 60000) || !hasRenderedCache;

    if (shouldRevalidate) {
      try {
        const [channels, feedVideos] = await Promise.all([
          this.api.getUserSubscriptions(80),
          this.api.getUserSubscriptionsFeed(160, 240)
        ]);

        if (channels && channels.length > 0) {
          this.userSubscribedIds = new Set(channels.map(c => -Math.abs(c.id)));
        }

        if (feedVideos && feedVideos.length > 0) {
          feedVideos.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
        }

        this.subsChannelsCache = channels;
        this.subsFeedCache = feedVideos;
        this.subsCacheTime = Date.now();
        try {
          localStorage.setItem(`vk_subs_channels_cache_${userSuffix}`, JSON.stringify(channels));
          localStorage.setItem(`vk_subs_feed_cache_${userSuffix}`, JSON.stringify(feedVideos));
        } catch (e) {}

        if (this.currentSection === 'subscriptions') {
          const userScrolled = feedGrid && feedGrid.scrollTop > 80;
          const modalOrPlayerActive = this.isModalOpen() || (this.player && this.player.container.style.display !== 'none');
          if (!hasRenderedCache || (!userScrolled && !modalOrPlayerActive)) {
            this.renderChannelsRow(channelsRow, channels);
            feedGrid.innerHTML = '';
            if (feedVideos && feedVideos.length > 0) {
              this.renderVideoCards(feedGrid, feedVideos);
            } else {
              feedGrid.innerHTML = '<div style="color:var(--text-muted); font-size: 22px; padding: 30px;">В ленте подписок пока нет новых длинных видео</div>';
            }
            this.focusCurrentSection();
          }
        }
      } catch (err) {
        console.error('[App] Subscriptions load error:', err);
        if (!hasRenderedCache) {
          feedGrid.innerHTML = `<div style="color:var(--danger-color); font-size:22px; padding:30px;">Ошибка загрузки подписок: ${err.message}</div>`;
        }
      }
    }
  }

  renderCategories() {
    this.currentCategory = null;
    const content = document.getElementById('main-content');
    const categories = [
      { id: 'movies', title: 'Фильмы 4K', icon: '🎬' },
      { id: 'series', title: 'Сериалы', icon: '📺' },
      { id: 'shows', title: 'Шоу и Передачи', icon: '🎤' },
      { id: 'games', title: 'Игры и Гейминг', icon: '🎮' },
      { id: 'tech', title: 'Технологии и Гаджеты', icon: '💻' },
      { id: 'nature', title: 'Природа 4K Relax', icon: '🌲' },
      { id: 'kids', title: 'Детям и Мультфильмы', icon: '🧸' },
      { id: 'music', title: 'Музыка и Клипы 4K', icon: '🎵' }
    ];

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Категории контента</div>
        <div class="section-subtitle">Выберите интересующую тематику видео</div>
      </div>
      <div class="video-grid" id="cat-grid" style="grid-template-columns: repeat(4, 1fr); gap: 24px; align-content: start; grid-auto-rows: max-content;">
        ${categories.map(c => `
          <div class="video-card focusable cat-card" data-cat="${c.id}" style="padding: 36px 20px; text-align: center; cursor: pointer; align-items: center; justify-content: center;">
            <div style="font-size: 58px; margin-bottom: 16px;">${c.icon}</div>
            <div style="font-size: 22px; font-weight: 700; color: var(--text-main);">${c.title}</div>
          </div>
        `).join('')}
      </div>
    `;

    document.querySelectorAll('.cat-card').forEach(card => {
      card.addEventListener('click', () => {
        const catId = card.dataset.cat;
        const catTitle = card.querySelector('div:last-child').textContent;
        this.selectCategory(catId, catTitle);
      });
    });
  }

  async selectCategory(catId, catTitle = null) {
    const titles = {
      movies: 'Фильмы 4K',
      series: 'Сериалы',
      shows: 'Шоу и Передачи',
      games: 'Игры и Гейминг',
      tech: 'Технологии и Гаджеты',
      nature: 'Природа 4K Relax',
      kids: 'Детям и Мультфильмы',
      music: 'Музыка и Клипы 4K'
    };
    const resolvedTitle = catTitle || titles[catId] || 'Категория';
    this.currentCategory = catId;
    const content = document.getElementById('main-content');
    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">
          <span>Категория: ${this.escapeHtml(resolvedTitle)}</span>
          <button class="player-btn focusable" id="cat-back-btn" style="font-size: 16px; padding: 6px 16px; margin-left: 15px;">⬅ Назад к категориям</button>
        </div>
        <div class="section-subtitle">Полноформатные видео в высоком разрешении без коротких клипов</div>
      </div>
      <div class="video-grid" id="video-grid"></div>
    `;
    document.getElementById('cat-back-btn').addEventListener('click', () => {
      this.currentCategory = null;
      this.renderCategories();
      this.focusCurrentSection();
    });
    const grid = document.getElementById('video-grid');
    this.renderSkeletons(grid, 8);
    const videos = await this.api.getCategory(catId);
    if (this.currentSection === 'categories' && this.currentCategory === catId) {
      grid.innerHTML = '';
      this.renderVideoCards(grid, videos);
      this.focusCurrentSection();
    }
  }

  normalizeVoiceQuery(raw) {
    if (!raw) return '';
    let q = raw.trim().replace(/[.,!?;:]+$/, '').trim();
    const lower = q.toLowerCase();
    if (lower === 'вилса ком' || lower === 'вилсаком') return 'Wylsacom';
    if (lower === 'чбд') return 'Что было дальше';
    if (lower === 'лейбл смарт' || lower === 'лейблсмарт') return 'Labelsmart';
    return q;
  }

  async getDynamicTrendingTags() {
    if (this.cachedTrendingTags && this.cachedTrendingTags.length > 0) {
      return this.cachedTrendingTags;
    }

    const baseTags = [
      '🔥 Шоу Контакты', '🔥 Что Было Дальше', '🔥 Большое Шоу', '🔥 Кстати',
      '🔥 Натальная Карта', '🔥 Женский Форум', '🔥 Вписка', '🔥 Stand Up',
      '🔥 Плюшки', '🔥 Wylsacom', 'Космос 4K', 'Фильмы 4K', 'Природа 4K', 'Наука 4K'
    ];

    try {
      let videos = this.homeFeedCache;
      if (!videos || videos.length === 0) {
        videos = await this.api.getTrending(24).catch(() => []);
      }

      if (videos && videos.length > 0) {
        const dynamicSet = new Set();
        for (const v of videos) {
          if (!v) continue;
          if (v.author && v.author.length >= 3 && v.author.length <= 22 && !/vk|видео|video/i.test(v.author)) {
            dynamicSet.add(`🔥 ${v.author}`);
          }
          if (v.title) {
            const parts = v.title.split(/[|—:\/«»]/).map(s => s.trim());
            for (const p of parts) {
              if (p.length >= 4 && p.length <= 24 && !/выпуск|сезон|серия|эпизод|\d{4}/i.test(p)) {
                dynamicSet.add(`🔥 ${p}`);
                break;
              }
            }
          }
          if (dynamicSet.size >= 8) break;
        }

        const combined = Array.from(new Set([...dynamicSet, ...baseTags])).slice(0, 16);
        this.cachedTrendingTags = combined;
        return combined;
      }
    } catch (e) {
      console.warn('[App] Dynamic trending tags error:', e);
    }

    this.cachedTrendingTags = baseTags;
    return baseTags;
  }

  async renderSearch() {
    this.searchQuery = ''; // Always reset search query when opening search
    const content = document.getElementById('main-content');
    const tags = await this.getDynamicTrendingTags();

    content.innerHTML = `
      <div class="search-container">
        <div class="search-input-box" id="search-box">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="#8b949e" style="flex-shrink:0;"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          <input type="text"
                 id="search-real-input"
                 class="search-real-input focusable"
                 placeholder="Введите название видео..."
                 value=""
                 autocomplete="off"
                 autocorrect="off"
                 autocapitalize="off"
                 spellcheck="false" />
          <button class="player-btn focusable" id="do-search-btn" style="padding: 10px 22px; font-size: 18px; font-weight:600;">Найти</button>
          <button class="player-btn focusable" id="toggle-kb-btn" style="padding: 10px 20px; font-size: 18px;">⌨ Экранная</button>
          <button class="player-btn focusable" id="clear-search-btn" style="padding: 10px 20px; font-size: 18px;">Очистить</button>
        </div>

        <div class="quick-tags-section" id="quick-tags-section" style="display:flex;">
          <div class="quick-tags-title">
            <span style="font-size: 22px;">🔥</span>
            <span>Тренды и популярные темы в VK Видео:</span>
          </div>
          <div class="quick-tags-grid" id="quick-tags-grid">
            ${tags.map(tag => {
              const cleanQuery = tag.replace(/^[🔥#]\s*/, '');
              return `<button class="quick-tag focusable" data-query="${cleanQuery}">${tag}</button>`;
            }).join('')}
          </div>
        </div>

        <div class="tv-keyboard" id="tv-keyboard" style="display:none;"></div>

        <div class="video-grid" id="search-results-grid" style="flex: 1; min-height: 0; overflow-y: auto;"></div>
      </div>
    `;

    const searchInput = document.getElementById('search-real-input');
    const quickTagsSec = document.getElementById('quick-tags-section');

    const triggerSearchFromInput = () => {
      if (!searchInput) return;
      const raw = searchInput.value;
      const normalized = this.normalizeVoiceQuery(raw);
      if (!normalized) return;
      this.searchQuery = normalized;
      searchInput.value = normalized;

      this.executeSearch();
      searchInput.blur();
    };

    if (searchInput) {
      // Keep query synced while user is typing without aggressively clearing or auto-searching
      searchInput.addEventListener('input', () => {
        this.searchQuery = searchInput.value;
        const textEl = document.getElementById('search-display-text');
        if (textEl) {
          textEl.textContent = this.searchQuery || 'Поиск...';
          if (this.searchQuery) textEl.classList.remove('placeholder');
          else textEl.classList.add('placeholder');
        }
      });

      searchInput.addEventListener('focus', () => {
        setTimeout(() => {
          try { searchInput.select(); } catch (e) {}
        }, 10);
      });

      // User confirmed/committed input (e.g. voice speech-to-text done or IME commit)
      searchInput.addEventListener('change', () => {
        triggerSearchFromInput();
      });

      // Pressing OK / Enter executes the search immediately (stopPropagation avoids double-clicking input via navigation.js)
      searchInput.addEventListener('keydown', (e) => {
        if (e.keyCode === 13) {
          e.preventDefault();
          e.stopPropagation();
          triggerSearchFromInput();
        }
      });
    }

    const doSearchBtn = document.getElementById('do-search-btn');
    if (doSearchBtn) {
      doSearchBtn.addEventListener('click', () => {
        triggerSearchFromInput();
      });
    }

    // Bind Quick tags
    content.querySelectorAll('.quick-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        this.searchQuery = btn.dataset.query;
        this.updateSearchInput();
        this.executeSearch();
      });
    });

    document.getElementById('toggle-kb-btn').addEventListener('click', () => {
      const kb = document.getElementById('tv-keyboard');
      if (kb) {
        const isHidden = kb.style.display === 'none';
        kb.style.display = isHidden ? 'flex' : 'none';
        if (quickTagsSec) {
          const gridEl = document.getElementById('search-results-grid');
          const hasResults = gridEl && gridEl.querySelector('.video-card');
          quickTagsSec.style.display = (!isHidden && !hasResults) ? 'flex' : 'none';
        }
        if (isHidden) {
          const firstKey = kb.querySelector('.kb-key');
          if (firstKey) this.nav.setFocus(firstKey);
        }
      }
    });

    document.getElementById('clear-search-btn').addEventListener('click', () => {
      this.searchQuery = '';
      if (searchInput) searchInput.value = '';
      document.getElementById('search-results-grid').innerHTML = '';
      if (quickTagsSec) quickTagsSec.style.display = 'flex';
      const kb = document.getElementById('tv-keyboard');
      if (kb) kb.style.display = 'none';
      if (searchInput) this.nav.setFocus(searchInput);
    });

    this.renderKeyboard();
  }

  initKeyboard() {
    this.kbLayouts = {
      ru: [
        ['1','2','3','4','5','6','7','8','9','0','-','_'],
        ['Й','Ц','У','К','Е','Н','Г','Ш','Щ','З','Х','Ъ'],
        ['Ф','Ы','В','А','П','Р','О','Л','Д','Ж','Э'],
        ['Я','Ч','С','М','И','Т','Ь','Б','Ю','4K']
      ],
      en: [
        ['1','2','3','4','5','6','7','8','9','0','-','_'],
        ['Q','W','E','R','T','Y','U','I','O','P'],
        ['A','S','D','F','G','H','J','K','L'],
        ['Z','X','C','V','B','N','M','4K']
      ]
    };
  }

  renderKeyboard() {
    const kbContainer = document.getElementById('tv-keyboard');
    if (!kbContainer) return;

    const rows = this.kbLayouts[this.keyboardLang];
    kbContainer.innerHTML = `
      ${rows.map(row => `
        <div class="keyboard-row">
          ${row.map(k => `<button class="kb-key focusable" data-char="${k}">${k}</button>`).join('')}
        </div>
      `).join('')}
      <div class="keyboard-row">
        <button class="kb-key action-key focusable" id="kb-lang-toggle">${this.keyboardLang === 'ru' ? 'EN' : 'RU'}</button>
        <button class="kb-key space-key focusable" data-char=" ">ПРОБЕЛ</button>
        <button class="kb-key action-key focusable" id="kb-backspace">⌫ СТЕРЕТЬ</button>
        <button class="kb-key search-btn focusable" id="kb-do-search">🔍 НАЙТИ</button>
      </div>
    `;

    kbContainer.querySelectorAll('.kb-key[data-char]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.searchQuery += btn.dataset.char;
        this.updateSearchInput();
      });
    });

    document.getElementById('kb-lang-toggle').addEventListener('click', () => {
      this.keyboardLang = this.keyboardLang === 'ru' ? 'en' : 'ru';
      this.renderKeyboard();
      this.nav.setFocus(document.getElementById('kb-lang-toggle'));
    });

    document.getElementById('kb-backspace').addEventListener('click', () => {
      this.searchQuery = this.searchQuery.slice(0, -1);
      this.updateSearchInput();
    });

    document.getElementById('kb-do-search').addEventListener('click', () => {
      this.searchQuery = this.normalizeVoiceQuery(this.searchQuery);
      this.updateSearchInput();
      this.executeSearch();
    });
  }

  updateSearchInput() {
    const input = document.getElementById('search-real-input');
    if (input) {
      input.value = this.searchQuery || '';
    }
    const textEl = document.getElementById('search-display-text');
    if (textEl) {
      if (this.searchQuery) {
        textEl.textContent = this.searchQuery;
        textEl.classList.remove('placeholder');
      } else {
        textEl.textContent = 'Введите запрос...';
        textEl.classList.add('placeholder');
      }
    }
  }

  async executeSearch() {
    if (!this.searchQuery || !this.searchQuery.trim()) return;
    const grid = document.getElementById('search-results-grid');
    const kb = document.getElementById('tv-keyboard');
    const quickTagsSec = document.getElementById('quick-tags-section');

    // Collapse quick tags and keyboard when results are fetched so user can view full-screen results
    if (quickTagsSec) quickTagsSec.style.display = 'none';
    if (kb) kb.style.display = 'none';

    grid.innerHTML = '';
    this.renderSkeletons(grid, 8);
    this.showToast(`Поиск: "${this.searchQuery}"`);

    const results = await this.api.search(this.searchQuery, 60);
    if (this.currentSection !== 'search') return;
    grid.innerHTML = '';
    if (!results || results.length === 0) {
      grid.innerHTML = `
        <div style="font-size: 24px; color:#8b949e; padding: 20px 10px; grid-column: 1 / -1;">
          По запросу «${this.escapeHtml(this.searchQuery)}» видео не найдено. Выберите тренд или уточните запрос.
        </div>
      `;
      if (quickTagsSec) quickTagsSec.style.display = 'flex';
      if (kb) kb.style.display = 'none';
      const firstTag = quickTagsSec && quickTagsSec.querySelector('.quick-tag');
      const searchInput = document.getElementById('search-real-input');
      if (firstTag && this.nav) this.nav.setFocus(firstTag);
      else if (searchInput && this.nav) this.nav.setFocus(searchInput);
    } else {
      this.renderVideoCards(grid, results);
      this.showToast(`Найдено ${results.length} видео`);
      const firstCard = grid.querySelector('.video-card');
      if (firstCard) this.nav.setFocus(firstCard);
    }
  }

  /**
   * Automated Voice Search Macro (Triggered exclusively by Red Button):
   * 1. Navigates cleanly into Search.
   * 2. Focuses search input to summon the webOS Virtual Keyboard.
   * 3. Awaits keyboard deployment (detected via viewport resize).
   * 4. Dispatches 7x Right Arrow + 1x OK via low-level networkinput service to trigger voice microphone.
   */
  async triggerVoiceSearchMacro() {
    this.searchQuery = '';
    await this.loadSection('search');

    const searchInput = document.getElementById('search-real-input');
    if (!searchInput) return;

    searchInput.value = '';
    if (this.nav) this.nav.setFocus(searchInput);
    searchInput.focus();
    searchInput.click();

    this.showToast('🎙️ Активация микрофона...');

    // Start key navigation in sync with virtual keyboard appearance (280ms / 100ms)
    const isAlreadyFocused = document.activeElement === searchInput;
    const waitTime = isAlreadyFocused ? 100 : 280;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Native webOS sendKeyCode macro via networkinput service (fast movement + stable settle & click)
    const cmd = "for i in 1 2 3 4 5 6 7; do luna-send -n 1 luna://com.webos.service.networkinput/test/sendKeyCode '{\"keyCode\": 106}' >/dev/null; done; usleep 75000; luna-send -n 1 luna://com.webos.service.networkinput/test/sendKeyCode '{\"keyCode\": 352}' >/dev/null; luna-send -n 1 luna://com.webos.service.networkinput/test/sendKeyCode '{\"keyCode\": 28}' >/dev/null";

    try {
      if (window.webOS && window.webOS.service) {
        window.webOS.service.request('luna://org.webosbrew.hbchannel.service', {
          method: 'exec',
          parameters: { command: cmd },
          onSuccess: (res) => {
            console.log('[VoiceMacro] Key macro executed successfully');
          },
          onFailure: (err) => {
            console.warn('[VoiceMacro] Execution failed:', err);
          }
        });
      }
    } catch (e) {
      console.warn('[VoiceMacro] Error dispatching macro:', e);
    }
  }

  renderDirectInput() {
    const content = document.getElementById('main-content');
    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Воспроизвести по ссылке или ID</div>
        <div class="section-subtitle">Вставьте прямую ссылку VK Video или идентификатор вида -22822305_456241859</div>
      </div>
      <div style="background:#161b22; padding: 40px; border-radius: 20px; max-width: 900px; display:flex; flex-direction:column; gap:25px;">
        <input type="text" id="direct-input" class="focusable" placeholder="Например: -22822305_456241859 или vk.com/video..." style="background:#21262d; border:2px solid rgba(255,255,255,0.15); color:#fff; font-size:22px; padding:18px 24px; border-radius:14px; width:100%;">
        <div style="display:flex; gap:15px;">
          <button class="player-btn focusable" id="direct-play-btn" style="background:#0077ff; padding:16px 36px; font-size:20px;">⚡ Запустить в 4K</button>
          <button class="player-btn focusable" id="demo-4k-btn" style="background:#21262d; padding:16px 25px; font-size:18px;">Вставить демо 4K видео</button>
        </div>
      </div>
    `;

    const directInput = document.getElementById('direct-input');
    const launchDirect = () => {
      const val = directInput ? directInput.value.trim() : '';
      if (!val) {
        this.showToast('Введите ссылку или ID');
        return;
      }
      this.playByDirectId(val);
    };

    if (directInput) {
      directInput.addEventListener('keydown', (e) => {
        if (e.keyCode === 13) {
          e.preventDefault();
          e.stopPropagation();
          launchDirect();
        }
      });
    }

    document.getElementById('demo-4k-btn').addEventListener('click', () => {
      if (directInput) directInput.value = '-22822305_456241859';
      this.showToast('Вставлен демо-ID');
    });

    document.getElementById('direct-play-btn').addEventListener('click', launchDirect);
  }

  async playByDirectId(input) {
    let videoId = input;
    const match = input.match(/video(-?\d+_\d+)/);
    if (match) {
      videoId = match[1];
    }
    return this.launchVideoById(videoId);
  }

  renderFavorites() {
    const content = document.getElementById('main-content');
    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Избранное</div>
        <div class="section-subtitle">${this.favorites.length} сохраненных видео</div>
      </div>
      <div class="video-grid" id="video-grid"></div>
    `;
    const grid = document.getElementById('video-grid');
    if (this.favorites.length === 0) {
      grid.innerHTML = '<div style="color:#8b949e; font-size:22px;">Вы еще не добавили ни одного видео в избранное</div>';
    } else {
      this.renderVideoCards(grid, this.favorites);
    }
  }

  async renderHistory() {
    this.initThumbnailObserver();
    const content = document.getElementById('main-content');
    const isAuth = this.api.isAuthorized();
    content.innerHTML = `
      <div class="section-header section-header-row">
        <div>
          <div class="section-title">История просмотров</div>
          ${isAuth ? '<div class="section-subtitle">Синхронизирована с вашим аккаунтом VK Видео (ТВ, телефон и ПК)</div>' : ''}
        </div>
        <button class="player-btn focusable" id="clear-hist-btn" style="font-size:16px; flex-shrink:0;">Очистить локальную</button>
      </div>
      <div class="video-grid" id="video-grid"></div>
    `;

    const clearBtn = document.getElementById('clear-hist-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        this.history = [];
        this.saveUserScopedData('history', []);
        await this.renderHistory();
        this.focusCurrentSection();
        this.showToast('Локальная история очищена');
      });
    }

    const grid = document.getElementById('video-grid');
    if (this.history.length > 0) {
      this.renderVideoCards(grid, this.history);
    } else if (!isAuth) {
      grid.innerHTML = '<div style="color:#8b949e; font-size:22px;">История пуста</div>';
    } else {
      this.renderSkeletons(grid, 8);
    }

    if (isAuth) {
      try {
        const serverHistory = await this.api.getServerWatchHistory(40);
        if (this.api.lastServerProgress || (this.api._smartTvContextCache && this.api._smartTvContextCache.serverProgress)) {
          const srvProgMap = (this.api._smartTvContextCache && this.api._smartTvContextCache.serverProgress) || this.api.lastServerProgress || {};
          let changed = false;
          for (const [vidId, srvProg] of Object.entries(srvProgMap)) {
            if (!this.watchProgress[vidId] || (!this.watchProgress[vidId].currentTime && srvProg.currentTime > 15)) {
              this.watchProgress[vidId] = { ...srvProg };
              changed = true;
            }
          }
          if (changed) this.saveUserScopedData('watch_progress', this.watchProgress);
        }

        const merged = this.api.mergeHistories(this.history, serverHistory);
        if (this.currentSection === 'history') {
          grid.innerHTML = '';
          if (merged.length === 0) {
            grid.innerHTML = '<div style="color:#8b949e; font-size:22px;">История пуста</div>';
          } else {
            this.renderVideoCards(grid, merged);
            this.focusCurrentSection();
          }
        }
      } catch (e) {
        console.warn('[App] Server history fetch warning:', e);
        if (this.currentSection === 'history' && this.history.length === 0) {
          grid.innerHTML = '<div style="color:#8b949e; font-size:22px;">История пуста</div>';
        }
      }
    }
  }

  initThumbnailObserver() {
    if (this.thumbnailObserver) {
      try {
        this.thumbnailObserver.disconnect();
      } catch (e) {}
      this.thumbnailObserver = null;
    }
    const blankGif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    if (typeof IntersectionObserver !== 'undefined') {
      this.thumbnailObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const img = entry.target;
          if (entry.isIntersecting) {
            const realSrc = img.dataset.src;
            if (realSrc && img.getAttribute('src') !== realSrc) {
              img.src = realSrc;
            }
          } else {
            // Far offscreen (exceeded 1400px margin): release decoded GPU texture to protect TV memory
            const currentSrc = img.getAttribute('src');
            if (currentSrc && currentSrc !== blankGif && !currentSrc.startsWith('data:image/svg')) {
              img.src = blankGif;
            }
          }
        }
      }, {
        root: null,
        rootMargin: '1400px 0px 1400px 0px'
      });
    }
  }

  createVideoCard(video, isTopViewport = false, shelfId = null) {
    if (!video || !video.id) return null;
    this.videoMap[video.id] = video;
    const card = document.createElement('div');
    card.className = 'video-card focusable';
    card.dataset.id = video.id;
    if (shelfId) {
      card.dataset.shelfId = shelfId;
    }

    const progress = this.watchProgress[video.id];
    const progressPercent = video.progressPercent || (progress && progress.percent > 2 ? progress.percent : 0);
    const dateStr = this.formatPublishDate(video.date);
    const blankGif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const initialThumb = (isTopViewport || !this.thumbnailObserver) ? video.thumbnail : blankGif;

    const safeTitle = this.escapeHtml(video.title || 'Видео');
    const safeAuthor = this.escapeHtml(video.author || 'Канал');
    const safeThumb = this.escapeHtml(initialThumb || '');
    const safeDataSrc = this.escapeHtml(video.thumbnail || '');

    card.innerHTML = `
        <div class="card-thumb-wrap">
          <img class="card-thumb" 
               src="${safeThumb}" 
               data-src="${safeDataSrc}"
               alt="${safeTitle}" 
               decoding="async" 
               ${isTopViewport ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} 
               onerror="this.src='assets/splashBackground.png'">
          <div class="card-badges-row">
            ${video.isLive ? '<span class="badge-overlay-live">🔴 LIVE</span>' : ''}
            ${video.isRecommended ? '<span class="badge-overlay-rec">💡 РЕКОМЕНДАЦИЯ</span>' : ''}
            ${video.is4K && !video.isLive ? '<span class="badge-overlay-4k">4K UHD</span>' : ''}
            ${video.isHD && !video.is4K && !video.isLive ? '<span class="badge-overlay-fhd">1080p</span>' : ''}
          </div>
          <span class="duration-badge">${video.isLive ? 'В ЭФИРЕ' : this.escapeHtml(video.duration)}</span>
          ${progressPercent > 2 ? `<div class="card-progress-bar"><div class="card-progress-fill" style="width: ${progressPercent}%"></div></div>` : ''}
        </div>
        <div class="card-body">
          <div class="card-title" title="${safeTitle}">${safeTitle}</div>
          <div class="card-meta">
            <span class="card-author">${safeAuthor}</span>
            <div class="card-meta-right">
              <span>${this.escapeHtml(video.views)}</span>
              ${dateStr ? `<span class="meta-dot">•</span><span class="card-date">${this.escapeHtml(dateStr)}</span>` : ''}
            </div>
          </div>
        </div>
      `;

      const img = card.querySelector('.card-thumb');
      if (img && this.thumbnailObserver) {
        this.thumbnailObserver.observe(img);
      }

      // Pointer / Air mouse long-press handling
      let longPressTimer = null;
      let isLongPressed = false;

      const handlePressStart = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        isLongPressed = false;
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          isLongPressed = true;
          this.openVideoContextMenu(video);
        }, 500);
      };

      const handlePressEnd = () => {
        clearTimeout(longPressTimer);
        if (isLongPressed) {
          setTimeout(() => {
            isLongPressed = false;
          }, 450);
        }
      };

      card.addEventListener('mousedown', handlePressStart);
      card.addEventListener('mouseup', handlePressEnd);
      card.addEventListener('mouseleave', handlePressEnd);
      card.addEventListener('touchstart', handlePressStart, { passive: true });
      card.addEventListener('touchend', handlePressEnd);

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openVideoContextMenu(video);
      });

      card.addEventListener('click', (e) => {
        if (isLongPressed) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        this.launchVideoById(video.id, video.author);
      });

    return card;
  }

  async launchVideoById(videoId, fallbackAuthor = '') {
    if (!videoId) return;
    const reqId = (this._playRequestId = (this._playRequestId || 0) + 1);
    this.showToast('Загрузка видеопотока 4K...');
    try {
      const details = await this.api.getVideoDetails(videoId);
      if (reqId !== this._playRequestId) return;
      if (!details.author && fallbackAuthor) details.author = fallbackAuthor;
      this.player.loadAndPlay(details);
    } catch (err) {
      if (reqId !== this._playRequestId) return;
      console.error('[App] Play error:', err);
      this.showToast(`Ошибка: ${err.message}`);
    }
  }

  refreshCardProgress(videoId) {
    if (!videoId) return;
    const progress = this.watchProgress[videoId];
    const pct = (progress && progress.percent > 2) ? progress.percent : 0;
    document.querySelectorAll(`.video-card[data-id="${videoId}"]`).forEach(card => {
      const wrap = card.querySelector('.card-thumb-wrap');
      if (!wrap) return;
      let bar = wrap.querySelector('.card-progress-bar');
      if (pct > 2) {
        if (!bar) {
          bar = document.createElement('div');
          bar.className = 'card-progress-bar';
          bar.innerHTML = '<div class="card-progress-fill"></div>';
          wrap.appendChild(bar);
        }
        const fill = bar.querySelector('.card-progress-fill');
        if (fill) fill.style.width = `${pct}%`;
      } else if (bar) {
        bar.remove();
      }
    });
  }

  renderVideoCards(container, list) {
    if (!list || list.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); font-size:22px; padding:30px;">Нет доступных полноформатных видео</div>';
      return;
    }
    const deduped = (this.api && typeof this.api.deduplicateVideos === 'function')
      ? this.api.deduplicateVideos(list)
      : list;
    container._renderedIds = new Set();
    container._renderedTitles = new Set();
    deduped.forEach((video, idx) => {
      if (!video || !video.id) return;
      container._renderedIds.add(video.id);
      if (this.api && typeof this.api.normalizeVideoTitleKey === 'function') {
        const tKey = this.api.normalizeVideoTitleKey(video.title);
        if (tKey.length >= 12) container._renderedTitles.add(tKey);
      }
      const card = this.createVideoCard(video, idx < 16);
      if (card) container.appendChild(card);
    });
  }

  appendVideoCards(container, list) {
    if (!list || list.length === 0 || !container) return;
    if (!container._renderedIds) {
      container._renderedIds = new Set();
      container.querySelectorAll('.video-card[data-id]').forEach(el => {
        if (el.dataset && el.dataset.id) container._renderedIds.add(el.dataset.id);
      });
    }
    if (!container._renderedTitles) {
      container._renderedTitles = new Set();
    }

    const fragment = document.createDocumentFragment();
    list.forEach(video => {
      if (!video || !video.id) return;
      if (container._renderedIds.has(video.id)) return; // Strictly eliminate ID duplicates
      const tKey = (this.api && typeof this.api.normalizeVideoTitleKey === 'function')
        ? this.api.normalizeVideoTitleKey(video.title)
        : '';
      if (tKey.length >= 12 && container._renderedTitles.has(tKey)) return; // Eliminate cross-channel repost duplicates

      container._renderedIds.add(video.id);
      if (tKey.length >= 12) container._renderedTitles.add(tKey);
      const card = this.createVideoCard(video, false);
      if (card) fragment.appendChild(card);
    });
    container.appendChild(fragment);

    // Memory Guard: prune videoMap cache when it grows large (> 600 items)
    const keys = Object.keys(this.videoMap);
    if (keys.length > 600) {
      for (let i = 0; i < 200; i++) {
        delete this.videoMap[keys[i]];
      }
    }
  }

  onElementFocused(element) {
    if (!element || this.currentSection !== 'home') return;
    if (this.isLoadingMoreHome || !this.hasMoreHomeVideos) return;

    if (element.classList && element.classList.contains('video-card')) {
      // Check shelves in home showcase
      const shelves = document.querySelectorAll('.shelf-container');
      if (shelves.length > 0) {
        const lastShelf = shelves[shelves.length - 1];
        if (lastShelf && lastShelf.contains(element)) {
          this.loadMoreHomeShelves();
        }
      }

      // Check legacy/fallback grid if present
      const grid = document.getElementById('video-grid');
      if (grid) {
        const allCards = grid.querySelectorAll('.video-card');
        const idx = Array.prototype.indexOf.call(allCards, element);
        if (idx >= allCards.length - 12) {
          this.loadMoreHomeFeed();
        }
      }
    }
  }

  onShowcaseScrolled(container) {
    if (!container || this.currentSection !== 'home') return;
    if (this.isLoadingMoreHome || !this.hasMoreHomeVideos) return;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 700) {
      this.loadMoreHomeShelves();
    }
  }

  async loadMoreHomeShelves() {
    if (this.isLoadingMoreHome || !this.hasMoreHomeVideos || this.currentSection !== 'home') return;
    this.isLoadingMoreHome = true;
    const shelvesWrap = document.getElementById('shelves-wrapper');
    if (!shelvesWrap) {
      this.isLoadingMoreHome = false;
      return;
    }

    try {
      const moreVideos = await this.api.getMoreSmartFeedVideos(
        this.homeFeedOffset,
        36,
        this.history,
        this.watchProgress
      );

      if (moreVideos && moreVideos.length > 0) {
        this.homeFeedOffset += moreVideos.length;
        const pageNum = Math.floor(this.homeFeedOffset / 36);
        const shelfEl = document.createElement('div');
        shelfEl.className = 'shelf-container';
        const shelfId = `extra_rec_${pageNum}`;
        shelfEl.id = `shelf-${shelfId}`;
        shelfEl.dataset.shelfId = shelfId;

        shelfEl.innerHTML = `
          <div class="shelf-header">
            <div class="shelf-title">
              <span>✨ Еще рекомендации • Подборка ${pageNum}</span>
              <span class="badge-shelf-count">${moreVideos.length}</span>
            </div>
          </div>
          <div class="shelf-row" id="shelf-row-${shelfId}" data-shelf-id="${shelfId}"></div>
        `;

        const rowEl = shelfEl.querySelector('.shelf-row');
        moreVideos.forEach(v => {
          const card = this.createVideoCard(v, false, shelfId);
          if (card) rowEl.appendChild(card);
        });

        shelvesWrap.appendChild(shelfEl);
        this.hasMoreHomeVideos = true;
      }
    } catch (e) {
      console.warn('[App] loadMoreHomeShelves error:', e);
    } finally {
      this.isLoadingMoreHome = false;
    }
  }

  onGridScrolled(grid) {
    if (!grid || this.currentSection !== 'home') return;
    if (this.isLoadingMoreHome || !this.hasMoreHomeVideos) return;
    if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 900) {
      this.loadMoreHomeFeed();
    }
  }

  async loadMoreHomeFeed() {
    if (this.isLoadingMoreHome || !this.hasMoreHomeVideos || this.currentSection !== 'home') return;
    this.isLoadingMoreHome = true;
    const grid = document.getElementById('video-grid');
    if (!grid) {
      this.isLoadingMoreHome = false;
      return;
    }

    try {
      const moreVideos = await this.api.getMoreSmartFeedVideos(
        this.homeFeedOffset,
        48,
        this.history,
        this.watchProgress
      );

      if (moreVideos && moreVideos.length > 0) {
        this.homeFeedOffset += moreVideos.length;
        this.appendVideoCards(grid, moreVideos);
        // Truly infinite: keep hasMoreHomeVideos true
        this.hasMoreHomeVideos = true;
      } else {
        // Advance offset and keep infinite scroll alive for subsequent scrolling
        this.homeFeedOffset += 24;
      }
    } catch (e) {
      console.warn('[App] loadMoreHomeFeed error:', e);
    } finally {
      this.isLoadingMoreHome = false;
    }
  }

  /**
   * Video Context Menu Modal (Triggered by Long-Press on Card)
   */
  openVideoContextMenu(video) {
    const modal = document.getElementById('video-context-modal');
    if (!modal) return;

    this.selectedContextVideo = video;
    this.contextModalOpenTime = Date.now();
    const canClick = () => Date.now() - (this.contextModalOpenTime || 0) > 400;

    const titleEl = document.getElementById('context-modal-title');
    const channelNameEl = document.getElementById('ctx-channel-name');
    const favTextEl = document.getElementById('ctx-favorite-text');

    if (titleEl) titleEl.textContent = video.title || 'Действия с видео';
    if (channelNameEl) channelNameEl.textContent = video.author || 'Канал';

    const isFav = this.favorites.some(f => f.id === video.id);
    if (favTextEl) {
      favTextEl.textContent = isFav ? '❌ Удалить из избранного' : '⭐ Добавить в избранное';
    }

    const btnChannel = document.getElementById('ctx-btn-channel');
    const btnSub = document.getElementById('ctx-btn-subscribe');
    const subTextEl = document.getElementById('ctx-subscribe-text');
    const btnPlay = document.getElementById('ctx-btn-play');
    const btnFav = document.getElementById('ctx-btn-favorite');
    const btnClose = document.getElementById('ctx-btn-close');

    const ownerId = parseInt(video.id.split('_')[0], 10);

    // Channel subscription handler
    if (btnSub && subTextEl) {
      if (!this.api.isAuthorized()) {
        subTextEl.textContent = '➕ Войти, чтобы подписаться';
        btnSub.onclick = (e) => {
          if (!canClick()) return;
          this.closeAllModals();
          this.openQRModal();
        };
      } else {
        const isSubscribed = this.userSubscribedIds && this.userSubscribedIds.has(ownerId);
        subTextEl.textContent = isSubscribed ? '➖ Отписаться от канала' : '➕ Подписаться на канал';

        // Async verification via API in background
        this.api.checkIsSubscribed(ownerId).then(actualIsSub => {
          if (this.selectedContextVideo && this.selectedContextVideo.id === video.id) {
            if (actualIsSub) {
              if (this.userSubscribedIds) this.userSubscribedIds.add(ownerId);
            } else {
              if (this.userSubscribedIds) this.userSubscribedIds.delete(ownerId);
            }
            subTextEl.textContent = actualIsSub ? '➖ Отписаться от канала' : '➕ Подписаться на канал';
          }
        }).catch(() => {});

        btnSub.onclick = async (e) => {
          if (!canClick()) return;
          const currentIsSub = this.userSubscribedIds && this.userSubscribedIds.has(ownerId);
          try {
            if (currentIsSub) {
              await this.api.unsubscribeChannel(ownerId);
              if (this.userSubscribedIds) this.userSubscribedIds.delete(ownerId);
              subTextEl.textContent = '➕ Подписаться на канал';
              this.showToast(`Вы отписались от канала «${video.author || 'Канал'}»`);
            } else {
              await this.api.subscribeChannel(ownerId);
              if (this.userSubscribedIds) this.userSubscribedIds.add(ownerId);
              subTextEl.textContent = '➖ Отписаться от канала';
              this.showToast(`Вы подписались на канал «${video.author || 'Канал'}»`);
            }
            // Invalidate subscriptions feed cache so changes show up immediately in "Мои подписки"
            this.subsFeedCache = null;
            this.subsChannelsCache = null;
            this.subsCacheTime = 0;
          } catch (subErr) {
            this.showToast(`Ошибка: ${subErr.message}`);
          }
        };
      }
    }

    btnChannel.onclick = (e) => {
      if (!canClick()) return;
      this.closeAllModals();
      this.renderChannel(ownerId, video.author);
    };

    btnPlay.onclick = (e) => {
      if (!canClick()) return;
      this.closeAllModals();
      this.launchVideoById(video.id, video.author);
    };

    btnFav.onclick = (e) => {
      if (!canClick()) return;
      this.toggleFavorite(video);
      this.closeAllModals();
    };

    btnClose.onclick = (e) => {
      if (!canClick()) return;
      this.closeAllModals();
    };

    modal.style.display = 'flex';
    modal.style.pointerEvents = 'none';
    setTimeout(() => {
      modal.style.pointerEvents = 'auto';
    }, 400);

    this.nav.setFocus(btnChannel);
  }

  toggleFavorite(video) {
    const idx = this.favorites.findIndex(f => f.id === video.id);
    if (idx !== -1) {
      this.favorites.splice(idx, 1);
      this.showToast('Удалено из избранного');
    } else {
      this.favorites.push(video);
      this.showToast('⭐ Добавлено в избранное');
    }
    this.saveUserScopedData('favorites', this.favorites);
    if (this.currentSection === 'favorites') {
      this.renderFavorites();
    }
  }

  async renderChannel(ownerId, channelName = 'Канал') {
    this.currentChannel = {
      ownerId: ownerId,
      channelName: channelName,
      previousSection: this.currentSection || 'home'
    };

    const safeChannel = this.escapeHtml(channelName || 'Канал');
    const content = document.getElementById('main-content');
    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">
          <span>📺 Канал: ${safeChannel}</span>
          <button class="player-btn focusable" id="channel-back-btn" style="font-size: 16px; padding: 6px 16px; margin-left: 15px;">⬅ Назад</button>
        </div>
        <div class="section-subtitle">Полноформатные видео канала без рекламы и шортсов</div>
      </div>
      <div class="video-grid" id="video-grid"></div>
    `;

    document.getElementById('channel-back-btn').addEventListener('click', () => {
      this.handleBack();
    });

    const grid = document.getElementById('video-grid');
    this.renderSkeletons(grid, 8);
    this.showToast(`Загрузка канала: ${channelName}...`);

    try {
      const videos = await this.api.getChannelVideos(ownerId, 40, channelName, 240);
      if (!this.currentChannel || String(this.currentChannel.ownerId) !== String(ownerId)) return;
      if ((!channelName || channelName === 'Канал') && videos && videos.length > 0 && videos[0].author) {
        const titleSpan = content.querySelector('.section-title span');
        if (titleSpan) titleSpan.textContent = `📺 Канал: ${videos[0].author}`;
      }
      grid.innerHTML = '';
      if (!videos || videos.length === 0) {
        grid.innerHTML = '<div style="color:var(--text-muted); font-size:22px; padding:30px;">На этом канале нет доступных длинных видео</div>';
      } else {
        this.renderVideoCards(grid, videos);
      }
      this.focusCurrentSection();
    } catch (err) {
      grid.innerHTML = `<div style="color:var(--danger-color); font-size:22px; padding:30px;">Ошибка загрузки видео канала: ${this.escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * QR-Code Login Modal (Official VK Smart TV Device Flow)
   */
  async openQRModal(forceFresh = false) {
    const modal = document.getElementById('qr-modal');
    const container = document.getElementById('qr-canvas-container');
    const statusEl = document.getElementById('qr-status');
    const codeEl = document.getElementById('qr-auth-code');
    const refreshBtn = document.getElementById('btn-refresh-qr');

    if (!modal) return;
    modal.style.display = 'flex';

    const now = Date.now();
    let codeData = this.activeDeviceAuth;

    // Only fetch new code if forced or older than 3 minutes
    if (forceFresh || !codeData || (now - codeData.created > 180000)) {
      if (codeEl) codeEl.textContent = '-------';
      if (statusEl) statusEl.textContent = 'Получение кода авторизации...';
      if (container) container.innerHTML = '';
      clearInterval(this.qrPollTimer);

      try {
        const fresh = await this.api.getDeviceAuthCode();
        codeData = {
          ...fresh,
          created: Date.now()
        };
        this.activeDeviceAuth = codeData;
      } catch (e) {
        if (statusEl) statusEl.textContent = 'Ошибка получения кода: ' + e.message;
        if (refreshBtn) {
          refreshBtn.onclick = () => this.openQRModal(true);
        }
        return;
      }
    }

    if (codeEl) codeEl.textContent = codeData.authCode;

    // Render crisp QR Code pointing directly to VK OAuth confirmation
    if (window.qrcode && container) {
      container.innerHTML = '';
      const qr = window.qrcode(0, 'M');
      qr.addData(codeData.qrUrl);
      qr.make();
      container.innerHTML = qr.createSvgTag(6, 0);
    }

    if (statusEl) statusEl.textContent = '🟢 Ожидание подтверждения...';

    if (refreshBtn) {
      refreshBtn.onclick = () => {
        this.openQRModal(true);
      };
    }

    // Start Polling for user confirmation on mobile or vk.com/activate
    clearInterval(this.qrPollTimer);
    this.qrPollTimer = setInterval(async () => {
      try {
        const res = await this.api.pollDeviceToken(codeData.authHash || codeData.deviceId);
        if (res && res.status === 'success' && res.token) {
          clearInterval(this.qrPollTimer);
          this.activeDeviceAuth = null;
          await this.completeLoginWithToken(res.token, res.userId);
        } else if (res && res.status === 'expired') {
          console.warn('[QR Poll] Code expired on VK server');
          if (statusEl) statusEl.textContent = '⚠️ Код устарел. Нажмите «Обновить код».';
        }
      } catch (pollErr) {
        console.warn('[QR Poll] error:', pollErr);
      }
    }, 2000);

    const closeBtn = document.getElementById('btn-close-qr');
    if (closeBtn) this.nav.setFocus(closeBtn);
  }

  async completeLoginWithToken(token, userId) {
    const statusEl = document.getElementById('qr-status');
    if (statusEl) statusEl.textContent = '🔄 Подтверждение получено! Загрузка профиля...';
    this.showToast('Вход подтвержден на телефоне!');
    
    clearInterval(this.qrPollTimer);
    this.activeDeviceAuth = null;

    // 1. Save token immediately to guarantee persistent session
    this.api.setToken(token);

    // 2. Fetch user profile with resilient fallback
    let profile = null;
    try {
      profile = await this.api.fetchUserProfile(token, userId);
    } catch (e) {
      console.warn('[App] fetchUserProfile error:', e);
    }

    if (!profile) {
      profile = {
        id: userId || 'me',
        name: 'Пользователь VK',
        photo: null
      };
    }

    // 3. Save into multi-account registry
    const newAccount = {
      id: profile.id,
      name: profile.name,
      photo: profile.photo,
      token: token,
      addedAt: Date.now()
    };

    if (!this.accounts) this.accounts = [];
    const existingIdx = this.accounts.findIndex(a => String(a.id) === String(newAccount.id));
    if (existingIdx !== -1) {
      this.accounts[existingIdx] = newAccount;
    } else {
      this.accounts.push(newAccount);
    }

    this.activeUserId = newAccount.id;
    try {
      localStorage.setItem('vk_user_accounts', JSON.stringify(this.accounts));
      localStorage.setItem('vk_active_user_id', String(newAccount.id));
      localStorage.setItem('vk_user_token', token);
      localStorage.setItem('vk_user_info', JSON.stringify(newAccount));
    } catch (e) {
      console.warn('[App] localStorage write error:', e);
    }

    this.loadUserScopedData(newAccount.id);

    if (statusEl) statusEl.textContent = `✅ Успешно! Добро пожаловать, ${profile.name}!`;
    this.showToast(`Авторизован: ${profile.name}`);

    setTimeout(() => {
      this.closeAllModals();
      this.updateUserCard();
      this.loadSection('home');
    }, 1200);
  }

  /**
   * Quality Selection Modal
   */
  openQualityModal() {
    const modal = document.getElementById('quality-modal');
    const list = document.getElementById('quality-options-list');
    list.innerHTML = '';

    const levels = this.player.availableLevels;
    if (!levels || levels.length === 0) {
      list.innerHTML = '<div style="color:#8b949e;padding:10px;">Для этого потока качество фиксировано</div>';
    } else {
      // Deduplicate by unique height to guarantee clean 2-column TV display
      const heightMap = new Map();
      levels.forEach((lvl, idx) => {
        const h = lvl.height || 0;
        if (h > 0) {
          if (!heightMap.has(h) || (lvl.bitrate && lvl.bitrate > (heightMap.get(h).lvl.bitrate || 0))) {
            heightMap.set(h, { lvl, originalIndex: idx });
          }
        }
      });

      const sortedLevels = Array.from(heightMap.values())
        .sort((a, b) => (b.lvl.height || 0) - (a.lvl.height || 0));

      const currentActiveLvl = this.player.availableLevels[this.player.currentLevelIndex];

      sortedLevels.forEach(({ lvl, originalIndex }) => {
        const btn = document.createElement('button');
        const is4k = lvl.height >= 2160;
        const is2k = lvl.height === 1440;
        const is1080 = lvl.height === 1080;
        
        let label = `${lvl.height}p`;
        let tag = '';
        if (is4k) {
          const isAv1 = this.player.shakaPlayer !== null;
          label = isAv1 ? '4K Ultra HD (2160p) [AV1]' : '4K Ultra HD (2160p)';
          tag = isAv1
            ? '<span class="badge-4k" style="background:#16a34a;color:#fff;">4K AV1 60fps ПЛАВНО</span>'
            : '<span class="badge-4k" style="background:#dc2626;color:#fff;">MAX 4K</span>';
        } else if (is2k) {
          label = '2K Quad HD (1440p)';
          tag = '<span class="badge-4k" style="background:#16a34a;color:#fff;">60fps РЕКОМЕНДУЕТСЯ</span>';
        } else if (is1080) {
          label = 'Full HD (1080p)';
          tag = '<span class="badge-4k" style="background:#2563eb;color:#fff;">60fps ПЛАВНО</span>';
        }

        const isActive = this.player.currentLevelIndex !== -1 && currentActiveLvl && currentActiveLvl.height === lvl.height;
        btn.className = `option-btn focusable ${isActive ? 'active' : ''}`;
        btn.innerHTML = `<span style="display:flex;align-items:center;gap:12px;">${label} ${isActive ? '✓' : ''}</span> ${tag}`;
        btn.addEventListener('click', () => {
          this.player.setQuality(originalIndex);
          this.closeAllModals();
        });
        list.appendChild(btn);
      });

      // Auto level at bottom (spans 2 columns)
      const autoBtn = document.createElement('button');
      const isAutoActive = this.player.currentLevelIndex === -1;
      autoBtn.className = `option-btn auto-quality-btn focusable ${isAutoActive ? 'active' : ''}`;
      autoBtn.innerHTML = `<span>Автоматический выбор (Адаптивный) ${isAutoActive ? '✓' : ''}</span>`;
      autoBtn.addEventListener('click', () => {
        this.player.setQuality(-1);
        this.closeAllModals();
      });
      list.appendChild(autoBtn);
    }

    modal.style.display = 'flex';
    const activeOption = list.querySelector('.option-btn.active') || list.querySelector('.option-btn');
    if (activeOption) this.nav.setFocus(activeOption);
  }

  /**
   * Playback Speed Modal
   */
  openSpeedModal() {
    const modal = document.getElementById('speed-modal');
    const list = document.getElementById('speed-options-list');
    list.innerHTML = '';

    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    speeds.forEach(sp => {
      const btn = document.createElement('button');
      btn.className = `option-btn focusable ${this.player.video.playbackRate === sp ? 'active' : ''}`;
      btn.textContent = `${sp}x ${sp === 1.0 ? '(Стандартная)' : ''}`;
      btn.addEventListener('click', () => {
        this.player.setSpeed(sp);
        this.closeAllModals();
      });
      list.appendChild(btn);
    });

    modal.style.display = 'flex';
    const currentSpeedBtn = list.querySelector('.option-btn.active') || list.querySelector('.option-btn');
    if (currentSpeedBtn) this.nav.setFocus(currentSpeedBtn);
  }

  isModalOpen() {
    return Array.from(document.querySelectorAll('.modal-overlay')).some(m => m.style.display === 'flex');
  }

  closeAllModals() {
    // Keep background qrPollTimer alive if user closes modal while confirming on phone
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.style.display = 'none';
      m.style.pointerEvents = 'auto';
    });
    if (this.player.container.style.display !== 'none') {
      this.nav.setFocus(document.getElementById('btn-play-pause'));
    } else {
      this.focusCurrentSection();
    }
  }

  handleBack() {
    this._playRequestId = (this._playRequestId || 0) + 1;
    if (this.isModalOpen()) {
      this.closeAllModals();
      return;
    }
    if (this.player.container.style.display !== 'none') {
      this.player.close();
      return;
    }
    if (this.currentChannel) {
      const prev = this.currentChannel.previousSection || 'home';
      this.currentChannel = null;
      if (prev === 'categories' && this.currentCategory) {
        this.selectCategory(this.currentCategory);
      } else {
        this.loadSection(prev);
      }
      return;
    }
    if (this.currentCategory) {
      this.currentCategory = null;
      this.renderCategories();
      this.focusCurrentSection();
      return;
    }
    // If on search screen: close on-screen keyboard first, otherwise clear search and restore trending cloud
    if (this.currentSection === 'search') {
      const searchInput = document.getElementById('search-real-input');
      const resultsGrid = document.getElementById('search-results-grid');
      const quickTagsSec = document.getElementById('quick-tags-section');
      const kb = document.getElementById('tv-keyboard');
      if (kb && kb.style.display !== 'none') {
        kb.style.display = 'none';
        const hasResults = resultsGrid && resultsGrid.querySelector('.video-card');
        if (!hasResults && quickTagsSec) quickTagsSec.style.display = 'flex';
        const toggleBtn = document.getElementById('toggle-kb-btn');
        if (toggleBtn) this.nav.setFocus(toggleBtn);
        else if (searchInput) this.nav.setFocus(searchInput);
        return;
      }
      if (this.searchQuery || (resultsGrid && resultsGrid.children.length > 0)) {
        this.searchQuery = '';
        if (searchInput) {
          searchInput.value = '';
          this.nav.setFocus(searchInput);
        }
        if (resultsGrid) resultsGrid.innerHTML = '';
        if (quickTagsSec) quickTagsSec.style.display = 'flex';
        return;
      }
    }
    if (this.currentSection !== 'home') {
      this.loadSection('home');
      return;
    }

    // Double-Back to exit gracefully (Standard TV UX, only on home screen)
    const now = Date.now();
    if (this.lastBackTime && (now - this.lastBackTime < 2400)) {
      if (window.webOS && window.webOS.platformBack) {
        window.webOS.platformBack();
      } else {
        window.close();
      }
    } else {
      this.lastBackTime = now;
      this.showToast('Нажмите «Назад» ещё раз для выхода');
    }
  }

  formatPublishDate(timestamp) {
    if (!timestamp) return '';
    let ts = Number(timestamp);
    if (!ts || isNaN(ts)) return '';
    if (ts < 10000000000) ts *= 1000;

    const now = Date.now();
    const diffSec = Math.floor((now - ts) / 1000);
    if (diffSec < 0) return 'только что';

    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    const plural = (num, one, two, five) => {
      const n = Math.abs(num) % 100;
      const n1 = n % 10;
      if (n > 10 && n < 20) return five;
      if (n1 > 1 && n1 < 5) return two;
      if (n1 === 1) return one;
      return five;
    };

    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} ${plural(diffMin, 'минуту', 'минуты', 'минут')} назад`;
    if (diffHours < 24) return `${diffHours} ${plural(diffHours, 'час', 'часа', 'часов')} назад`;
    if (diffDays === 1) return 'вчера';
    if (diffDays < 7) return `${diffDays} ${plural(diffDays, 'день', 'дня', 'дней')} назад`;

    const d = new Date(ts);
    const months = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
    const day = d.getDate();
    const month = months[d.getMonth()] || '';
    const year = d.getFullYear();
    const curYear = new Date().getFullYear();

    if (year === curYear) {
      return `${day} ${month}`;
    }
    return `${day} ${month} ${year}`;
  }

  focusCurrentSection() {
    setTimeout(() => {
      if (this.isModalOpen() || (this.player && this.player.container.style.display !== 'none')) return;
      const activeNav = document.querySelector('.nav-item.active');
      if (this.nav && this.nav.currentFocused && document.getElementById('sidebar').contains(this.nav.currentFocused)) {
        if (!this.isNavigatingSection) return;
      }
      const target = document.querySelector('#main-content .focusable') || activeNav;
      if (target && this.nav) this.nav.setFocus(target);
    }, 50);
  }

  addToHistory(video) {
    if (!video || !video.id) return;
    this.history = this.history.filter(v => v.id !== video.id);
    const durStr = typeof video.duration === 'number'
      ? this.api.formatDuration(video.duration)
      : (video.duration || 'Видео');
    const viewsStr = typeof video.views === 'number'
      ? this.api.formatViews(video.views)
      : (video.views || '');

    this.history.unshift({
      id: video.id,
      title: video.title || 'Видео',
      author: video.author || 'Канал',
      duration: durStr,
      views: viewsStr,
      thumbnail: video.thumbnail || '',
      is4K: !!(video.is4K || (video.maxQuality && video.maxQuality.includes('4K'))),
      watchedAt: Date.now()
    });
    if (this.history.length > 50) this.history.pop();
    this.saveUserScopedData('history', this.history);
  }

  showToast(text) {
    const toast = document.getElementById('toast');
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }
}

window.VKVideoApp = VKVideoApp;

function bootstrapApp() {
  if (!window.vkApp) {
    console.log('[VKVideoApp] Bootstrapping application on TV...');
    window.app = window.vkApp = new VKVideoApp();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
