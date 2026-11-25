/**
 * VK Video AdFree 4K - TV Spatial Navigation
 * Fully compatible with LG Magic Remote (Cursor + D-Pad)
 */

class SpatialNavigation {
  constructor(app) {
    this.app = app;
    this.currentFocused = null;
    this.sidebar = document.getElementById('sidebar');
    this.okKeyDownTimer = null;
    this.okKeyDownTarget = null;
    this.isOkLongPressed = false;
    this.blockModalClickUntil = 0;
    this.shelfFocusMemory = {};
    this.init();
  }

  init() {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    window.addEventListener('keyup', (e) => this.handleKeyUp(e));

    // Handle Magic Remote air mouse pointer interactions
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('.focusable');
      if (!target || target === this.currentFocused) return;
      if (this.app.isModalOpen && this.app.isModalOpen()) {
        const activeModal = Array.from(document.querySelectorAll('.modal-overlay')).find(m => m.style.display === 'flex');
        if (activeModal && !activeModal.contains(target)) return;
      } else if (this.app.player && this.app.player.container.style.display !== 'none') {
        if (!this.app.player.container.contains(target)) return;
      }
      this.setFocus(target, false);
    });

    document.addEventListener('click', (e) => {
      const target = e.target.closest('.focusable');
      if (!target) return;
      if (this.app.isModalOpen && this.app.isModalOpen()) {
        const activeModal = Array.from(document.querySelectorAll('.modal-overlay')).find(m => m.style.display === 'flex');
        if (activeModal && !activeModal.contains(target)) return;
      }
      this.setFocus(target, false);
    });

    // Expand sidebar on hover / pointer
    this.sidebar.addEventListener('mouseenter', () => {
      this.sidebar.classList.add('expanded');
    });
    this.sidebar.addEventListener('mouseleave', () => {
      if (!this.currentFocused || !this.currentFocused.closest('#sidebar')) {
        this.sidebar.classList.remove('expanded');
      }
    });

    // Handle LG Magic Remote Wheel scroll
    window.addEventListener('wheel', (e) => {
      if (this.app.player && this.app.player.container.style.display !== 'none') {
        if (e.deltaY < 0) this.app.player.seekProgressive(10);
        else if (e.deltaY > 0) this.app.player.seekProgressive(-10);
        return;
      }
      const showcase = document.getElementById('home-showcase-container');
      if (showcase) {
        showcase.scrollBy({ top: e.deltaY * 1.6, behavior: 'auto' });
        if (this.app && typeof this.app.onShowcaseScrolled === 'function') {
          this.app.onShowcaseScrolled(showcase);
        }
        return;
      }
      const grid = document.querySelector('.video-grid') || document.getElementById('search-results-grid');
      if (grid) {
        grid.scrollBy({ top: e.deltaY * 1.6, behavior: 'auto' });
        if (this.app && typeof this.app.onGridScrolled === 'function') {
          this.app.onGridScrolled(grid);
        }
      }
    }, { passive: true });
  }

  handleKeyDown(e) {
    const key = e.keyCode || e.which;

    // Media Keys
    if (key === 415) { // Play
      if (this.app.player.container.style.display !== 'none') {
        if (this.app.player.video.paused) this.app.player.togglePlay();
      }
      e.preventDefault();
      return;
    }
    if (key === 19) { // Pause
      if (this.app.player.container.style.display !== 'none') {
        if (!this.app.player.video.paused) this.app.player.togglePlay();
      }
      e.preventDefault();
      return;
    }
    if (key === 413) { // Stop
      if (this.app.player.container.style.display !== 'none') {
        this.app.player.close();
      }
      e.preventDefault();
      return;
    }
    if (key === 417) { // Fast Forward
      if (this.app.player.container.style.display !== 'none') {
        this.app.player.seekProgressive(30);
      }
      e.preventDefault();
      return;
    }
    if (key === 412) { // Rewind
      if (this.app.player.container.style.display !== 'none') {
        this.app.player.seekProgressive(-30);
      }
      e.preventDefault();
      return;
    }

    // Back Key Handling (LG Magic Remote Back)
    if (key === 461 || key === 27) {
      this.app.handleBack();
      e.preventDefault();
      return;
    }

    // Modal Active: Trap focus inside modal & handle OK selection
    if (this.app.isModalOpen()) {
      if (key === 13) {
        // Debounce / gate: ignore key repeats, hold events, and presses immediately following opening
        if (this.isOkLongPressed || e.repeat || (this.blockModalClickUntil && Date.now() < this.blockModalClickUntil)) {
          e.preventDefault();
          return;
        }
        if (this.currentFocused) {
          this.currentFocused.click();
        }
      } else if ([37, 38, 39, 40].includes(key)) {
        const activeModal = Array.from(document.querySelectorAll('.modal-overlay')).find(m => m.style.display === 'flex');
        const selector = activeModal ? '#' + activeModal.id + ' .focusable' : '.modal-card .focusable';
        this.handleDirectionalNavigation(key, selector);
      }
      e.preventDefault();
      return;
    }

    // Player Active: OSD navigation, intuitive play/pause, and remote controls
    if (this.app.player.container.style.display !== 'none') {
      const player = this.app.player;
      const osdHidden = player.osd.classList.contains('hidden');

      // Guarantee focus is confined to player controls
      if (this.currentFocused && !player.container.contains(this.currentFocused)) {
        this.setFocus(player.playBtn);
      }

      // 1. Center OK Button (Enter / Magic Remote Wheel Click)
      if (key === 13) {
        if (player.isSeeking && player.seekCommitTimer) {
          player.commitSeekNow();
          e.preventDefault();
          return;
        }
        if (player.video.paused) {
          // If video is paused, pressing OK resumes immediately!
          // Exception: if user intentionally navigated to Quality, Speed, or Close
          if (this.currentFocused && ['btn-quality', 'btn-speed', 'btn-close-player'].includes(this.currentFocused.id)) {
            this.currentFocused.click();
          } else {
            player.togglePlay();
          }
        } else {
          // Video is currently playing
          if (osdHidden) {
            // Wakes OSD and immediately pauses
            player.togglePlay();
          } else {
            // OSD is visible
            if (this.currentFocused && ['btn-quality', 'btn-speed', 'btn-close-player', 'btn-rewind', 'btn-forward'].includes(this.currentFocused.id)) {
              this.currentFocused.click();
            } else {
              // On play/pause button, progress-track, or background: toggle play/pause
              player.togglePlay();
            }
          }
        }
        e.preventDefault();
        return;
      }

      // 2. Left (37) and Right (39)
      if (key === 37 || key === 39) {
        const dir = key === 39 ? 1 : -1;
        if (osdHidden || player.isSeeking) {
          // Seeking mode: accelerated seek WITHOUT waking the heavy OSD menu!
          player.seekAccelerated(dir);
        } else {
          // OSD visible:
          if (this.currentFocused && this.currentFocused.id === 'progress-track') {
            player.seekAccelerated(dir);
          } else {
            // Navigate between control buttons
            const buttons = [
              document.getElementById('btn-play-pause'),
              document.getElementById('btn-rewind'),
              document.getElementById('btn-forward'),
              document.getElementById('btn-quality'),
              document.getElementById('btn-speed'),
              document.getElementById('btn-close-player')
            ].filter(Boolean);

            let curIdx = buttons.indexOf(this.currentFocused);
            if (curIdx === -1) {
              this.setFocus(buttons[0]);
            } else {
              if (key === 37) { // Left
                curIdx = Math.max(0, curIdx - 1);
              } else { // Right
                curIdx = Math.min(buttons.length - 1, curIdx + 1);
              }
              this.setFocus(buttons[curIdx]);
            }
            player.wakeOSD(4500);
          }
        }
        e.preventDefault();
        return;
      }

      // 3. Up (38)
      if (key === 38) {
        if (osdHidden) {
          player.wakeOSD(4500);
          this.setFocus(document.getElementById('btn-play-pause'));
        } else {
          const progressTrack = document.getElementById('progress-track');
          if (progressTrack && this.currentFocused !== progressTrack) {
            this.setFocus(progressTrack);
          }
          player.wakeOSD(4500);
        }
        e.preventDefault();
        return;
      }

      // 4. Down (40)
      if (key === 40) {
        if (!osdHidden) {
          if (this.currentFocused && this.currentFocused.id === 'progress-track') {
            // Move down from progress bar to play button
            const playBtn = document.getElementById('btn-play-pause');
            if (playBtn) this.setFocus(playBtn);
            player.wakeOSD(4500);
          } else {
            // Down while on buttons dismisses OSD immediately for clean viewing
            player.hideOSD();
          }
        }
        e.preventDefault();
        return;
      }
      return;
    }

    // Red button shortcut: dedicated automated voice search activation
    if (key === 403) {
      if (typeof this.app.triggerVoiceSearchMacro === 'function') {
        this.app.triggerVoiceSearchMacro();
      } else {
        this.app.searchQuery = '';
        this.app.loadSection('search');
      }
      e.preventDefault();
      return;
    }

    // Main App Navigation
    if ([37, 38, 39, 40].includes(key)) {
      if (this.okKeyDownTimer) {
        clearTimeout(this.okKeyDownTimer);
        this.okKeyDownTimer = null;
        this.isOkLongPressed = false;
      }
      this.handleDirectionalNavigation(key, '#app .focusable');
      e.preventDefault();
    } else if (key === 13) {
      this.okKeyDownTarget = this.currentFocused;
      if (this.currentFocused && this.currentFocused.classList.contains('video-card')) {
        // If timer is not yet running and long-press has not triggered, start long-press detection
        if (!this.okKeyDownTimer && !this.isOkLongPressed) {
          const cardEl = this.currentFocused;
          this.okKeyDownTimer = setTimeout(() => {
            this.isOkLongPressed = true;
            this.okKeyDownTimer = null;
            this.blockModalClickUntil = Date.now() + 500;
            const videoId = cardEl.dataset.id;
            if (videoId && this.app.videoMap && this.app.videoMap[videoId]) {
              this.app.openVideoContextMenu(this.app.videoMap[videoId]);
            }
          }, 500);
        }
        e.preventDefault();
        return;
      }
      if (this.currentFocused) {
        this.currentFocused.click();
      }
      e.preventDefault();
    }
  }

  handleKeyUp(e) {
    const key = e.keyCode || e.which;
    if (key === 13) {
      const downTarget = this.okKeyDownTarget;
      this.okKeyDownTarget = null;

      if (this.okKeyDownTimer) {
        clearTimeout(this.okKeyDownTimer);
        this.okKeyDownTimer = null;
      }
      if (this.isOkLongPressed) {
        this.isOkLongPressed = false;
        // Extend click cooldown for 400ms after user releases the physical OK button
        this.blockModalClickUntil = Date.now() + 400;
        e.preventDefault();
        return;
      }
      // If user was navigating sections, do not click newly focused cards on keyup
      if (this.app.isNavigatingSection) {
        e.preventDefault();
        return;
      }
      // Only click video card if OK keydown was initiated on this exact same card
      if (!this.app.isModalOpen() && downTarget && downTarget === this.currentFocused && this.currentFocused.classList.contains('video-card')) {
        this.currentFocused.click();
        e.preventDefault();
      }
    }
  }

  handleDirectionalNavigation(key, selector) {
    // 1. Specialized 10-Foot UI Navigation for Horizontal Shelves and Hero Showcase
    if (this.currentFocused) {
      // Case A: Focused on Hero Play Button
      if (this.currentFocused.id === 'hero-btn-play') {
        if (key === 37) { // Left -> Move to sidebar
          const navItem = document.querySelector('#sidebar .nav-item.active') || document.querySelector('#sidebar .nav-item');
          if (navItem) { this.setFocus(navItem); return; }
        } else if (key === 40) { // Down -> Move to first shelf
          const firstShelf = document.querySelector('.shelf-container');
          if (firstShelf) {
            const shelfId = firstShelf.dataset.shelfId;
            const remembered = this.shelfFocusMemory[shelfId];
            if (remembered && remembered.offsetParent !== null) {
              this.setFocus(remembered);
              return;
            }
            const firstCard = firstShelf.querySelector('.shelf-row .video-card.focusable');
            if (firstCard) {
              this.setFocus(firstCard);
              return;
            }
          }
        }
        return; // Up or Right on hero button: keep focus
      }

      // Case B: Focused inside a Shelf Row
      const shelfRow = this.currentFocused.closest('.shelf-row');
      if (shelfRow) {
        const currentShelf = this.currentFocused.closest('.shelf-container');
        if (key === 39) { // Right -> Next card in row
          const next = this.currentFocused.nextElementSibling;
          if (next && next.classList.contains('focusable')) {
            this.setFocus(next);
            return;
          }
          return;
        } else if (key === 37) { // Left -> Prev card in row, or sidebar if at row start
          const prev = this.currentFocused.previousElementSibling;
          if (prev && prev.classList.contains('focusable')) {
            this.setFocus(prev);
            return;
          }
          const navItem = document.querySelector('#sidebar .nav-item.active') || document.querySelector('#sidebar .nav-item');
          if (navItem) {
            this.setFocus(navItem);
            return;
          }
        } else if (key === 40) { // Down -> Next shelf below
          if (currentShelf) {
            const nextShelf = currentShelf.nextElementSibling;
            if (nextShelf && nextShelf.classList.contains('shelf-container')) {
              const nextShelfId = nextShelf.dataset.shelfId;
              const remembered = this.shelfFocusMemory[nextShelfId];
              if (remembered && remembered.offsetParent !== null) {
                this.setFocus(remembered);
                return;
              }
              const cards = Array.from(nextShelf.querySelectorAll('.shelf-row .video-card.focusable'));
              if (cards.length > 0) {
                const curRect = this.currentFocused.getBoundingClientRect();
                const curCenter = curRect.left + curRect.width / 2;
                let closestCard = cards[0];
                let minDiff = Infinity;
                for (const c of cards) {
                  const r = c.getBoundingClientRect();
                  const diff = Math.abs((r.left + r.width / 2) - curCenter);
                  if (diff < minDiff) {
                    minDiff = diff;
                    closestCard = c;
                  }
                }
                this.setFocus(closestCard);
                return;
              }
            }
          }
        } else if (key === 38) { // Up -> Prev shelf above or Hero
          if (currentShelf) {
            const prevShelf = currentShelf.previousElementSibling;
            if (prevShelf && prevShelf.classList.contains('shelf-container')) {
              const prevShelfId = prevShelf.dataset.shelfId;
              const remembered = this.shelfFocusMemory[prevShelfId];
              if (remembered && remembered.offsetParent !== null) {
                this.setFocus(remembered);
                return;
              }
              const cards = Array.from(prevShelf.querySelectorAll('.shelf-row .video-card.focusable'));
              if (cards.length > 0) {
                const curRect = this.currentFocused.getBoundingClientRect();
                const curCenter = curRect.left + curRect.width / 2;
                let closestCard = cards[0];
                let minDiff = Infinity;
                for (const c of cards) {
                  const r = c.getBoundingClientRect();
                  const diff = Math.abs((r.left + r.width / 2) - curCenter);
                  if (diff < minDiff) {
                    minDiff = diff;
                    closestCard = c;
                  }
                }
                this.setFocus(closestCard);
                return;
              }
            } else {
              // At topmost shelf -> jump up to Hero Play Button!
              const heroBtn = document.getElementById('hero-btn-play');
              if (heroBtn && heroBtn.offsetParent !== null) {
                this.setFocus(heroBtn);
                return;
              }
            }
          }
        }
      }

      // Case C: Focused on Sidebar, pressing Right (39)
      if (this.currentFocused.closest('#sidebar') && key === 39) {
        if (this.app.currentSection === 'home') {
          const firstShelf = document.querySelector('.shelf-container');
          if (firstShelf) {
            const shelfId = firstShelf.dataset.shelfId;
            const remembered = this.shelfFocusMemory[shelfId];
            if (remembered && remembered.offsetParent !== null) {
              this.setFocus(remembered);
              return;
            }
          }
          const heroBtn = document.getElementById('hero-btn-play');
          if (heroBtn && heroBtn.offsetParent !== null) {
            this.setFocus(heroBtn);
            return;
          }
          if (firstShelf) {
            const firstCard = firstShelf.querySelector('.shelf-row .video-card.focusable');
            if (firstCard) {
              this.setFocus(firstCard);
              return;
            }
          }
        }
      }
    }

    // Default 2D spatial navigation fallback for grids, modals, etc.
    const candidates = Array.from(document.querySelectorAll(selector)).filter(el => {
      return el.offsetParent !== null && !el.disabled;
    });

    if (candidates.length === 0) return;

    if (!this.currentFocused || !candidates.includes(this.currentFocused)) {
      this.setFocus(candidates[0]);
      return;
    }

    const currentRect = this.currentFocused.getBoundingClientRect();
    let bestCandidate = null;
    let minDistance = Infinity;

    for (const el of candidates) {
      if (el === this.currentFocused) continue;
      const rect = el.getBoundingClientRect();

      let isCandidate = false;
      let primaryDiff = 0;
      let secondaryDiff = 0;

      // Directions:
      // 38: Up, 40: Down, 37: Left, 39: Right
      if (key === 38 && rect.bottom <= currentRect.top + 15) { // Up
        isCandidate = true;
        primaryDiff = currentRect.top - rect.bottom;
        secondaryDiff = Math.abs((rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2));
      } else if (key === 40 && rect.top >= currentRect.bottom - 15) { // Down
        isCandidate = true;
        primaryDiff = rect.top - currentRect.bottom;
        secondaryDiff = Math.abs((rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2));
      } else if (key === 37 && rect.right <= currentRect.left + 15) { // Left
        isCandidate = true;
        primaryDiff = currentRect.left - rect.right;
        secondaryDiff = Math.abs((rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2));
      } else if (key === 39 && rect.left >= currentRect.right - 15) { // Right
        isCandidate = true;
        primaryDiff = rect.left - currentRect.right;
        secondaryDiff = Math.abs((rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2));
      }

      if (isCandidate) {
        // Distance heuristic: heavily prioritize alignment in secondary axis
        const distance = primaryDiff + (secondaryDiff * 1.6);
        if (distance < minDistance) {
          minDistance = distance;
          bestCandidate = el;
        }
      }
    }

    if (bestCandidate) {
      this.setFocus(bestCandidate);
    }
  }

  setFocus(element, scroll = true) {
    if (this.okKeyDownTimer) {
      clearTimeout(this.okKeyDownTimer);
      this.okKeyDownTimer = null;
      this.isOkLongPressed = false;
    }
    if (this.currentFocused) {
      this.currentFocused.classList.remove('focused');
      this.currentFocused.blur();
    }
    this.currentFocused = element;
    if (element) {
      element.classList.add('focused');
      element.focus();

      const shelfRow = element.closest('.shelf-row');
      if (shelfRow && shelfRow.dataset.shelfId) {
        this.shelfFocusMemory[shelfRow.dataset.shelfId] = element;
      }

      // Expand/collapse sidebar automatically depending on focus location
      if (element.closest('#sidebar')) {
        this.sidebar.classList.add('expanded');
      } else {
        this.sidebar.classList.remove('expanded');
      }

      if (scroll) {
        element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
      }

      if (this.app && typeof this.app.onElementFocused === 'function') {
        this.app.onElementFocused(element);
      }
    }
  }
}

if (typeof window !== 'undefined') window.SpatialNavigation = SpatialNavigation;
if (typeof globalThis !== 'undefined') globalThis.SpatialNavigation = SpatialNavigation;

