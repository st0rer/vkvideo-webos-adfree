/**
 * VK Video AdFree 4K - Player Module
 * High-performance hardware-accelerated 4K player for webOS 6.x (LG OLED C1)
 */

class VideoPlayer {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('player-container');
    if (this.container) this.container.style.display = 'none';
    this.video = document.getElementById('native-player');
    this.osd = document.getElementById('player-osd');
    this.hls = null;
    this.shakaPlayer = null;

    // Install Shaka Player polyfills on init
    if (window.shaka && window.shaka.polyfill) {
      try {
        window.shaka.polyfill.installAll();
      } catch (e) {
        console.warn('[Player] Shaka polyfill warning:', e);
      }
    }
    
    // Player State
    this.currentVideo = null;
    this.availableLevels = [];
    this.currentLevelIndex = -1;
    this.isPlaying = false;
    this.osdTimeout = null;
    this.statsInterval = null;
    this.keepAliveInterval = null;
    this.dropToastShown = false;
    this.playbackSessionId = 0;
    this.pendingResumeTime = 0;
    this.networkRetryCount = 0;
    this.stallWatchdogTimer = null;
    this.stallRecoveryAttempts = 0;
    this.lastProgressTime = 0;
    this.lastStallNudgeAt = 0;

    // Elements
    this.titleEl = document.getElementById('osd-video-title');
    this.channelEl = document.getElementById('osd-video-channel');
    this.qualityBadgeEl = document.getElementById('osd-active-quality');
    this.bufferingEl = document.getElementById('osd-buffering');
    this.progressBar = document.getElementById('progress-played');
    this.bufferedBar = document.getElementById('progress-buffered');
    this.thumb = document.getElementById('progress-thumb');
    this.timeCurrentEl = document.getElementById('time-current');
    this.timeTotalEl = document.getElementById('time-total');
    this.timeRemainingEl = document.getElementById('time-remaining');
    this.playBtnIcon = document.getElementById('play-btn-icon');
    this.playBtn = document.getElementById('btn-play-pause');
    this.playBtnText = document.getElementById('play-btn-text');

    // Progressive Seek State
    this.seekBubble = document.getElementById('seek-bubble');
    this.seekBubbleText = document.getElementById('seek-bubble-text');
    this.seekBubbleIcon = document.getElementById('seek-bubble-icon');
    this.seekCommitTimer = null;
    this.seekSafetyTimer = null;
    this.seekStreak = 0;
    this.lastSeekTime = 0;
    this.seekDirection = 0;
    this.isSeeking = false;
    this.seekBaseTime = 0;
    this.seekTargetTime = 0;

    this.bindEvents();
  }

  getDuration() {
    if (this.video && isFinite(this.video.duration) && !isNaN(this.video.duration) && this.video.duration > 0) {
      return this.video.duration;
    }
    if (this.currentVideo && isFinite(this.currentVideo.duration) && this.currentVideo.duration > 0) {
      return this.currentVideo.duration;
    }
    return 0;
  }

  seekAccelerated(direction) {
    if (!this.video || (this.currentVideo && this.currentVideo.isLive)) return;

    const dur = this.getDuration();
    if (!dur || dur <= 0) return;

    const now = Date.now();

    // Check if continuing an ongoing seek session within 800ms
    if (this.isSeeking && this.lastSeekTime && (now - this.lastSeekTime < 800)) {
      if (this.seekDirection === direction) {
        // Accelerate streak in same direction
        this.seekStreak = Math.min((this.seekStreak || 1) + 1, 8);
      } else {
        // Direction reversed (e.g. forward then backward):
        // Reset streak to 1 for fine precision, but CONTINUE continuously from seekTargetTime!
        this.seekStreak = 1;
        this.seekDirection = direction;
      }
    } else {
      // Start fresh seek session
      this.isSeeking = true;
      this.seekStreak = 1;
      this.seekDirection = direction;
      this.seekBaseTime = this.video.currentTime || 0;
      this.seekTargetTime = this.seekBaseTime;
    }

    this.lastSeekTime = now;

    // Fast progressive ladder: 10s -> 20s -> 30s -> 60s -> 120s -> 180s
    let step = 10;
    if (this.seekStreak === 2) step = 20;
    else if (this.seekStreak === 3) step = 30;
    else if (this.seekStreak === 4) step = 60;
    else if (this.seekStreak === 5) step = 120;
    else if (this.seekStreak >= 6) step = 180;

    // Compute target continuously from seekTargetTime (zero glitching when reversing direction)
    this.seekTargetTime = Math.max(0, Math.min(dur, this.seekTargetTime + direction * step));
    const targetPct = dur > 0 ? (this.seekTargetTime / dur) * 100 : 0;

    // 1. Visually update seekbar & progress thumb in real time so user clearly sees where they are scrubbing
    const remainingSec = Math.max(0, dur - this.seekTargetTime);
    if (this.progressBar) this.progressBar.style.width = `${targetPct}%`;
    if (this.thumb) this.thumb.style.left = `${targetPct}%`;
    if (this.timeCurrentEl) this.timeCurrentEl.textContent = this.formatTime(this.seekTargetTime);
    if (this.timeTotalEl) this.timeTotalEl.textContent = this.formatTime(dur);
    if (this.timeRemainingEl) this.timeRemainingEl.textContent = dur > 1 ? `(-${this.formatTime(remainingSec)})` : '';

    // 2. Visually reveal seekbar HUD when full OSD is hidden
    if (this.osd && this.osd.classList.contains('hidden')) {
      this.osd.classList.add('seeking');
    }

    // 3. Show sleek central seek bubble with relative delta from seekBaseTime
    if (this.seekBubble) {
      this.seekBubble.style.display = 'flex';
      this.seekBubbleIcon.textContent = direction > 0 ? '⏩' : '⏪';
      const delta = Math.round(this.seekTargetTime - this.seekBaseTime);
      const absDelta = Math.abs(delta);
      const sign = delta > 0 ? `+${this.formatTime(absDelta)}` : (delta < 0 ? `-${this.formatTime(absDelta)}` : '0s');
      this.seekBubbleText.textContent = `${sign} [${this.formatTime(this.seekTargetTime)} / ${this.formatTime(dur)}]`;
    }

    clearTimeout(this.seekCommitTimer);
    this.seekCommitTimer = setTimeout(() => {
      this.commitSeekNow();
    }, 650);
  }

  commitSeekNow() {
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }
    const finalTarget = this.seekTargetTime;
    if (this.video) {
      try {
        this.video.currentTime = finalTarget;
      } catch (e) {
        console.warn('[Player] currentTime set error:', e);
      }
    }
    this.seekStreak = 0;
    this.lastSeekTime = 0;

    if (this.osd) this.osd.classList.remove('seeking');
    if (this.seekBubble) this.seekBubble.style.display = 'none';

    // Keep this.isSeeking true for 350ms to allow decoder to settle
    clearTimeout(this.seekSafetyTimer);
    this.seekSafetyTimer = setTimeout(() => {
      this.isSeeking = false;
    }, 350);
  }

  seekProgressive(step) {
    this.seekAccelerated(step > 0 ? 1 : -1);
  }

  getValidResumeTime(videoId, isLive = false) {
    if (!videoId || isLive || !this.app || typeof this.app.getSavedPosition !== 'function') return 0;
    const saved = Number(this.app.getSavedPosition(videoId)) || 0;
    if (saved <= 15) return 0;
    const dur = this.getDuration();
    if (dur > 0 && saved >= dur - 12) return 0;
    return Math.floor(saved);
  }

  applyResumePosition(targetTime) {
    if (!targetTime || targetTime <= 0 || !this.video) return;
    this.pendingResumeTime = targetTime;
    // In Chromium/webOS MSE, setting currentTime when readyState === 0 can stall or be ignored.
    // Apply immediately when metadata exists (readyState >= 1) or in unit-test mocks (readyState === undefined).
    if (this.video.readyState === undefined || this.video.readyState >= 1) {
      try {
        const dur = this.getDuration();
        if (dur > 0 && targetTime >= dur - 10) {
          this.pendingResumeTime = 0;
          return;
        }
        this.video.currentTime = targetTime;
      } catch (e) {
        console.warn('[Player] Resume currentTime error:', e);
      }
    }
  }

  clearStallWatchdog() {
    if (this.stallWatchdogTimer) {
      clearTimeout(this.stallWatchdogTimer);
      this.stallWatchdogTimer = null;
    }
  }

  scheduleStallWatchdog() {
    this.clearStallWatchdog();
    if (!this.video || this.video.paused || !this.currentVideo || this.currentVideo.isLive) return;
    const sessionId = this.playbackSessionId;
    this.stallWatchdogTimer = setTimeout(() => {
      if (sessionId !== this.playbackSessionId || !this.video || this.video.paused || !this.currentVideo) return;
      this.stallRecoveryAttempts = (this.stallRecoveryAttempts || 0) + 1;
      const resumeAt = Math.floor(this.video.currentTime || this.pendingResumeTime || 0);
      console.warn(`[Player] Stall watchdog triggered (attempt ${this.stallRecoveryAttempts}) at ${resumeAt}s`);

      // If Shaka DASH (AV1/VP9) stalled after seek/resume, fall back cleanly to HLS at the same timestamp
      if (this.shakaPlayer && this.currentVideo.streams && this.currentVideo.streams.hls && window.Hls && Hls.isSupported()) {
        this.app.showToast('Переключение на стабильный HLS поток...');
        this.playHls(this.currentVideo.streams.hls, this.currentVideo.isLive, resumeAt);
        return;
      }

      if (this.hls) {
        if (this.stallRecoveryAttempts <= 2) {
          const targetPos = resumeAt > 0 ? resumeAt + 0.25 : 0;
          try {
            if (targetPos > 0) this.video.currentTime = targetPos;
            this.hls.startLoad(targetPos > 0 ? targetPos : -1);
          } catch (e) {}
          this.scheduleStallWatchdog();
        } else {
          this.recoverExpiredStream(resumeAt);
        }
        return;
      }

      // Direct MP4 fallback recovery
      if (this.stallRecoveryAttempts <= 2) {
        this.recoverExpiredStream(resumeAt);
      }
    }, 7000);
  }

  async recoverExpiredStream(resumeAt = 0) {
    if (!this.currentVideo || !this.app || !this.app.api || typeof this.app.api.getVideoDetails !== 'function') return;
    const sessionId = this.playbackSessionId;
    const targetTime = resumeAt > 0 ? resumeAt : Math.floor(this.video.currentTime || this.pendingResumeTime || 0);
    try {
      this.app.showToast('Обновление видеопотока...');
      const freshDetails = await this.app.api.getVideoDetails(this.currentVideo.id);
      if (sessionId !== this.playbackSessionId || !this.currentVideo) return;
      this.currentVideo = freshDetails;
      const streams = freshDetails.streams || {};
      if (streams.hls && window.Hls && Hls.isSupported()) {
        this.playHls(streams.hls, freshDetails.isLive, targetTime);
      } else {
        const direct = streams.mp4_2160 || streams.mp4_1440 || streams.mp4_1080 || streams.mp4_720 || streams.mp4_480 || streams.mp4_360;
        if (direct) {
          this.playDirect(direct, freshDetails.maxQuality || 'Auto', targetTime);
        }
      }
    } catch (e) {
      console.warn('[Player] Stream refresh failed:', e);
    }
  }

  bindEvents() {
    this.video.addEventListener('waiting', () => {
      this.showBuffering(true);
      this.scheduleStallWatchdog();
    });
    this.video.addEventListener('stalled', () => {
      this.scheduleStallWatchdog();
    });
    this.video.addEventListener('loadedmetadata', () => {
      if (this.pendingResumeTime > 0) {
        const dur = this.getDuration();
        if (dur > 0 && this.pendingResumeTime >= dur - 10) {
          this.pendingResumeTime = 0;
          return;
        }
        if (Math.abs((this.video.currentTime || 0) - this.pendingResumeTime) > 3) {
          try {
            this.video.currentTime = this.pendingResumeTime;
          } catch (e) {}
        }
      }
    });
    this.video.addEventListener('playing', () => {
      this.showBuffering(false);
      this.clearStallWatchdog();
      this.stallRecoveryAttempts = 0;
      if (this.pendingResumeTime > 0 && Math.abs((this.video.currentTime || 0) - this.pendingResumeTime) <= 10) {
        this.pendingResumeTime = 0;
      }
    });
    this.video.addEventListener('canplay', () => {
      this.showBuffering(false);
      this.clearStallWatchdog();
      if (this.pendingResumeTime > 0) {
        const cur = this.video.currentTime || 0;
        if (Math.abs(cur - this.pendingResumeTime) > 4) {
          try {
            this.video.currentTime = this.pendingResumeTime;
            if (this.hls) this.hls.startLoad(this.pendingResumeTime);
          } catch (e) {}
        } else {
          this.pendingResumeTime = 0;
        }
      }
    });
    this.video.addEventListener('pause', () => {
      this.clearStallWatchdog();
    });
    this.video.addEventListener('seeked', () => {
      if (!this.seekCommitTimer) {
        this.isSeeking = false;
      }
      if (this.video && this.video.readyState >= 3) {
        this.showBuffering(false);
        this.clearStallWatchdog();
      }
      if (this.pendingResumeTime > 0 && Math.abs((this.video.currentTime || 0) - this.pendingResumeTime) <= 10) {
        this.pendingResumeTime = 0;
      }
    });
    
    this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.video.addEventListener('ended', () => this.onEnded());
    this.video.addEventListener('error', (e) => this.onError(e));

    // Reset OSD timeout on mouse/pointer movement
    window.addEventListener('mousemove', () => this.wakeOSD());
  }

  /**
   * Play Video Object
   */
  async loadAndPlay(videoData) {
    this.playbackSessionId++;
    this.clearStallWatchdog();
    clearTimeout(this.seekCommitTimer);
    clearTimeout(this.seekSafetyTimer);
    this.seekCommitTimer = null;
    this.seekSafetyTimer = null;
    this.isSeeking = false;
    this.pendingResumeTime = 0;
    this.networkRetryCount = 0;
    this.stallRecoveryAttempts = 0;
    this.dropToastShown = false;
    this.lastProgressTime = 0;

    this.currentVideo = videoData;
    
    // Completely hide #app to eliminate background paint overhead & prevent recommendations shining through
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'none';

    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    if (this.app.nav && this.playBtn) {
      this.app.nav.setFocus(this.playBtn);
    }

    this.container.style.display = 'block';
    this.wakeOSD(4500);

    this.titleEl.textContent = videoData.title;
    const rawAuthor = videoData.author ? String(videoData.author).trim() : '';
    const isNumericAuthor = /^-?\d+$/.test(rawAuthor);
    this.channelEl.textContent = (rawAuthor && !isNumericAuthor) ? rawAuthor : 'VK Видео';
    if (this.timeRemainingEl) this.timeRemainingEl.textContent = '';
    this.qualityBadgeEl.textContent = 'Определение...';
    this.showBuffering(true);

    // Save to local watch history
    this.app.addToHistory(videoData);

    const streams = videoData.streams || {};
    const hlsUrl = streams.hls;
    const direct4K = streams.mp4_2160;
    const direct1440 = streams.mp4_1440;
    const direct1080 = streams.mp4_1080;
    const direct720 = streams.mp4_720;
    const direct480 = streams.mp4_480;
    const direct360 = streams.mp4_360;

    // Start screensaver suppression for LG OLED
    this.startPowerKeepAlive();

    // Priority 1: Hardware-accelerated 4K AV1 / VP9 via Shaka Player (0 dropped frames)
    const av1Url = streams.dash_webm_av1;
    const vp9Url = streams.dash_webm;
    if ((av1Url || vp9Url) && window.shaka && shaka.Player.isBrowserSupported()) {
      this.playShaka(av1Url || vp9Url, 2160);
    } else if (hlsUrl && window.Hls && Hls.isSupported()) {
      this.playHls(hlsUrl, videoData.isLive);
    } else if (direct4K) {
      this.playDirect(direct4K, '4K 2160p');
    } else if (direct1440) {
      this.playDirect(direct1440, '2K 1440p');
    } else if (direct1080) {
      this.playDirect(direct1080, '1080p FHD');
    } else if (direct720) {
      this.playDirect(direct720, '720p HD');
    } else if (direct480) {
      this.playDirect(direct480, '480p SD');
    } else if (direct360) {
      this.playDirect(direct360, '360p SD');
    } else if (hlsUrl) {
      this.playDirect(hlsUrl, 'Auto HLS');
    } else {
      this.app.showToast('Внимание: Видео недоступно или заблокировано правообладателем');
      setTimeout(() => this.close(), 2500);
    }
  }

  cleanupEngines() {
    this.clearStallWatchdog();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.shakaPlayer) {
      this.shakaPlayer.destroy();
      this.shakaPlayer = null;
    }
  }

  async playShaka(manifestUrl, preferredHeight = 2160, resumeOverride = null) {
    this.cleanupEngines();
    const sessionId = this.playbackSessionId;
    const vidId = this.currentVideo ? this.currentVideo.id : null;
    const isLive = Boolean(this.currentVideo && this.currentVideo.isLive);
    const resumeTime = resumeOverride !== null ? resumeOverride : this.getValidResumeTime(vidId, isLive);
    this.pendingResumeTime = resumeTime;

    try {
      this.shakaPlayer = new shaka.Player(this.video);

      // Safe buffer & retry configuration for LG OLED C1 (avoid bufferBehind: 0 which evicts seeked GOPs!)
      this.shakaPlayer.configure({
        streaming: {
          bufferingGoal: 12,
          rebufferingGoal: 2,
          bufferBehind: 15,
          stallEnabled: true,
          stallThreshold: 1.5,
          stallSkip: 0.25,
          retryParameters: {
            timeout: 15000,
            maxAttempts: 4,
            baseDelay: 500,
            backoffFactor: 1.5
          }
        }
      });

      // Handle async Shaka errors occurring after load (e.g. during post-resume segment download)
      this.shakaPlayer.addEventListener('error', (event) => {
        if (sessionId !== this.playbackSessionId) return;
        const err = event && event.detail ? event.detail : event;
        console.warn('[Player] Shaka async error:', err);
        const resumeAt = Math.floor(this.video.currentTime || this.pendingResumeTime || resumeTime || 0);
        if (this.currentVideo && this.currentVideo.streams && this.currentVideo.streams.hls && window.Hls && Hls.isSupported()) {
          this.app.showToast('Переключение на HLS поток...');
          this.playHls(this.currentVideo.streams.hls, isLive, resumeAt);
        }
      });

      // Handle relative BaseURL in VK DASH manifests (?expires=...)
      const manifestUrlObj = new URL(manifestUrl);
      this.shakaPlayer.getNetworkingEngine().registerRequestFilter((type, request) => {
        if (request.uris && request.uris[0] && request.uris[0].startsWith('?')) {
          request.uris[0] = manifestUrlObj.origin + manifestUrlObj.pathname + request.uris[0];
        }
      });

      // Load manifest directly at saved resumeTime so Shaka fetches target segments immediately
      await this.shakaPlayer.load(manifestUrl, resumeTime > 0 ? resumeTime : null);
      if (sessionId !== this.playbackSessionId || !this.shakaPlayer) return;

      // Extract unique resolution tracks for quality modal (deduplicate audio pairings)
      const rawTracks = this.shakaPlayer.getVariantTracks();
      const heightMap = new Map();
      rawTracks.filter(t => t.videoCodec && t.height).forEach(t => {
        if (!heightMap.has(t.height) || (t.bandwidth && t.bandwidth > heightMap.get(t.height).bandwidth)) {
          heightMap.set(t.height, t);
        }
      });

      this.availableLevels = Array.from(heightMap.values()).map(t => ({
        height: t.height,
        width: t.width,
        bitrate: t.bandwidth,
        codec: t.videoCodec,
        shakaTrack: t
      })).sort((a, b) => b.height - a.height);

      // Select target quality (4K AV1 by default) without clearing buffer if already active
      let targetIndex = this.availableLevels.findIndex(t => t.height === preferredHeight);
      if (targetIndex === -1) targetIndex = this.availableLevels.findIndex(t => t.height >= 2160);
      if (targetIndex === -1) targetIndex = 0;

      const targetLvl = this.availableLevels[targetIndex];
      if (targetLvl && targetLvl.shakaTrack) {
        if (!targetLvl.shakaTrack.active) {
          this.shakaPlayer.configure({ abr: { enabled: false } });
          this.shakaPlayer.selectVariantTrack(targetLvl.shakaTrack, true);
        }
        this.currentLevelIndex = targetIndex;
        const label = targetLvl.height >= 2160 ? '4K 2160p (AV1)' : `${targetLvl.height}p (AV1)`;
        this.qualityBadgeEl.textContent = label;
      }

      if (resumeTime > 0) {
        if (Math.abs((this.video.currentTime || 0) - resumeTime) > 3) {
          this.applyResumePosition(resumeTime);
        }
        this.app.showToast(`▶ Продолжение с ${this.formatTime(resumeTime)}`);
      } else {
        this.app.showToast(`⚡ Аппаратный 4K AV1 (без рывков) активен`);
      }

      this.scheduleStallWatchdog();
      await this.video.play();
      if (sessionId !== this.playbackSessionId) return;
      this.isPlaying = true;
      this.updatePlayBtn();
    } catch (err) {
      if (sessionId !== this.playbackSessionId) return;
      console.warn('[Player] Shaka load failed, falling back to HLS:', err);
      if (this.currentVideo && this.currentVideo.streams && this.currentVideo.streams.hls) {
        this.app.showToast('Переключение на HLS поток...');
        this.playHls(this.currentVideo.streams.hls, isLive, resumeTime);
      }
    }
  }

  playDirect(url, qualityLabel, resumeOverride = null) {
    this.cleanupEngines();
    const vidId = this.currentVideo ? this.currentVideo.id : null;
    const isLive = Boolean(this.currentVideo && this.currentVideo.isLive);
    const resumeTime = resumeOverride !== null ? resumeOverride : this.getValidResumeTime(vidId, isLive);

    this.video.src = url;
    this.qualityBadgeEl.textContent = qualityLabel;

    if (resumeTime > 0) {
      this.applyResumePosition(resumeTime);
      this.app.showToast(`▶ Продолжение с ${this.formatTime(resumeTime)}`);
    } else {
      this.pendingResumeTime = 0;
    }

    this.scheduleStallWatchdog();
    this.video.play().then(() => {
      this.isPlaying = true;
      this.updatePlayBtn();
      if (resumeTime <= 0) {
        this.app.showToast(`⚡ Воспроизведение: ${qualityLabel}`);
      }
    }).catch(err => {
      console.warn('[Player] Direct play error:', err);
    });
  }

  playHls(url, isLive = false, resumeOverride = null) {
    this.cleanupEngines();
    const sessionId = this.playbackSessionId;
    const vidId = this.currentVideo ? this.currentVideo.id : null;
    const liveFlag = Boolean(isLive || (this.currentVideo && this.currentVideo.isLive));
    const resumeTime = resumeOverride !== null ? resumeOverride : this.getValidResumeTime(vidId, liveFlag);
    this.pendingResumeTime = resumeTime;
    this.networkRetryCount = 0;

    // Configured for smooth 4K hardware playback and reliable resume on LG webOS 6.x
    this.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: liveFlag,
      backBufferLength: 10,             // Keep 10s back buffer so seeked GOPs aren't evicted mid-decode
      maxBufferLength: 12,              // 12s forward buffer prevents post-resume starvation
      maxMaxBufferLength: 20,
      maxBufferSize: 40 * 1024 * 1024,  // 40MB RAM ceiling for 4K segments without choking
      maxBufferHole: 0.5,               // Skip tiny PTS gaps cleanly on seek/resume
      highBufferWatchdogPeriod: 2,      // Watchdog to prevent stalls
      nudgeMaxRetry: 8,                 // Fast audio/video sync recovery
      nudgeOffset: 0.2,
      startPosition: resumeTime > 0 ? resumeTime : -1,
      fragLoadingTimeOut: 20000,
      manifestLoadingTimeOut: 15000,
      fragLoadingMaxRetry: 6,
      levelLoadingTimeOut: 15000,
      xhrSetup: (xhr, url) => {
        // Prevent CORS preflight failures on VK CDN edge nodes
        xhr.withCredentials = false;
      }
    });

    this.hls.loadSource(url);
    this.hls.attachMedia(this.video);

    this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      if (sessionId !== this.playbackSessionId) return;
      this.availableLevels = data.levels || [];
      console.log(`[Player] HLS Levels found: ${this.availableLevels.length}`);

      // MANDATORY REQUIREMENT: Default to the MAXIMUM resolution available up to 4K
      let highestIndex = -1;
      let maxHeight = 0;

      for (let i = 0; i < this.availableLevels.length; i++) {
        const lvl = this.availableLevels[i];
        if (lvl.height > maxHeight) {
          maxHeight = lvl.height;
          highestIndex = i;
        }
      }

      if (highestIndex !== -1) {
        // Set start level BEFORE playback starts to avoid decode restart stall
        this.hls.startLevel = highestIndex;
        this.hls.currentLevel = highestIndex;
        this.currentLevelIndex = highestIndex;
        const highestLvl = this.availableLevels[highestIndex];
        const label = highestLvl.height >= 2160 ? '4K 2160p' : `${highestLvl.height}p`;
        this.qualityBadgeEl.textContent = label;
      } else {
        this.qualityBadgeEl.textContent = 'Auto HD';
      }

      if (resumeTime > 0) {
        this.applyResumePosition(resumeTime);
        this.app.showToast(`▶ Продолжение с ${this.formatTime(resumeTime)}`);
      } else {
        this.app.showToast(`⚡ Максимальное качество: ${this.qualityBadgeEl.textContent}`);
      }

      this.scheduleStallWatchdog();
      this.video.play().then(() => {
        if (sessionId !== this.playbackSessionId) return;
        this.isPlaying = true;
        this.updatePlayBtn();
      }).catch(e => console.warn('[Player] Play promise error:', e));
    });

    // Auto-select AAC stereo/multichannel track if multiple audio tracks are present
    this.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (event, data) => {
      if (data.audioTracks && data.audioTracks.length > 1) {
        // Find best AAC track
        const aacIdx = data.audioTracks.findIndex(t => !t.codec || t.codec.includes('mp4a'));
        if (aacIdx !== -1) {
          this.hls.audioTrack = aacIdx;
        }
      }
    });

    this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      const lvl = this.availableLevels[data.level];
      if (lvl) {
        const label = lvl.height >= 2160 ? '4K 2160p' : `${lvl.height}p`;
        this.qualityBadgeEl.textContent = label;
      }
    });

    this.hls.on(Hls.Events.ERROR, (event, data) => {
      if (sessionId !== this.playbackSessionId) return;
      console.warn('[Player] Hls Error:', data.type, data.details, 'fatal:', data.fatal);

      // Handle non-fatal buffer stalls that frequently happen after seeking on Chromium 79
      if (!data.fatal) {
        if ((data.details === 'bufferStalledError' || data.details === 'bufferNudgeOnStall') && this.video && !this.video.paused) {
          const now = Date.now();
          if (now - (this.lastStallNudgeAt || 0) > 2500) {
            this.lastStallNudgeAt = now;
            const pos = this.video.currentTime || this.pendingResumeTime || 0;
            const dur = this.getDuration();
            if (!dur || pos + 0.25 < dur) {
              try {
                this.video.currentTime = pos + 0.2;
                if (this.hls) this.hls.startLoad(pos + 0.2);
              } catch (e) {}
            }
          }
        }
        return;
      }

      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          // HTTP 403/410 means VK CDN signed URL expired (e.g. after long pause) -> refresh URLs
          if (data.response && (data.response.code === 403 || data.response.code === 410)) {
            this.recoverExpiredStream(Math.floor(this.video.currentTime || this.pendingResumeTime || 0));
            return;
          }
          this.networkRetryCount = (this.networkRetryCount || 0) + 1;
          if (this.networkRetryCount <= 5) {
            const delay = Math.min(1000 * Math.pow(1.5, this.networkRetryCount), 6000);
            const retryPos = this.video.currentTime || this.pendingResumeTime || -1;
            this.app.showToast(`Восстановление соединения (${this.networkRetryCount}/5)...`);
            setTimeout(() => {
              if (this.hls && sessionId === this.playbackSessionId) {
                this.hls.startLoad(retryPos > 0 ? retryPos : -1);
              }
            }, delay);
          } else {
            this.recoverExpiredStream(Math.floor(this.video.currentTime || this.pendingResumeTime || 0));
          }
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          this.hls.recoverMediaError();
          break;
        default:
          this.hls.destroy();
          this.hls = null;
          this.recoverExpiredStream(Math.floor(this.video.currentTime || this.pendingResumeTime || 0));
          break;
      }
    });
  }

  togglePlay() {
    if (this.video.paused) {
      if (this.video.error) {
        this.recoverExpiredStream(Math.floor(this.video.currentTime || this.pendingResumeTime || 0));
        return;
      }
      // If buffer was evicted during a long pause, kick-start fragment loading on HLS
      if (this.hls && (!this.video.buffered || this.video.buffered.length === 0)) {
        try {
          this.hls.startLoad(this.video.currentTime || -1);
        } catch (e) {}
      }
      this.scheduleStallWatchdog();
      this.video.play().then(() => {
        this.isPlaying = true;
        this.updatePlayBtn();
        this.wakeOSD(3000);
        this.app.showToast('▶ Воспроизведение');
      }).catch(err => {
        console.warn('[Player] play error, trying stream recovery:', err);
        this.recoverExpiredStream(Math.floor(this.video.currentTime || this.pendingResumeTime || 0));
      });
    } else {
      this.clearStallWatchdog();
      this.video.pause();
      this.isPlaying = false;
      this.updatePlayBtn();
      this.wakeOSD(4500); // Display controls cleanly for 4.5s on pause, then auto-fade
      if (this.app.nav && this.playBtn) {
        this.app.nav.setFocus(this.playBtn);
      }
      this.app.showToast('⏸ Пауза');
    }
  }

  wakeOSD(duration = 4500) {
    this.osd.classList.remove('hidden');
    this.osd.classList.remove('seeking');
    this.isSeeking = false;
    clearTimeout(this.osdTimeout);
    if (duration > 0) {
      this.osdTimeout = setTimeout(() => {
        this.osd.classList.add('hidden');
      }, duration);
    }
  }

  hideOSD() {
    clearTimeout(this.osdTimeout);
    this.osd.classList.add('hidden');
    this.osd.classList.remove('seeking');
    this.isSeeking = false;
    if (this.seekBubble) this.seekBubble.style.display = 'none';
  }

  updatePlayBtn() {
    if (this.video.paused) {
      this.playBtnIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
      if (this.playBtnText) this.playBtnText.textContent = 'Воспроизвести';
    } else {
      this.playBtnIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
      if (this.playBtnText) this.playBtnText.textContent = 'Пауза';
    }
  }

  seekBy(seconds) {
    this.seekAccelerated(seconds > 0 ? 1 : -1);
  }

  setSpeed(speed) {
    this.video.playbackRate = speed;
    this.app.showToast(`Скорость: ${speed}x`);
    this.wakeOSD();
  }

  setQuality(levelIndex) {
    this.currentLevelIndex = levelIndex;
    if (this.shakaPlayer) {
      if (levelIndex === -1) {
        this.shakaPlayer.configure({ abr: { enabled: true } });
        this.qualityBadgeEl.textContent = 'Auto';
        this.app.showToast('Качество: Авто');
      } else {
        this.shakaPlayer.configure({ abr: { enabled: false } });
        const lvl = this.availableLevels[levelIndex];
        if (lvl && lvl.shakaTrack) {
          this.shakaPlayer.selectVariantTrack(lvl.shakaTrack, true);
          const is4k = lvl.height >= 2160;
          const label = is4k ? '4K 2160p (AV1)' : `${lvl.height}p`;
          this.qualityBadgeEl.textContent = label;
          this.app.showToast(`Качество: ${label}`);
        }
      }
    } else if (this.hls) {
      this.hls.currentLevel = levelIndex;
      if (levelIndex === -1) {
        this.qualityBadgeEl.textContent = 'Auto';
        this.app.showToast('Качество: Авто');
      } else {
        const lvl = this.availableLevels[levelIndex];
        const label = lvl.height >= 2160 ? '4K 2160p' : `${lvl.height}p`;
        this.qualityBadgeEl.textContent = label;
        this.app.showToast(`Качество: ${label}`);
      }
    }
    this.wakeOSD();
  }

  onTimeUpdate() {
    if (this.isSeeking) return;

    if (this.currentVideo && this.currentVideo.isLive) {
      this.timeCurrentEl.textContent = '🔴 LIVE';
      this.timeTotalEl.textContent = 'В ЭФИРЕ';
      if (this.timeRemainingEl) this.timeRemainingEl.textContent = '';
      this.progressBar.style.width = '100%';
      this.thumb.style.left = '100%';
      return;
    }

    const cur = this.video.currentTime || 0;
    const dur = this.getDuration() || 1;
    const remainingSec = Math.max(0, dur - cur);

    // Progress actually moved -> clear buffering spinner & stall watchdog
    if (Math.abs(cur - (this.lastProgressTime || 0)) > 0.2) {
      this.lastProgressTime = cur;
      this.showBuffering(false);
      this.clearStallWatchdog();
      this.stallRecoveryAttempts = 0;
    }

    const pct = Math.max(0, Math.min(100, (cur / dur) * 100));

    this.progressBar.style.width = `${pct}%`;
    this.thumb.style.left = `${pct}%`;
    this.timeCurrentEl.textContent = this.formatTime(cur);
    this.timeTotalEl.textContent = this.formatTime(dur);
    if (this.timeRemainingEl) {
      this.timeRemainingEl.textContent = dur > 1 ? `(-${this.formatTime(remainingSec)})` : '';
    }

    // Buffer track
    if (this.video.buffered && this.video.buffered.length > 0) {
      const end = this.video.buffered.end(this.video.buffered.length - 1);
      const bufPct = (end / dur) * 100;
      this.bufferedBar.style.width = `${Math.min(100, bufPct)}%`;
    }

    // Monitor dropped frames in 4K
    if (!this.dropToastShown && this.video.webkitDecodedFrameCount > 150) {
      const dropped = this.video.webkitDroppedFrameCount || 0;
      const decoded = this.video.webkitDecodedFrameCount || 1;
      if (dropped / (decoded + dropped) > 0.22) {
        this.dropToastShown = true;
        this.app.showToast('💡 Совет: В меню Качество выберите 2K (1440p) для 60 fps без пропуска кадров');
      }
    }

    // Protect saved resume position from being overwritten by early pre-seek timeupdate frames
    if (this.pendingResumeTime > 0) {
      if (Math.abs(cur - this.pendingResumeTime) <= 10) {
        this.pendingResumeTime = 0;
      } else {
        return;
      }
    }

    // Periodically save watch progress for resume
    if (this.currentVideo && cur > 5 && dur > 10) {
      this.app.saveWatchProgress(this.currentVideo.id, cur, dur);
    }
  }

  showBuffering(show) {
    this.bufferingEl.style.display = show ? 'block' : 'none';
  }

  onEnded() {
    this.clearStallWatchdog();
    this.isPlaying = false;
    this.updatePlayBtn();
    this.wakeOSD();
    this.app.showToast('Видео завершено');
  }

  onError(e) {
    console.error('[Player] Video element error:', e);
    this.showBuffering(false);
    this.clearStallWatchdog();
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * LG OLED Screensaver Keep-Alive
   */
  startPowerKeepAlive() {
    this.stopPowerKeepAlive();
    // Periodically send keep-alive signal to webOS power manager
    this.keepAliveInterval = setInterval(() => {
      if (window.webOS && window.webOS.service) {
        try {
          window.webOS.service.request('luna://com.webos.service.tvpower/power', {
            method: 'powerOffByTimer',
            parameters: { reset: true }
          });
        } catch (e) {}
      }
    }, 30000);
  }

  stopPowerKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  close() {
    this.playbackSessionId++;
    this.stopPowerKeepAlive();
    clearTimeout(this.osdTimeout);
    clearTimeout(this.seekCommitTimer);
    clearTimeout(this.seekSafetyTimer);
    this.seekCommitTimer = null;
    this.seekSafetyTimer = null;
    this.isSeeking = false;
    this.pendingResumeTime = 0;
    this.stallRecoveryAttempts = 0;
    this.cleanupEngines();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.container.style.display = 'none';

    // Restore #app visibility when exiting player
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'flex';

    this.isPlaying = false;
    this.currentVideo = null;
    this.app.focusCurrentSection();
  }
}

if (typeof window !== 'undefined') window.VideoPlayer = VideoPlayer;
if (typeof globalThis !== 'undefined') globalThis.VideoPlayer = VideoPlayer;

