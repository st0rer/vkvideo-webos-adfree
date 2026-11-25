import test from 'node:test';
import assert from 'node:assert/strict';
import { setupMockEnvironment } from './mock_dom.mjs';

setupMockEnvironment();

// Import API
await import('../src/js/api.js');
const VKApi = globalThis.VKApi;

test('VKApi - Initialization & Defaults', () => {
  localStorage.clear();
  const api = new VKApi();
  assert.equal(api.apiVersion, '5.199');
  assert.equal(api.clientId, '512000384397');
  assert.equal(api.apiBase, 'https://proxy.vkvideo.ru/api/method');
  assert.equal(api.isAuthorized(), false);
});

test('VKApi - Token Management & Expiration', async () => {
  localStorage.clear();
  const api = new VKApi();
  
  // Save expired token
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem('vk_anonym_token', 'old_token');
  localStorage.setItem('vk_anonym_expiry', (now - 100).toString());

  // Mock fetchAnonymousToken
  api.fetchAnonymousToken = async () => ({
    token: 'new_refreshed_token',
    expiry: now + 3600
  });

  const token = await api.getValidToken();
  assert.equal(token, 'new_refreshed_token');
  assert.equal(localStorage.getItem('vk_anonym_token'), 'new_refreshed_token');
});

test('VKApi - Duration Formatter', () => {
  const api = new VKApi();
  assert.equal(api.formatDuration(0), '0:00');
  assert.equal(api.formatDuration(5), '0:05');
  assert.equal(api.formatDuration(65), '1:05');
  assert.equal(api.formatDuration(3600), '1:00:00');
  assert.equal(api.formatDuration(3665), '1:01:05');
  assert.equal(api.formatDuration(7325), '2:02:05');
});

test('VKApi - Views Formatter', () => {
  const api = new VKApi();
  assert.equal(api.formatViews(0), '0 просмотров');
  assert.equal(api.formatViews(500), '500');
  assert.equal(api.formatViews(1500), '2 тыс.');
  assert.equal(api.formatViews(25400), '25 тыс.');
  assert.equal(api.formatViews(2450000), '2.5 млн');
  assert.equal(api.formatViews(10000000), '10.0 млн');
});

test('VKApi - Video Stream Extraction & 4K Resolution Detection', async () => {
  const api = new VKApi();

  // Test Case 1: Real 4K Video with HLS and MP4 2160p
  api.callMethod = async (method, params) => {
    return {
      items: [{
        id: 456240001,
        owner_id: -190538964,
        title: 'Большое дорожное путешествие 4K',
        duration: 2040,
        views: 950000,
        height: 2160,
        width: 3840,
        live: 0,
        files: {
          hls_fmp4: 'https://vkvd.okcdn.ru/fmp4_master.m3u8',
          hls_ondemand: 'https://vkvd.okcdn.ru/ts_master.m3u8',
          mp4_2160: 'https://vkvd.okcdn.ru/direct_4k.mp4',
          mp4_1080: 'https://vkvd.okcdn.ru/direct_1080.mp4'
        }
      }]
    };
  };

  const video = await api.getVideoDetails('-190538964_456240001');
  assert.equal(video.id, '-190538964_456240001');
  assert.equal(video.maxQuality, '4K 2160p');
  assert.equal(video.isLive, false);
  // Prefers modern Fragmented MP4 HLS
  assert.equal(video.streams.hls, 'https://vkvd.okcdn.ru/fmp4_master.m3u8');
  assert.equal(video.streams.mp4_2160, 'https://vkvd.okcdn.ru/direct_4k.mp4');
});

test('VKApi - Live Broadcast Detection', async () => {
  const api = new VKApi();

  api.callMethod = async (method, params) => {
    return {
      items: [{
        id: 456249999,
        owner_id: -22822305,
        title: 'VK Live Концерт',
        duration: 0,
        live: 2, // Live active
        files: {
          hls_live_playback: 'https://vkvd.okcdn.ru/live.m3u8'
        }
      }]
    };
  };

  const video = await api.getVideoDetails('-22822305_456249999');
  assert.equal(video.isLive, true);
  assert.equal(video.streams.hls, 'https://vkvd.okcdn.ru/live.m3u8');
});

test('VKApi - Empty streams or deleted video throws clean error', async () => {
  const api = new VKApi();
  api.callMethod = async () => ({ items: [] });

  await assert.rejects(async () => {
    await api.getVideoDetails('-999_999');
  }, /Видео не найдено/);
});

test('VKApi - getUserFeed parses personal feed with author mapping and filters shorts', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');

  api.callMethod = async (method, params) => {
    assert.equal(method, 'newsfeed.get');
    assert.equal(params.filters, 'video');
    return {
      items: [
        {
          type: 'video',
          video: {
            items: [
              {
                id: 101,
                owner_id: -555,
                title: 'Короткий клип #shorts',
                duration: 20
              },
              {
                id: 102,
                owner_id: -555,
                title: 'Полноформатный выпуск 4K',
                duration: 1800,
                views: 50000,
                image: [{ url: 'https://example.com/thumb.jpg' }]
              }
            ]
          }
        },
        {
          type: 'post',
          attachments: [
            {
              type: 'video',
              video: {
                id: 201,
                owner_id: 777,
                title: 'Видео от друга',
                duration: 350,
                views: 500,
                image: [{ url: 'https://example.com/user_thumb.jpg' }]
              }
            }
          ]
        }
      ],
      groups: [
        { id: 555, name: 'НаукаPRO' }
      ],
      profiles: [
        { id: 777, first_name: 'Иван', last_name: 'Иванов' }
      ]
    };
  };

  const feed = await api.getUserFeed(20);
  assert.equal(feed.length, 2);

  // Video 1
  assert.equal(feed[0].id, '-555_102');
  assert.equal(feed[0].author, 'НаукаPRO');
  assert.equal(feed[0].duration, '30:00');
  assert.equal(feed[0].is4K, true);

  // Video 2
  assert.equal(feed[1].id, '777_201');
  assert.equal(feed[1].author, 'Иван Иванов');
  assert.equal(feed[1].duration, '5:50');
});

test('VKApi - isFullLengthVideo strictly filters out short clips and vertical videos', () => {
  const api = new VKApi();

  // 1. Short duration (< 120s)
  assert.equal(api.isFullLengthVideo({ duration: 119, width: 1920, height: 1080 }), false);
  assert.equal(api.isFullLengthVideo({ duration: 59, width: 1920, height: 1080 }), false);

  // 2. Vertical aspect ratio (mobile shorts / reels)
  assert.equal(api.isFullLengthVideo({ duration: 300, width: 720, height: 1280 }), false);
  assert.equal(api.isFullLengthVideo({ duration: 500, width: 1080, height: 1920 }), false);
  assert.equal(api.isFullLengthVideo({ duration: 300, width: 720, height: 720 }), false); // square

  // 3. Clip markers
  assert.equal(api.isFullLengthVideo({ duration: 600, width: 1920, height: 1080, type: 'short_video' }), false);
  assert.equal(api.isFullLengthVideo({ duration: 600, width: 1920, height: 1080, is_clip: 1 }), false);
  assert.equal(api.isFullLengthVideo({ duration: 600, width: 1920, height: 1080, clip_type: 'clip' }), false);

  // 4. Hashtags
  assert.equal(api.isFullLengthVideo({ duration: 600, width: 1920, height: 1080, title: 'Смешной момент #shorts' }), false);
  assert.equal(api.isFullLengthVideo({ duration: 600, width: 1920, height: 1080, title: 'Трендовые #клипы' }), false);
  assert.equal(api.isFullLengthVideo({ duration: 600, width: 1920, height: 1080, title: 'Новый #рилс 2026' }), false);

  // 5. Valid full-length widescreen horizontal video
  assert.equal(api.isFullLengthVideo({ duration: 120, width: 1920, height: 1080, title: 'Лекция по физике 4K' }), true);
  assert.equal(api.isFullLengthVideo({ duration: 3600, width: 3840, height: 2160, title: 'Документальный фильм' }), true);
});

test('VKApi - getUserSubscriptions returns mapped channels', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');

  api.callMethod = async (method, params) => {
    assert.equal(method, 'groups.get');
    return {
      count: 2,
      items: [
        { id: 12345, name: 'Plastic Magic 3D', photo_200: 'https://example.com/pm.jpg', members_count: 54000 },
        { id: 67890, name: 'Кинопоиск', photo_200: 'https://example.com/kp.jpg', members_count: 1200000 }
      ]
    };
  };

  const subs = await api.getUserSubscriptions(10);
  assert.equal(subs.length, 2);
  assert.equal(subs[0].id, -12345);
  assert.equal(subs[0].name, 'Plastic Magic 3D');
  assert.equal(subs[0].avatar, 'https://example.com/pm.jpg');
  assert.equal(subs[1].id, -67890);
  assert.equal(subs[1].name, 'Кинопоиск');
});

test('VKApi - getUserSubscriptionsFeed returns chronological videos strictly from subscribed channels', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');

  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return {
        items: [
          { id: 10, name: 'Канал 10', members_count: 500000, verified: 1 },
          { id: 20, name: 'Канал 20', members_count: 300000, verified: 1 }
        ]
      };
    }
    if (method === 'video.get' && params.owner_id === -10) {
      return {
        items: [
          { id: 101, owner_id: -10, title: 'Выпуск 101', duration: 600, date: 1700000200, width: 1920, height: 1080 }
        ]
      };
    }
    if (method === 'video.get' && params.owner_id === -20) {
      return {
        items: [
          { id: 201, owner_id: -20, title: 'Выпуск 201', duration: 900, date: 1700000500, width: 1920, height: 1080 }
        ]
      };
    }
    return { items: [] };
  };

  const feed = await api.getUserSubscriptionsFeed(10, 240);
  assert.equal(feed.length, 2);
  // Sorted chronologically (newest first: 1700000500 > 1700000200)
  assert.equal(feed[0].id, '-20_201');
  assert.equal(feed[0].author, 'Канал 20');
  assert.equal(feed[1].id, '-10_101');
  assert.equal(feed[1].author, 'Канал 10');
});

test('VKApi - getSmartFeed ranks top channels and interleaves external recommendations', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');

  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return {
        items: [
          { id: 10, name: 'Канал 10' },
          { id: 20, name: 'Канал 20' }
        ]
      };
    }
    if (method === 'video.get' && params.owner_id === -10) {
      return {
        items: [
          { id: 101, owner_id: -10, title: 'Выпуск 1 Канала 10', duration: 500, date: 1700000100, width: 1920, height: 1080 }
        ]
      };
    }
    if (method === 'video.get' && params.owner_id === -20) {
      return {
        items: [
          { id: 201, owner_id: -20, title: 'Выпуск 1 Канала 20', duration: 800, date: 1700000900, width: 1920, height: 1080 }
        ]
      };
    }
    if (method === 'newsfeed.get') {
      return { items: [] };
    }
    return { items: [] };
  };

  api.getTrending = async () => [
    { id: '-999_901', title: 'Похожее внешнее видео', duration: '15:00', views: '100 тыс.', date: 1700000500, is4K: true }
  ];

  const smartFeed = await api.getSmartFeed(10);
  assert.ok(smartFeed.length >= 2);
  // Verify top channel videos are present
  const hasCh10 = smartFeed.some(v => v.id === '-10_101');
  const hasCh20 = smartFeed.some(v => v.id === '-20_201');
  assert.equal(hasCh10, true);
  assert.equal(hasCh20, true);

  // Verify external recommendation has isRecommended flag
  const rec = smartFeed.find(v => v.id === '-999_901');
  assert.ok(rec);
  assert.equal(rec.isRecommended, true);

  // Verify strictly sorted chronologically (newest first: 1700000900 > 1700000500 > 1700000100)
  assert.equal(smartFeed[0].id, '-20_201');
  assert.equal(smartFeed[1].id, '-999_901');
  assert.equal(smartFeed[2].id, '-10_101');
});

test('VKApi - search uses video.search, strictly filters out short videos/clips, and preserves search relevance order', async () => {
  const api = new VKApi();
  api.fetchWebSearch = async () => [];

  api.callMethod = async (method, params) => {
    if (method === 'video.search') {
      return {
        items: [
          // 1. Short clip 45s - should be filtered (< 120s)
          { id: 1, owner_id: -100, title: 'Короткий клип 45с', duration: 45, date: 1700000200, width: 1920, height: 1080 },
          // 2. High relevance show (1st valid match)
          { id: 2, owner_id: -100, title: 'Большое шоу ВКонтакте 4K', duration: 1800, date: 1700000100, width: 1920, height: 1080 },
          // 3. Medium relevance show (2nd valid match)
          { id: 3, owner_id: -100, title: 'Обзор шоу', duration: 600, date: 1700000800, width: 1920, height: 1080 },
          // 4. Relevant interview (3rd valid match)
          { id: 4, owner_id: -100, title: 'Интервью 4K', duration: 240, date: 1700000500, width: 1920, height: 1080 },
          // 5. Vertical mobile reel (9:16) - should be filtered
          { id: 5, owner_id: -100, title: 'Вертикальный шортс', duration: 300, date: 1700000999, width: 720, height: 1280 },
          // 6. Explicit #shorts tag - should be filtered
          { id: 6, owner_id: -100, title: 'Мем #shorts', duration: 400, date: 1700000999, width: 1920, height: 1080 },
          // 7. Very short looping gif (< 30s) - should be filtered
          { id: 7, owner_id: -100, title: 'Гифка 10с', duration: 10, date: 1700000999, width: 1920, height: 1080 }
        ]
      };
    }
    return { items: [] };
  };

  const results = await api.search('новости', 10);
  assert.equal(results.length, 3);

  // Verify short clip (< 120s) was filtered out
  assert.equal(results.some(v => v.id === '-100_1'), false);

  // Verify vertical reel and #shorts were filtered
  assert.equal(results.some(v => v.id === '-100_5'), false);
  assert.equal(results.some(v => v.id === '-100_6'), false);
  assert.equal(results.some(v => v.id === '-100_7'), false);

  // Verify full videos are kept
  assert.ok(results.some(v => v.id === '-100_2'));
  assert.ok(results.some(v => v.id === '-100_3'));
  assert.ok(results.some(v => v.id === '-100_4'));

  // Verify fresh episodes of the matching content are ranked newest first (3 > 4 > 2)
  assert.equal(results[0].id, '-100_3');
  assert.equal(results[1].id, '-100_4');
  assert.equal(results[2].id, '-100_2');
});

test('VKApi - rankSearchResults boosts fresh episodes of matching query while keeping semantic relevance', () => {
  const api = new VKApi();
  const now = Math.floor(Date.now() / 1000);

  const mockList = [
    // Older season of the exact show (1 year ago)
    { id: '1', title: 'Большое шоу 1 сезон', author: 'Азамат Мусагалиев', date: now - 365 * 86400 },
    // Newest season of the exact show (3 days ago)
    { id: '2', title: 'Большое шоу 17 сезон', author: 'Азамат Мусагалиев', date: now - 3 * 86400 },
    // Irrelevant fresh video (1 hour ago) with incidental match
    { id: '3', title: 'Рецепт пирога дома', author: 'Кулинар', date: now - 3600 }
  ];

  const ranked = api.rankSearchResults(mockList, 'Большое шоу');
  assert.equal(ranked.length, 3);
  // Fresh season of the show should be #1 ahead of 1-year-old season
  assert.equal(ranked[0].id, '2');
  assert.equal(ranked[1].id, '1');
  // Completely irrelevant video should remain at the bottom despite being 1 hour old
  assert.equal(ranked[2].id, '3');
});

test('VKApi - search executes multi-source query expansion for prefix words like "Шоу"', async () => {
  const api = new VKApi();
  const queriedTexts = [];

  api.fetchWebSearch = async (qText) => {
    queriedTexts.push(qText);
    if (qText === 'Контакты') {
      // Simulate live web search returning newest official episode that lacked "Шоу" in title
      return [
        [-213802301, 999, 'thumb.jpg', 'Контакты в телефоне Ирины Дубцовой', 16384, '49:58', '', '', 'ШАСТУН', 1793190600, 100000, '', '', '', '', '', '', '', '', 2998]
      ];
    }
    return [];
  };

  api.callMethod = async (method, params) => {
    return { items: [] };
  };

  const results = await api.search('Шоу Контакты', 10);
  assert.ok(queriedTexts.includes('Шоу Контакты'));
  assert.ok(queriedTexts.includes('Контакты'));
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Контакты в телефоне Ирины Дубцовой');
});

test('VKApi - search expands canonical show channel uploads, placing newest episodes at #1 even without show name in title', async () => {
  const api = new VKApi();

  api.fetchWebSearch = async (qText) => {
    // Web search returns older videos from search engine index
    return [
      [-149430811, 101, 'thumb1.jpg', 'Андрей Бебуришвили — свадьба', 16384, '1:45:00', '', '', "<a class='VideoCard__ownerLink'>Шоу ВПИСКА</a><div class='page_verified'></div>", 1720000000, 2000000],
      [-149430811, 102, 'thumb2.jpg', 'Дмитрий Позов — интервью', 16384, '1:30:00', '', '', "<a class='VideoCard__ownerLink'>Шоу ВПИСКА</a><div class='page_verified'></div>", 1730000000, 1000000]
    ];
  };

  api.callMethod = async (method, params) => {
    if (method === 'video.get' && params.owner_id === -149430811) {
      // Channel direct catalog returns the newest release (which doesn't have "вписка" in title)
      return {
        items: [
          { id: 999, owner_id: -149430811, title: 'Андрей Гайдулян – о новом прайме у зумеров', duration: 7200, date: 1780000000, width: 1920, height: 1080 }
        ]
      };
    }
    return { items: [] };
  };

  const results = await api.search('шоу вписка', 10);
  assert.ok(results.length >= 3);
  // Verify that the newest episode from canonical channel is strictly #1!
  assert.equal(results[0].id, '-149430811_999');
  assert.equal(results[0].title, 'Андрей Гайдулян – о новом прайме у зумеров');
  assert.equal(results[0].author, 'Шоу ВПИСКА');
});

test('VKApi - extractRecommendationSeeds extracts clean search phrases from watched titles', () => {
  const api = new VKApi();
  const history = [
    { id: '-211229778_1', title: 'Женский Форум #121 | Денис Дорохов' },
    { id: '-209976560_2', title: 'Стыдно знать | Симонян vs Кольцов' },
    { id: '-39447662_3', title: 'Обзор игрового ноутбука MSI Cyborg 15 Max (C2WG-013XRU)' }
  ];

  const seeds = api.extractRecommendationSeeds(history);
  assert.ok(seeds.length >= 2);
  assert.ok(seeds.some(s => s.toLowerCase().includes('дорохов') || s.toLowerCase().includes('женский форум')));
  assert.ok(seeds.some(s => s.toLowerCase().includes('стыдно знать') || s.toLowerCase().includes('симонян')));
});

test('VKApi - analyzeUserPreferences correctly scores dominant genres from watch history and subscriptions', () => {
  const api = new VKApi();
  const history = [
    { id: '-211229778_1', title: 'Женский Форум #121 | Денис Дорохов', author: 'EasyCom' },
    { id: '-209976560_2', title: 'Стыдно знать | Симонян vs Кольцов', author: 'Medium Quality' },
    { id: '-213802301_3', title: 'Контакты в телефоне', author: 'ШАСТУН' }
  ];
  const subscriptions = [
    { id: 213802301, name: 'ШАСТУН', activity: 'Юмор' },
    { id: 220754053, name: 'VK Видео', activity: 'Развлечения' }
  ];

  const profile = api.analyzeUserPreferences(history, subscriptions);
  assert.ok(profile.length >= 2);
  // Comedy should be top 1 by far due to 3 comedy shows watched + comedy subscriptions
  assert.equal(profile[0].key, 'comedy');
  assert.ok(profile[0].score > profile[1].score);
});

test('VKApi - getSmartRecommendations excludes watched videos and subscribed channels, returning genuine recommendations', async () => {
  const api = new VKApi();
  const userGroupIds = new Set([-213802301]); // user already follows Шастун
  const localHistory = [
    { id: '-213802301_100', title: 'Контакты', author: 'ШАСТУН' }
  ];
  const watchProgress = {
    '-108468_500': { currentTime: 600, duration: 1000, percent: 60 } // already seen
  };

  api.callMethod = async (method, params) => {
    if (method === 'video.search') {
      return {
        items: [
          // Already watched video: should be excluded
          { id: 100, owner_id: -213802301, title: 'Контакты', duration: 1500, width: 1920, height: 1080 },
          // Already seen progress video: should be excluded
          { id: 500, owner_id: -108468, title: 'Кинообзор', duration: 1000, width: 1920, height: 1080 },
          // Fresh recommended comedy video from un-subscribed channel
          { id: 701, owner_id: -209976560, title: 'Свежее комедийное шоу', duration: 1800, width: 1920, height: 1080 }
        ],
        groups: [{ id: 209976560, name: 'Medium Quality' }]
      };
    }
    return { items: [] };
  };

  const recs = await api.getSmartRecommendations(userGroupIds, localHistory, watchProgress, [], 5);
  assert.ok(recs.length >= 1);
  assert.ok(recs.every(r => r.isRecommended === true));
  // Excluded check:
  assert.equal(recs.some(r => r.id === '-213802301_100'), false);
  assert.equal(recs.some(r => r.id === '-108468_500'), false);
  // Valid recommended video check:
  const target = recs.find(r => r.id === '-209976560_701');
  assert.ok(target);
  assert.equal(target.author, 'Medium Quality');
});

test('VKApi - subscribeChannel and unsubscribeChannel dispatch groups.join and groups.leave', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');
  const called = [];

  api.callMethod = async (method, params) => {
    called.push({ method, params });
    if (method === 'groups.isMember') return 1;
    return { response: 1 };
  };

  await api.subscribeChannel(-213802301);
  assert.deepEqual(called[0], { method: 'groups.join', params: { group_id: 213802301 } });

  await api.unsubscribeChannel(-213802301);
  assert.deepEqual(called[1], { method: 'groups.leave', params: { group_id: 213802301 } });

  const isSub = await api.checkIsSubscribed(-213802301);
  assert.equal(isSub, true);
});

test('VKApi - getSmartFeed uses passed scoped history and guarantees profile isolation', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');

  // Channel 10: Comedy; Channel 20: Science/Tech
  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return {
        items: [
          { id: 10, name: 'Юмор Шоу', activity: 'Юмор' },
          { id: 20, name: 'Наука и Космос', activity: 'Наука' }
        ]
      };
    }
    if (method === 'video.get') {
      const ownerId = params.owner_id;
      return {
        items: [
          { id: 101, owner_id: ownerId, title: `Видео 1 из ${ownerId}`, duration: 1200, width: 1920, height: 1080, date: 1700000100 }
        ]
      };
    }
    if (method === 'video.search') {
      return { items: [], groups: [] };
    }
    return { items: [] };
  };

  // User A watched channel 10 heavily
  const userAHistory = [
    { id: '-10_101', title: 'Шоу Контакты выпуск 1', author: 'Юмор Шоу' },
    { id: '-10_102', title: 'Шоу Контакты выпуск 2', author: 'Юмор Шоу' }
  ];
  const feedA = await api.getSmartFeed(10, userAHistory, {});
  assert.ok(feedA.length > 0);

  // User B has a completely empty history (brand new profile)
  const userBHistory = [];
  const feedB = await api.getSmartFeed(10, userBHistory, {});
  assert.ok(feedB.length > 0);

  // Profile A's history seeds must not leak to Profile B
  const seedsA = api.extractRecommendationSeeds(userAHistory);
  const seedsB = api.extractRecommendationSeeds(userBHistory);
  assert.ok(seedsA.length > 0);
  assert.equal(seedsB.length, 0);

  // Profile A's genre affinity must score comedy significantly higher due to watch history
  const prefA = api.analyzeUserPreferences(userAHistory, []);
  const prefB = api.analyzeUserPreferences(userBHistory, []);
  assert.equal(prefA[0].key, 'comedy');
  assert.ok(prefA[0].score > prefB[0].score);
});

test('VKApi - getMoreSmartFeedVideos returns subsequent batches with recommendations and channel uploads', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');

  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return {
        items: [
          { id: 10, name: 'Канал 10' },
          { id: 20, name: 'Канал 20' },
          { id: 30, name: 'Канал 30' }
        ]
      };
    }
    if (method === 'video.get') {
      return {
        items: [
          { id: 301, owner_id: params.owner_id, title: 'Выпуск следующий', duration: 600, width: 1920, height: 1080, date: 1700000000 }
        ]
      };
    }
    if (method === 'video.search') {
      return {
        items: [
          { id: 401, owner_id: -999, title: 'Рекомендованное видео', duration: 700, width: 1920, height: 1080, date: 1700000500 }
        ]
      };
    }
    return { items: [] };
  };

  const more = await api.getMoreSmartFeedVideos(24, 10, [{ id: '-10_1', title: 'Большое шоу' }], {});
  assert.ok(more.length > 0);
  assert.ok(more.some(v => v.id.includes('301') || v.id.includes('401')));
});

test('VKApi - getSmartFeed blends recommendations for guests with watch history', async () => {
  const api = new VKApi();
  // Guest mode (no token set)
  api.getTrending = async () => [
    { id: '-11_101', title: 'Трендовое видео 1', duration: '10:00', views: '500 тыс.', date: 1700000000 }
  ];
  api.callMethod = async (method, params) => {
    if (method === 'video.search') {
      return {
        items: [
          { id: 701, owner_id: -555, title: 'Похожее на историю гостя', duration: 800, width: 1920, height: 1080, date: 1700000200 }
        ]
      };
    }
    return { items: [] };
  };

  const guestHistory = [
    { id: '-209976560_1', title: 'Контакты с Шастуном' }
  ];
  const feed = await api.getSmartFeed(10, guestHistory, {});
  assert.ok(feed.length >= 1);
  assert.ok(feed.some(v => v.id === '-11_101' || v.id === '-555_701'));
});

test('VKApi - getUserSubscriptionsFeed filters out ancient episodes when fresh uploads are available', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');
  const now = Math.floor(Date.now() / 1000);

  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return {
        items: [
          { id: 10, name: 'Канал Активный' },
          { id: 20, name: 'Канал Заброшенный' }
        ]
      };
    }
    if (method === 'video.get' && params.owner_id === -10) {
      // 8 fresh uploads (within last 30 days)
      const freshList = [];
      for (let i = 1; i <= 8; i++) {
        freshList.push({
          id: 100 + i,
          owner_id: -10,
          title: `Свежий выпуск ${i}`,
          duration: 1200,
          date: now - i * 86400,
          width: 1920,
          height: 1080
        });
      }
      return { items: freshList };
    }
    if (method === 'video.get' && params.owner_id === -20) {
      // Ancient upload from 4 years ago
      return {
        items: [
          {
            id: 999,
            owner_id: -20,
            title: 'Очень старый архивный выпуск 2020',
            duration: 1200,
            date: now - 1460 * 86400,
            width: 1920,
            height: 1080
          }
        ]
      };
    }
    return { items: [] };
  };

  const feed = await api.getUserSubscriptionsFeed(10, 240);
  assert.equal(feed.length, 6); // Max 6 per channel diversity
  // All 6 items must be from active channel, ancient video from channel 20 must be completely filtered out
  assert.ok(feed.every(v => v.id.startsWith('-10_')));
  assert.equal(feed.some(v => v.title.includes('2020')), false);
  // Sorted chronologically descending
  assert.ok(feed[0].date > feed[1].date);
});

test('VKApi - getMoreSmartFeedVideos wraps around circular seeds and channels for endless infinite scrolling', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');
  const now = Math.floor(Date.now() / 1000);

  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return {
        items: [
          { id: 1, name: 'Канал 1' },
          { id: 2, name: 'Канал 2' }
        ]
      };
    }
    if (method === 'video.get') {
      const offset = params.offset || 0;
      return {
        items: [
          { id: 1000 + offset, owner_id: params.owner_id, title: `Видео со смещением ${offset}`, duration: 600, width: 1920, height: 1080, date: now - 3600 }
        ]
      };
    }
    if (method === 'video.search') {
      return {
        items: [
          { id: 2000, owner_id: -999, title: `Рекомендация по ${params.q}`, duration: 800, width: 1920, height: 1080, date: now - 7200 }
        ]
      };
    }
    return { items: [] };
  };

  // Test high offset (simulate having scrolled down deep into feed)
  const deepBatch = await api.getMoreSmartFeedVideos(240, 10, [{ id: '-1_1', title: 'Шоу Контакты' }], {});
  assert.ok(deepBatch.length > 0);
  // Verify batch returned valid fresh videos and didn't terminate
  assert.ok(deepBatch.some(v => v.id.includes('1000') || v.id.includes('2000')));
});

test('VKApi - search and recommendations prioritize Ida Galich and premier creator channels', async () => {
  const api = new VKApi();

  // 1. Verify canonical show entity resolution for Ida Galich
  const entity = api.getCanonicalShowEntity('есть вопросики ида галич');
  assert.ok(entity);
  assert.equal(entity.ownerId, -125215074);
  assert.equal(entity.author, 'Ида Галич');

  // 2. Verify premier popular channels registry includes Ida Galich and top shows
  const premier = api.getPremierPopularChannels();
  assert.ok(premier.some(p => p.id === -125215074 && p.name === 'Ида Галич'));
  assert.ok(premier.some(p => p.id === -149430811 && p.name === 'Шоу ВПИСКА'));
  assert.ok(premier.some(p => p.id === -211232966 && p.name === 'Натальная карта'));
  assert.ok(premier.some(p => p.id === -213802301 && p.name === 'ШАСТУН'));

  // 3. Verify getSmartRecommendations places premier channel videos at the top
  api.getChannelVideos = async (ownerId, count, name) => {
    return [
      { id: `${ownerId}_1`, title: `Шоу от ${name}`, author: name, date: 1790000000, duration: '45:00', views: '500 тыс.' }
    ];
  };
  api.callMethod = async () => ({ items: [] });

  const recs = await api.getSmartRecommendations(new Set(), [], {}, [], 10);
  assert.ok(recs.length > 0);
  // Ida Galich must be present in recommendations
  const idaRec = recs.find(r => r.id.startsWith('-125215074_'));
  assert.ok(idaRec, 'Ida Galich show must be present in recommendations');
  assert.equal(idaRec.author, 'Ида Галич');
});

test('VKApi - getHomeCatalog returns structured shelves with Hero and category rails', async () => {
  const api = new VKApi();
  api.setToken('mock_user_token');

  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return {
        items: [
          { id: 10, name: 'Стендап и шоу', activity: 'Юмор', verified: 1, members_count: 500000 },
          { id: 20, name: 'Кино Клуб', activity: 'Фильмы', verified: 1, members_count: 300000 }
        ]
      };
    }
    if (method === 'fave.getPages') {
      return {
        items: [
          { group: { id: 125215074, name: 'Ида Галич', activity: 'Блогер' } }
        ]
      };
    }
    if (method === 'newsfeed.get') {
      return {
        items: [
          {
            video: {
              items: [
                { id: 501, owner_id: -10, title: 'Свежее шоу', duration: 1800, views: 250000, date: 1700001000 }
              ]
            }
          }
        ]
      };
    }
    return { items: [] };
  };

  const now = Math.floor(Date.now() / 1000);
  api.getChannelVideos = async (ownerId, count, name) => [
    { id: `${ownerId}_99`, title: `Новый выпуск ${name}`, author: name, duration: '40:00', views: '300 тыс.', date: now - 3600, is4K: true }
  ];

  const localHistory = [
    { id: '-10_99', title: 'Новый выпуск Стендап', author: 'Стендап', duration: '40:00', views: '300 тыс.' }
  ];
  const watchProgress = {
    '-10_99': { percent: 45, currentTime: 300 }
  };

  const catalog = await api.getHomeCatalog(localHistory, watchProgress);
  console.log('Returned shelf IDs:', catalog.shelves.map(s => s.id));

  assert.ok(catalog.hero, 'Catalog must contain a hero featured video');
  assert.ok(Array.isArray(catalog.shelves), 'Catalog must contain shelves array');
  assert.ok(catalog.shelves.length >= 3, 'Catalog must contain multiple shelves');

  // Check Continue Watching shelf
  const continueShelf = catalog.shelves.find(s => s.id === 'continue');
  assert.ok(continueShelf, 'Must contain continue watching shelf when progress exists');
  assert.equal(continueShelf.items[0].progressPercent, 45);

  // Check Recommendations shelf
  const recShelf = catalog.shelves.find(s => s.id === 'recommendations');
  assert.ok(recShelf, 'Must contain recommendations shelf');

  // Check Popular Shows shelf
  const showsShelf = catalog.shelves.find(s => s.id === 'popular_shows');
  assert.ok(showsShelf, 'Must contain popular shows shelf');

  // Check Subscriptions shelf
  const subsShelf = catalog.shelves.find(s => s.id === 'subscriptions');
  assert.ok(subsShelf, 'Must contain subscriptions shelf');
});

test('VKApi - getServerWatchHistory & getVideoDiscoverRecommendations pull cross-device history and similar videos', async () => {
  const api = new VKApi();
  api.setToken('mock_server_history_token');
  const now = Math.floor(Date.now() / 1000);

  api.callMethod = async (method, params) => {
    if (method === 'catalog.getVideoSmartTV') {
      return {
        catalog: {
          sections: [
            { id: 'sec_search', title: 'Введите запрос' },
            { id: 'sec_main', title: 'Главная', url: 'https://vkvideo.ru' }
          ]
        }
      };
    }
    if (method === 'catalog.getSectionBlocksLinks') {
      return {
        blocks: [
          { block_id: 'blk_all', title: 'Все' },
          { block_id: 'blk_cw', title: 'Продолжить просмотр' }
        ],
        first_block_data: {
          videos: [
            { id: 901, owner_id: -777, title: 'Персональное из Все', duration: 1500, width: 1920, height: 1080, date: now - 500 }
          ],
          groups: [{ id: 777, name: 'Шоу Канал' }]
        }
      };
    }
    if (method === 'catalog.getBlockItems' && params.block_id === 'blk_cw' && !params.start_from) {
      return {
        block: { next_from: 'page2_cursor' },
        videos: [
          { id: 101, owner_id: -158117199, title: 'Подземелья Чикен Карри #55', duration: 7200, viewed_duration: 3600, width: 1920, height: 1080, date: now - 3600 },
          { id: 102, owner_id: -158117199, title: 'Короткий клип', duration: 40, viewed_duration: 10, width: 720, height: 1280, date: now - 3600 }
        ],
        groups: [{ id: 158117199, name: 'Чикен Карри' }]
      };
    }
    if (method === 'catalog.getBlockItems' && params.start_from === 'page2_cursor') {
      return {
        videos: [
          { id: 103, owner_id: -209976560, title: 'Сёрч | выпуск 1', duration: 2400, viewed_duration: 1200, width: 1920, height: 1080, date: now - 7200 }
        ],
        groups: [{ id: 209976560, name: 'LABELCOM' }]
      };
    }
    if (method === 'video.getVideoDiscover') {
      return {
        items: [
          { id: 201, owner_id: -212021856, title: 'Настолка | 8 выпуск | Равдин vs Щетка', duration: 3000, width: 3840, height: 2160, date: now - 1000 }
        ],
        groups: [{ id: 212021856, name: 'КликКлак' }]
      };
    }
    return { items: [] };
  };

  const ctx = await api.getSmartTVServerContext(true, 40);
  assert.equal(ctx.watchHistory.length, 2, 'Should include 2 full-length server watched videos across 2 pages (excluding 40s short)');
  assert.equal(ctx.watchHistory[0].id, '-158117199_101');
  assert.equal(ctx.watchHistory[0].author, 'Чикен Карри');
  assert.equal(ctx.watchHistory[1].id, '-209976560_103');
  assert.equal(ctx.serverProgress['-158117199_101'].currentTime, 3600, 'Should capture cross-device viewed_duration');
  assert.equal(ctx.serverProgress['-158117199_101'].percent, 50);
  assert.equal(ctx.personalFeedVideos[0].id, '-777_901');

  const discoverRecs = await api.getVideoDiscoverRecommendations(ctx.watchHistory, new Set(['-158117199_101']), 8);
  assert.ok(discoverRecs.some(v => v.id === '-212021856_201' && v.isDiscover && v.isRecommended), 'Should return similar recommendations via video.getVideoDiscover');
});

test('VKApi - getSmartFeed surfaces server watch history discover matches even when local TV history is empty', async () => {
  const api = new VKApi();
  api.setToken('mock_smart_discover_token');
  const now = Math.floor(Date.now() / 1000);

  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return { items: [{ id: 10, name: 'Мой Канал' }] };
    }
    if (method === 'video.get') {
      return {
        items: [{ id: 11, owner_id: -10, title: 'Свежий ролик подписки', duration: 900, width: 1920, height: 1080, date: now - 200 }]
      };
    }
    if (method === 'catalog.getVideoSmartTV') {
      return { catalog: { sections: [{ id: 's0', title: 'Поиск' }, { id: 's1', title: 'Главная', url: 'https://vkvideo.ru' }] } };
    }
    if (method === 'catalog.getSectionBlocksLinks') {
      return {
        blocks: [
          { block_id: 'b_all', title: 'Все' },
          { block_id: 'b_cw', title: 'Продолжить просмотр' }
        ],
        first_block_data: { videos: [] }
      };
    }
    if (method === 'catalog.getBlockItems') {
      return {
        videos: [
          { id: 55, owner_id: -158117199, title: 'Подземелья Чикен Карри #55', duration: 7200, viewed_duration: 1800, width: 1920, height: 1080, date: now - 10000 }
        ],
        groups: [{ id: 158117199, name: 'Чикен Карри' }]
      };
    }
    if (method === 'video.getVideoDiscover') {
      return {
        items: [
          { id: 888, owner_id: -228650808, title: 'СВОЯК I Похожее шоу', duration: 3600, width: 1920, height: 1080, date: now - 100 }
        ],
        groups: [{ id: 228650808, name: 'Площадка' }]
      };
    }
    return { items: [] };
  };

  // Empty local TV history!
  const feed = await api.getSmartFeed(30, [], {});
  assert.ok(feed.some(v => v.id === '-228650808_888'), 'Feed must include video.getVideoDiscover recommendations seeded from server watch history');
  assert.equal(api.lastServerProgress['-158117199_55'].currentTime, 1800, 'getSmartFeed must expose cross-device serverProgress');
});

test('VKApi - getSmartFeed eliminates duplicate videos between channel uploads and recommendations (both by ID and by normalized title)', async () => {
  const api = new VKApi();
  api.setToken('mock_dedup_token');
  const now = Math.floor(Date.now() / 1000);

  api.callMethod = async (method, params) => {
    if (method === 'groups.get') {
      return { items: [{ id: 220754053, name: 'VK Видео' }] };
    }
    if (method === 'video.get') {
      return {
        items: [
          // Same exact ID that will also arrive in personalFeed / discover
          { id: 456248219, owner_id: -220754053, title: 'Ужин с Роговым: Легендарные шефы', duration: 2400, width: 1920, height: 1080, date: now - 300 },
          // Same title uploaded under different owner_id
          { id: 101, owner_id: -220754053, title: 'КСТАТИ #121 — Владимир Шахрин!', duration: 3000, width: 1920, height: 1080, date: now - 400 }
        ]
      };
    }
    if (method === 'catalog.getVideoSmartTV') {
      return { catalog: { sections: [{ id: 's0', title: 'Поиск' }, { id: 's1', title: 'Главная', url: 'https://vkvideo.ru' }] } };
    }
    if (method === 'catalog.getSectionBlocksLinks') {
      return {
        blocks: [
          { block_id: 'b_all', title: 'Все' },
          { block_id: 'b_cw', title: 'Продолжить просмотр' }
        ],
        first_block_data: {
          videos: [
            // Exact ID duplicate (would otherwise get isRecommended: true badge)
            { id: 456248219, owner_id: -220754053, title: 'Ужин с Роговым: Легендарные шефы', duration: 2400, width: 1920, height: 1080, date: now - 300 },
            // Different owner_id, normalized title duplicate
            { id: 999, owner_id: -111222, title: 'КСТАТИ #121 – Владимир Шахрин', duration: 3000, width: 1920, height: 1080, date: now - 400 },
            // Truly unique recommendation
            { id: 777, owner_id: -555666, title: 'Уникальная рекомендация шоу', duration: 2000, width: 1920, height: 1080, date: now - 500 }
          ]
        }
      };
    }
    if (method === 'catalog.getBlockItems') {
      return { videos: [] };
    }
    return { items: [] };
  };

  const feed = await api.getSmartFeed(30, [], {});
  const rogovMatches = feed.filter(v => v.id === '-220754053_456248219');
  const kstatiMatches = feed.filter(v => (v.title || '').includes('КСТАТИ #121'));
  assert.equal(rogovMatches.length, 1, 'Same video ID must appear strictly once (not duplicated with recommendation badge)');
  assert.equal(kstatiMatches.length, 1, 'Same normalized video title across channels must appear strictly once');
  assert.ok(feed.some(v => v.id === '-555666_777'), 'Unique recommendation must still be included');
});

test('VKApi - getVideoDetails resolves channel name from groups/profiles instead of leaving author empty', async () => {
  const api = new VKApi();
  api.callMethod = async () => ({
    items: [
      { id: 456248219, owner_id: -220754053, title: 'Тест видео', duration: 600, files: { mp4_1080: 'https://cdn.vk.com/1080.mp4' } }
    ],
    groups: [
      { id: 220754053, name: 'VK Видео' }
    ]
  });
  const details = await api.getVideoDetails('-220754053_456248219');
  assert.equal(details.author, 'VK Видео');
});
