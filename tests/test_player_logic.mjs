import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMockEnvironment, MockElement } from './mock_dom.mjs';

const { root, win, doc, elements } = setupMockEnvironment();

// Mock Hls class
class MockHls {
  static isSupported() { return true; }
  static Events = {
    MANIFEST_PARSED: 'manifestParsed',
    LEVEL_SWITCHED: 'levelSwitched',
    AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
    ERROR: 'error'
  };
  static ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError'
  };

  constructor(cfg) {
    this.cfg = cfg;
    this.handlers = {};
    this.startLevel = -1;
    this.currentLevel = -1;
    this.levels = [];
  }

  loadSource(url) { this.url = url; }
  attachMedia(media) { this.media = media; }
  on(evt, handler) { this.handlers[evt] = handler; }
  trigger(evt, data) { if (this.handlers[evt]) this.handlers[evt](evt, data); }
  destroy() { this.destroyed = true; }
}

globalThis.Hls = MockHls;
win.Hls = MockHls;

// Mock HTMLVideoElement
const videoEl = new MockElement('video', 'native-player');
videoEl.play = async () => {};
videoEl.pause = () => {};
videoEl.currentTime = 0;
videoEl.duration = 1000;
videoEl.paused = false;
elements.set('native-player', videoEl);

// Setup UI elements needed by VideoPlayer
elements.set('player-container', new MockElement('div', 'player-container'));
elements.set('player-osd', new MockElement('div', 'player-osd'));
elements.set('osd-video-title', new MockElement('div', 'osd-video-title'));
elements.set('osd-video-channel', new MockElement('div', 'osd-video-channel'));
elements.set('osd-active-quality', new MockElement('div', 'osd-active-quality'));
elements.set('osd-buffering', new MockElement('div', 'osd-buffering'));
elements.set('progress-played', new MockElement('div', 'progress-played'));
elements.set('progress-buffered', new MockElement('div', 'progress-buffered'));
elements.set('progress-thumb', new MockElement('div', 'progress-thumb'));
elements.set('time-current', new MockElement('div', 'time-current'));
elements.set('time-total', new MockElement('div', 'time-total'));
elements.set('time-remaining', new MockElement('span', 'time-remaining'));
elements.set('play-btn-icon', new MockElement('div', 'play-btn-icon'));
elements.set('seek-bubble', new MockElement('div', 'seek-bubble'));
elements.set('seek-bubble-text', new MockElement('span', 'seek-bubble-text'));
elements.set('seek-bubble-icon', new MockElement('span', 'seek-bubble-icon'));

await import('../src/js/player.js');
const VideoPlayer = globalThis.VideoPlayer;

// Mock App Container
class MockApp {
  constructor() {
    this.history = [];
    this.watchProgress = {};
    this.toasts = [];
  }
  addToHistory(v) { this.history.push(v); }
  showToast(msg) { this.toasts.push(msg); }
  saveWatchProgress(id, cur, dur) {
    this.watchProgress[id] = { currentTime: cur, duration: dur, percent: Math.round((cur/dur)*100) };
  }
  getSavedPosition(id) {
    return this.watchProgress[id]?.currentTime || 0;
  }
  focusCurrentSection() {}
}

test('VideoPlayer - HLS Level Sorting forces 4K 2160p by Default', async () => {
  const app = new MockApp();
  const player = new VideoPlayer(app);

  player.loadAndPlay({
    id: '-100_100',
    title: 'Тест 4K',
    streams: { hls: 'https://cdn.vk.com/test.m3u8' }
  });

  assert.ok(player.hls, 'Hls instance created');

  // Simulate Manifest Parsed with multiple qualities up to 4K
  const mockLevels = [
    { height: 360, width: 640 },
    { height: 720, width: 1280 },
    { height: 1080, width: 1920 },
    { height: 1440, width: 2560 },
    { height: 2160, width: 3840 }  // 4K level at index 4
  ];

  player.hls.trigger('manifestParsed', { levels: mockLevels });

  // Verify that level 4 (2160p 4K) was automatically locked!
  assert.equal(player.hls.startLevel, 4, 'HLS startLevel must be index 4 (4K)');
  assert.equal(player.hls.currentLevel, 4, 'HLS currentLevel must be index 4 (4K)');
  assert.equal(player.qualityBadgeEl.textContent, '4K 2160p', 'Quality badge displays 4K 2160p');
  player.close();
});

test('VideoPlayer - HLS Fallback to 1080p if 4K not present', async () => {
  const app = new MockApp();
  const player = new VideoPlayer(app);

  player.loadAndPlay({
    id: '-200_200',
    title: 'Тест 1080p',
    streams: { hls: 'https://cdn.vk.com/test1080.m3u8' }
  });

  const mockLevels = [
    { height: 360, width: 640 },
    { height: 720, width: 1280 },
    { height: 1080, width: 1920 }  // Highest is 1080p at index 2
  ];

  player.hls.trigger('manifestParsed', { levels: mockLevels });

  assert.equal(player.hls.startLevel, 2, 'Should pick index 2 (1080p)');
  assert.equal(player.qualityBadgeEl.textContent, '1080p');
  player.close();
});

test('VideoPlayer - Progressive Seek Accumulator', async () => {
  const app = new MockApp();
  const player = new VideoPlayer(app);
  player.video.duration = 1000;
  player.video.currentTime = 100;

  // Rapidly press right 3 times (+10, +20, +30)
  player.seekProgressive(10);
  player.seekProgressive(10);
  player.seekProgressive(10);

  assert.equal(player.isSeeking, true, 'isSeeking should be true during active seek');
  assert.equal(player.seekTargetTime, 160, 'Target seek time should accelerate to 160s');
  assert.equal(player.seekBubble.style.display, 'flex');

  // Wait for 650ms commit timer + 350ms settle
  await new Promise(r => setTimeout(r, 750));
  assert.equal(player.video.currentTime, 160, 'Video currentTime should be committed to 160s');
  player.close();
});

test('VideoPlayer - Saved Watch Position Resume', async () => {
  const app = new MockApp();
  // Simulate saved position of 450 seconds (7.5 mins)
  app.saveWatchProgress('-300_300', 450, 1000);

  const player = new VideoPlayer(app);
  player.loadAndPlay({
    id: '-300_300',
    title: 'Фильм с продолжением',
    streams: { hls: 'https://cdn.vk.com/resume.m3u8' }
  });

  player.hls.trigger('manifestParsed', { levels: [{ height: 2160 }] });

  assert.equal(player.video.currentTime, 450, 'Video currentTime should be restored to 450s');
  assert.ok(app.toasts.some(t => t.includes('Продолжение с 7:30')));
  player.close();
});

test('VideoPlayer - Live Stream Mode disables seek and shows LIVE badge', async () => {
  const app = new MockApp();
  const player = new VideoPlayer(app);

  player.loadAndPlay({
    id: '-400_400',
    title: 'Прямой эфир',
    isLive: true,
    streams: { hls: 'https://cdn.vk.com/live.m3u8' }
  });

  // Call onTimeUpdate
  player.onTimeUpdate();
  assert.equal(player.timeCurrentEl.textContent, '🔴 LIVE');
  assert.equal(player.timeTotalEl.textContent, 'В ЭФИРЕ');

  // Seek should be blocked during Live
  player.video.currentTime = 50;
  player.seekProgressive(10);
  assert.equal(player.isSeeking, false, 'Seek must be blocked on Live streams');
  player.close();
});

test('VideoPlayer - HLS Resume configures native startPosition and preserves progress before seek lands', async () => {
  const app = new MockApp();
  app.saveWatchProgress('-500_500', 620, 1200);

  const player = new VideoPlayer(app);
  player.loadAndPlay({
    id: '-500_500',
    title: 'Длинное видео',
    streams: { hls: 'https://cdn.vk.com/long.m3u8' }
  });

  // Verify Hls config received startPosition and non-zero backBufferLength
  assert.equal(player.hls.cfg.startPosition, 620, 'HLS startPosition must match saved position');
  assert.ok(player.hls.cfg.backBufferLength >= 10, 'backBufferLength must be >= 10 to prevent post-seek GOP eviction');

  // Simulate early pre-seek timeupdate before seek lands (readyState 0 -> cur=4s)
  player.video.readyState = 0;
  player.video.currentTime = 4;
  player.hls.trigger('manifestParsed', { levels: [{ height: 2160 }] });
  player.onTimeUpdate();
  assert.equal(app.getSavedPosition('-500_500'), 620, 'Saved position must NOT be overwritten by early pre-seek timeupdate');

  // Simulate metadata loaded -> position applied
  player.video.readyState = 1;
  player.video.dispatchEvent({ type: 'loadedmetadata' });
  assert.equal(player.video.currentTime, 620, 'loadedmetadata must apply pendingResumeTime');

  player.video.readyState = 3;
  player.video.dispatchEvent({ type: 'playing' });
  assert.equal(player.pendingResumeTime, 0, 'pendingResumeTime clears once playing near target');

  player.close();
});

test('VideoPlayer - Shaka passes startTime to load and falls back cleanly to HLS preserving resumeTime', async () => {
  const app = new MockApp();
  app.saveWatchProgress('-600_600', 310, 900);

  let loadedUrl = null;
  let loadedStartTime = null;
  let shakaConfig = null;
  const shakaHandlers = {};

  class MockShakaPlayer {
    static isBrowserSupported() { return true; }
    constructor(video) { this.video = video; }
    configure(cfg) { shakaConfig = Object.assign(shakaConfig || {}, cfg); }
    getNetworkingEngine() { return { registerRequestFilter() {} }; }
    addEventListener(evt, fn) { shakaHandlers[evt] = fn; }
    async load(url, startTime) {
      loadedUrl = url;
      loadedStartTime = startTime;
    }
    getVariantTracks() {
      return [{ height: 2160, width: 3840, bandwidth: 8000000, videoCodec: 'av01', active: true }];
    }
    selectVariantTrack() {}
    destroy() {}
  }

  globalThis.shaka = { Player: MockShakaPlayer };
  win.shaka = globalThis.shaka;

  const player = new VideoPlayer(app);
  player.video.readyState = 4;
  player.video.currentTime = 310;

  await player.loadAndPlay({
    id: '-600_600',
    title: 'AV1 Видео с продолжением',
    streams: {
      dash_webm_av1: 'https://cdn.vk.com/av1.mpd',
      hls: 'https://cdn.vk.com/fallback.m3u8'
    }
  });
  await new Promise(r => setTimeout(r, 20));

  assert.equal(loadedUrl, 'https://cdn.vk.com/av1.mpd');
  assert.equal(loadedStartTime, 310, 'Shaka load() must receive startTime directly');
  assert.ok(shakaConfig.streaming.bufferBehind >= 10, 'Shaka bufferBehind must not be 0');

  // Trigger async Shaka error -> should fall back to HLS at current position (310s)
  shakaHandlers.error({ detail: { code: 3016, severity: 2 } });
  assert.ok(player.hls, 'Should fall back to HLS on async Shaka error');
  assert.equal(player.hls.cfg.startPosition, 310, 'Fallback HLS must preserve resume position 310s');

  player.close();
  delete globalThis.shaka;
  delete win.shaka;
});

test('VideoPlayer - Non-fatal bufferStalledError nudges playback forward', async () => {
  const app = new MockApp();
  const player = new VideoPlayer(app);
  let startLoadPos = null;

  player.loadAndPlay({
    id: '-700_700',
    title: 'Тест залипания буфера',
    streams: { hls: 'https://cdn.vk.com/stall.m3u8' }
  });
  player.hls.startLoad = (pos) => { startLoadPos = pos; };
  player.video.paused = false;
  player.video.currentTime = 120;
  player.video.duration = 500;

  player.hls.trigger('error', { fatal: false, type: 'mediaError', details: 'bufferStalledError' });
  assert.ok(player.video.currentTime > 120, 'Non-fatal stall must nudge currentTime forward');
  assert.ok(startLoadPos > 120, 'Non-fatal stall must re-kick HLS startLoad');

  player.close();
});

test('VideoPlayer - Displays remaining watch time and never leaks numeric ownerId in top-left corner', async () => {
  const app = new MockApp();
  const player = new VideoPlayer(app);

  player.loadAndPlay({
    id: '-220754053_456248219',
    title: 'Ужин с Роговым',
    ownerId: -220754053,
    streams: { hls: 'https://cdn.vk.com/test.m3u8' }
  });

  // Top-left channel element must fall back cleanly instead of showing "-220754053"
  assert.equal(player.channelEl.textContent, 'VK Видео', 'Must not display raw numeric ownerId in top-left corner');

  // Time update calculates remaining time accurately
  player.video.duration = 1000;
  player.video.currentTime = 400;
  player.onTimeUpdate();
  assert.equal(player.timeCurrentEl.textContent, '6:40');
  assert.equal(player.timeTotalEl.textContent, '16:40');
  assert.equal(player.timeRemainingEl.textContent, '(-10:00)');

  // Seeking updates remaining time live
  player.seekProgressive(10); // +10s -> 410s -> remaining 590s = 9:50
  assert.equal(player.timeRemainingEl.textContent, '(-9:50)');

  player.close();
});

test('VideoPlayer - wakeOSD and mousemove do not cancel active seek streak or snap progress bar back', async () => {
  const app = new MockApp();
  const player = new VideoPlayer(app);
  let startLoadTarget = null;

  try {
    player.loadAndPlay({
      id: '-800_800',
      title: 'Тест плавной перемотки',
      streams: { hls: 'https://cdn.vk.com/seek.m3u8' }
    });
    player.hls.startLoad = (pos) => { startLoadTarget = pos; };
    player.video.duration = 1200;
    player.video.currentTime = 100;
    player.pendingResumeTime = 100;

    // Trigger progressive seek twice with wakeOSD & mousemove firing between presses
    player.seekAccelerated(1); // +10s -> 110s
    player.wakeOSD(4500);
    win.dispatchEvent({ type: 'mousemove' });
    assert.equal(player.isSeeking, true, 'wakeOSD and mousemove must NOT clear isSeeking during seek session');

    player.seekAccelerated(1); // streak=2 (+20s) -> 130s
    assert.equal(player.seekTargetTime, 130, 'Seek streak must accumulate continuously without resetting to 100');

    // timeupdate while seeking must not snap UI preview back to 100s
    player.onTimeUpdate();
    assert.equal(player.timeCurrentEl.textContent, '2:10', 'timeupdate must not overwrite preview time while seeking');

    // Commit seek immediately (like pressing OK on OSD)
    player.commitSeekNow();
    assert.equal(player.video.currentTime, 130);
    assert.equal(player.pendingResumeTime, 0, 'Intentional seek commit must clear pendingResumeTime');
    assert.equal(startLoadTarget, 130, 'Unbuffered commit must trigger hls.startLoad at target position');
    assert.equal(player.isSeeking, true, 'isSeeking holds briefly until decoder fires seeked');

    // Browser emits seeked -> clears isSeeking
    player.video.dispatchEvent({ type: 'seeked' });
    assert.equal(player.isSeeking, false, 'seeked event clears isSeeking cleanly');

    // Direct seekTo clamps cleanly near end of stream
    player.seekTo(1250);
    assert.equal(player.video.currentTime, 1199.5, 'seekTo must clamp safely before EOF');
  } finally {
    player.close();
  }
});

test('VideoPlayer - Throttles timeupdate storage writes and flushes progress cleanly on close', async () => {
  let saveCalls = 0;
  let lastSavedArgs = null;
  let refreshedVideoId = null;

  const app = new MockApp();
  app.saveWatchProgress = (id, cur, dur) => {
    saveCalls++;
    lastSavedArgs = { id, cur, dur };
  };
  app.refreshCardProgress = (id) => { refreshedVideoId = id; };

  const player = new VideoPlayer(app);
  try {
    player.loadAndPlay({
      id: '-900_900',
      title: 'Тест сохранения прогресса',
      streams: { hls: 'https://cdn.vk.com/prog.m3u8' }
    });
    player.video.duration = 1000;
    player.video.playbackRate = 1.5;

    // Repeated timeupdate ticks within 5s should throttle to 1 write
    player.video.currentTime = 120;
    player.onTimeUpdate();
    player.video.currentTime = 121;
    player.onTimeUpdate();
    player.video.currentTime = 122;
    player.onTimeUpdate();
    assert.equal(saveCalls, 1, 'Repeated timeupdate ticks within 5s must throttle saveWatchProgress writes');

    // Closing player flushes latest progress, resets playbackRate, and updates card UI
    player.close();
    assert.equal(saveCalls, 2, 'Closing player must flush latest watch progress');
    assert.equal(lastSavedArgs.cur, 122);
    assert.equal(refreshedVideoId, '-900_900', 'Closing player must refresh card progress bar');
    assert.equal(player.video.playbackRate, 1.0, 'Closing player must reset playbackRate to 1.0');
  } finally {
    player.close();
  }
});
