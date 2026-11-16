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
