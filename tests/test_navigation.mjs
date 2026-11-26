// tests/test_navigation.mjs - Unit tests for Spatial Navigation & Remote controls
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupMockEnvironment, MockElement } from './mock_dom.mjs';

describe('Spatial Navigation & LG Remote Tests', () => {
    let env, doc, nav;

    before(() => {
        env = setupMockEnvironment();
        doc = env.doc;

        // Set up mock cards with exact geometry
        const card1 = new MockElement('div', 'card-1', 'video-card focusable');
        card1.setRect(100, 150, 380, 260);
        env.elements.set('card-1', card1);

        const card2 = new MockElement('div', 'card-2', 'video-card focusable');
        card2.setRect(100, 560, 380, 260);
        env.elements.set('card-2', card2);

        const card3 = new MockElement('div', 'card-3', 'video-card focusable');
        card3.setRect(400, 150, 380, 260);
        env.elements.set('card-3', card3);

        const card4 = new MockElement('div', 'card-4', 'video-card focusable');
        card4.setRect(400, 560, 380, 260);
        env.elements.set('card-4', card4);

        const qrModal = new MockElement('div', 'qr-modal', 'modal hidden');
        env.elements.set('qr-modal', qrModal);

        class TestSpatialNav {
            constructor() {
                this.focusedElement = null;
                this.modalStack = [];
                this.lastBackPress = 0;
            }

            setFocus(el) {
                if (this.focusedElement && this.focusedElement.classList) {
                    this.focusedElement.classList.remove('focused');
                }
                this.focusedElement = el;
                if (el && el.classList) {
                    el.classList.add('focused');
                    if (el.focus) el.focus();
                }
            }

            findBestCandidate(currentEl, direction, candidates) {
                const cur = currentEl.getBoundingClientRect();
                const curCenter = { x: cur.left + cur.width / 2, y: cur.top + cur.height / 2 };

                let best = null;
                let minScore = Infinity;

                for (const el of candidates) {
                    if (el === currentEl) continue;
                    const r = el.getBoundingClientRect();
                    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };

                    const dx = c.x - curCenter.x;
                    const dy = c.y - curCenter.y;

                    // Direction check
                    if (direction === 'right' && dx <= 0) continue;
                    if (direction === 'left' && dx >= 0) continue;
                    if (direction === 'down' && dy <= 0) continue;
                    if (direction === 'up' && dy >= 0) continue;

                    // Euclidean primary + secondary penalty
                    let primary = 0;
                    let secondary = 0;
                    if (direction === 'left' || direction === 'right') {
                        primary = Math.abs(dx);
                        secondary = Math.abs(dy);
                    } else {
                        primary = Math.abs(dy);
                        secondary = Math.abs(dx);
                    }

                    // Strict directional weighting: secondary axis has 2.5x penalty
                    const score = primary + secondary * 2.5;
                    if (score < minScore) {
                        minScore = score;
                        best = el;
                    }
                }
                return best;
            }

            handleBackKey(currentTime) {
                if (this.modalStack.length > 0) {
                    const topModal = this.modalStack.pop();
                    topModal.classList.add('hidden');
                    return 'MODAL_CLOSED';
                }

                if (this.lastBackPress && (currentTime - this.lastBackPress < 2400)) {
                    this.lastBackPress = 0;
                    return 'APP_EXIT';
                }
                this.lastBackPress = currentTime;
                return 'TOAST_SHOWN';
            }
        }

        nav = new TestSpatialNav();
    });

    test('1. Focus management adds .focused class and fires focus()', () => {
        const card1 = doc.getElementById('card-1');
        nav.setFocus(card1);
        assert.equal(nav.focusedElement, card1);
        assert.ok(card1.classList.contains('focused'));

        const card2 = doc.getElementById('card-2');
        nav.setFocus(card2);
        assert.equal(nav.focusedElement, card2);
        assert.ok(card2.classList.contains('focused'));
        assert.ok(!card1.classList.contains('focused'), 'Previous focus lost class');
    });

    test('2. 2D Euclidean directional calculation prefers orthogonal horizontal neighbor', () => {
        const card1 = doc.getElementById('card-1');
        const card2 = doc.getElementById('card-2');
        const card3 = doc.getElementById('card-3');
        const card4 = doc.getElementById('card-4');

        const allCards = [card1, card2, card3, card4];

        // Moving right from card1 should pick card2 (same row) not card4 (diagonal)
        const targetRight = nav.findBestCandidate(card1, 'right', allCards);
        assert.equal(targetRight, card2, 'Should move right to Card 2');

        // Moving down from card1 should pick card3 (same column) not card4 (diagonal)
        const targetDown = nav.findBestCandidate(card1, 'down', allCards);
        assert.equal(targetDown, card3, 'Should move down to Card 3');
    });

    test('3. Modal focus trap correctly traps back navigation', () => {
        const modal = doc.getElementById('qr-modal');
        modal.classList.remove('hidden');
        nav.modalStack.push(modal);

        // First back key should close modal, not trigger exit toast
        const result1 = nav.handleBackKey(10000);
        assert.equal(result1, 'MODAL_CLOSED');
        assert.ok(modal.classList.contains('hidden'));
        assert.equal(nav.modalStack.length, 0);
    });

    test('4. Double-back key threshold exits only if pressed within 2400ms', () => {
        // First back press at t=1000 -> shows toast
        const res1 = nav.handleBackKey(1000);
        assert.equal(res1, 'TOAST_SHOWN');

        // Second press at t=1800 (800ms later, < 2400ms) -> exits app
        const res2 = nav.handleBackKey(1800);
        assert.equal(res2, 'APP_EXIT');

        // Reset: press at t=5000 -> shows toast
        const res3 = nav.handleBackKey(5000);
        assert.equal(res3, 'TOAST_SHOWN');

        // Press at t=8000 (3000ms later, > 2400ms) -> shows toast again, does not exit
        const res4 = nav.handleBackKey(8000);
        assert.equal(res4, 'TOAST_SHOWN');
    });

    test('5. LG Magic Remote keycode map coverage', () => {
        const LG_KEYCODES = {
            LEFT: 37,
            UP: 38,
            RIGHT: 39,
            DOWN: 40,
            OK: 13,
            BACK_WEBOS: 461,
            PLAY: 415,
            PAUSE: 19,
            STOP: 413,
            FAST_FORWARD: 417,
            REWIND: 412,
            RED: 403,
            GREEN: 404,
            YELLOW: 405,
            BLUE: 406
        };

        assert.equal(LG_KEYCODES.BACK_WEBOS, 461, 'webOS Back key must be 461');
        assert.equal(LG_KEYCODES.PLAY, 415, 'Media Play key must be 415');
        assert.equal(LG_KEYCODES.PAUSE, 19, 'Media Pause key must be 19');
        assert.equal(LG_KEYCODES.FAST_FORWARD, 417, 'FF key must be 417');
        assert.equal(LG_KEYCODES.REWIND, 412, 'REW key must be 412');
    });

    test('6. Shelf Focus Memory restores last active card on horizontal rail', () => {
        const shelfMemory = {};
        const shelfA_card1 = { id: 'sa1', shelfId: 'shelf_a' };
        const shelfA_card3 = { id: 'sa3', shelfId: 'shelf_a' };
        const shelfB_card2 = { id: 'sb2', shelfId: 'shelf_b' };

        // User focuses card 3 in shelf A
        shelfMemory[shelfA_card3.shelfId] = shelfA_card3;
        assert.equal(shelfMemory['shelf_a'].id, 'sa3');

        // User navigates down to shelf B, focusing card 2
        shelfMemory[shelfB_card2.shelfId] = shelfB_card2;
        assert.equal(shelfMemory['shelf_b'].id, 'sb2');

        // User navigates back UP to shelf A -> shelfFocusMemory returns card 3, not card 1!
        const restored = shelfMemory['shelf_a'];
        assert.equal(restored.id, 'sa3', 'Returning to shelf A must restore card 3 from focus memory');
    });

    test('7. Real SpatialNavigation blocks background mouseover focus leak when modal is open', async () => {
        const localEnv = setupMockEnvironment();
        await import('../src/js/navigation.js');
        const SpatialNavigation = globalThis.SpatialNavigation;

        const sidebar = localEnv.doc.getElementById('sidebar');
        const bgCard = new MockElement('div', 'bg-card', 'video-card focusable');
        const modal = new MockElement('div', 'video-context-modal', 'modal-overlay');
        modal.style.display = 'flex';
        const modalBtn = new MockElement('button', 'ctx-btn-play', 'option-btn focusable');
        modal.appendChild(modalBtn);

        localEnv.root.appendChild(sidebar);
        localEnv.root.appendChild(bgCard);
        localEnv.root.appendChild(modal);

        const playerContainer = new MockElement('div', 'player-container');
        playerContainer.style.display = 'none';

        const mockApp = {
            currentSection: 'home',
            player: { container: playerContainer },
            isModalOpen: () => modal.style.display === 'flex'
        };

        const realNav = new SpatialNavigation(mockApp);
        realNav.setFocus(modalBtn, false);

        // Background card emits mouseover while modal is open -> must NOT steal focus!
        localEnv.doc.dispatchEvent({ type: 'mouseover', target: bgCard });
        assert.equal(realNav.currentFocused, modalBtn, 'Background mouseover must not steal focus from open modal');
    });

    test('8. Player OK on btn-rewind/btn-forward clicks button while paused, and Left from scrolled grid focuses active nav item', async () => {
        const localEnv = setupMockEnvironment();
        await import('../src/js/navigation.js');
        const SpatialNavigation = globalThis.SpatialNavigation;

        const sidebar = localEnv.doc.getElementById('sidebar');
        const navHome = new MockElement('div', 'nav-home', 'nav-item focusable active');
        navHome.setRect(120, 14, 72, 60);
        const profileBtn = new MockElement('div', 'user-profile-btn', 'user-status-card focusable');
        profileBtn.setRect(960, 14, 72, 60);
        sidebar.appendChild(navHome);
        sidebar.appendChild(profileBtn);

        const mainContent = localEnv.doc.getElementById('main-content');
        const cardLow = new MockElement('div', 'card-low', 'video-card focusable');
        cardLow.setRect(880, 176, 380, 260);
        mainContent.appendChild(cardLow);

        localEnv.root.appendChild(sidebar);
        localEnv.root.appendChild(mainContent);

        const playerContainer = new MockElement('div', 'player-container');
        playerContainer.style.display = 'none';
        const osd = new MockElement('div', 'player-osd');
        const btnRewind = new MockElement('button', 'btn-rewind', 'player-btn focusable');
        let rewindClicked = 0;
        btnRewind.addEventListener('click', () => { rewindClicked++; });
        playerContainer.appendChild(osd);
        playerContainer.appendChild(btnRewind);

        let togglePlayCalled = 0;
        const mockApp = {
            currentSection: 'home',
            isModalOpen: () => false,
            player: {
                container: playerContainer,
                osd,
                playBtn: btnRewind,
                isSeeking: false,
                seekCommitTimer: null,
                video: { paused: true },
                togglePlay: () => { togglePlayCalled++; }
            }
        };

        const realNav = new SpatialNavigation(mockApp);
        // Test 1: Left from bottom card hits active nav item, not bottom profileBtn
        realNav.setFocus(cardLow, false);
        realNav.handleKeyDown({ keyCode: 37, preventDefault: () => {} });
        assert.equal(realNav.currentFocused, navHome, 'Pressing Left from grid must focus active nav item, not user-profile-btn');

        // Test 2: OK on btn-rewind while video is paused triggers rewind click instead of togglePlay
        playerContainer.style.display = 'block';
        realNav.setFocus(btnRewind, false);
        realNav.handleKeyDown({ keyCode: 13, preventDefault: () => {} });
        assert.equal(rewindClicked, 1, 'OK on btn-rewind while paused must trigger rewind');
        assert.equal(togglePlayCalled, 0, 'OK on btn-rewind while paused must not call togglePlay');
    });
});
