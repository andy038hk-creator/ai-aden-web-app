/**
 * DOM overlay UI: title, reward cards, win/lose, HUD is drawn on canvas.
 */
import { BAXIANS } from './baxian.js';

export class UI {
  constructor(overlayEl, onEvent) {
    this.el = overlayEl;
    this.onEvent = onEvent; // (type, payload) => void
  }

  clear() {
    this.el.innerHTML = '';
    this.el.classList.remove('active');
  }

  showTitle() {
    this.el.classList.add('active');
    this.el.innerHTML = `
      <div class="screen title">
        <h1>沉香：劈山<span class="en">Chenxiang: Split the Mountain</span></h1>
        <p class="subtitle">寶蓮燈 · 八仙 · 二郎神</p>
        <div class="hint">
          <div><kbd>WASD</kbd> / <kbd>↑↓←→</kbd> Move</div>
          <div><kbd>Space</kbd> / <kbd>J</kbd> / <kbd>LMB</kbd> Axe melee</div>
          <div><kbd>K</kbd> / <kbd>F</kbd> / <kbd>RMB</kbd> 寶蓮燈 cast</div>
          <div><kbd>Esc</kbd> Pause</div>
          <div style="margin-top:0.6rem;color:var(--jade-bright)">Clear rooms · claim 八仙 boons · face 二郎神</div>
        </div>
        <button class="btn" id="btn-start">開 始 · Start</button>
      </div>
    `;
    this.el.querySelector('#btn-start').onclick = () => this.onEvent('start');
  }

  showRewards(choices) {
    this.el.classList.add('active');
    const cards = choices
      .map(
        (b) => `
      <button class="card" data-id="${b.id}">
        <span class="kind ${b.kind}">${b.kind === 'passive' ? 'Boons' : 'Cast Upgrade'}</span>
        <span class="name">${b.name}</span>
        <span class="en-name">${b.en}</span>
        <span class="desc">${b.desc}</span>
        <span class="tag">${b.tag}</span>
      </button>`
      )
      .join('');
    this.el.innerHTML = `
      <div class="screen reward">
        <div class="reward-title">八仙賜福 · Choose a Blessing</div>
        <div class="reward-sub">The Immortals offer aid — pick one</div>
        <div class="cards">${cards}</div>
      </div>
    `;
    this.el.querySelectorAll('.card').forEach((btn) => {
      btn.onclick = () => this.onEvent('pickBoon', btn.dataset.id);
    });
  }

  showWin() {
    this.el.classList.add('active');
    this.el.innerHTML = `
      <div class="screen win">
        <div class="result-icon">🏮</div>
        <h1>劈山成功<span class="en">The Mountain Splits</span></h1>
        <p class="subtitle">二郎神退 · 母親得救 — for now</p>
        <p class="hint" style="text-align:center">Prototype clear. Deeper runs await.</p>
        <button class="btn" id="btn-restart">再 戰 · Restart</button>
      </div>
    `;
    this.el.querySelector('#btn-restart').onclick = () => this.onEvent('restart');
  }

  showLose() {
    this.el.classList.add('active');
    this.el.innerHTML = `
      <div class="screen lose">
        <div class="result-icon">⚔</div>
        <h1>隕落<span class="en">Fallen on the Path</span></h1>
        <p class="subtitle">天兵不退 — the lantern dims</p>
        <button class="btn" id="btn-restart">重 來 · Restart</button>
      </div>
    `;
    this.el.querySelector('#btn-restart').onclick = () => this.onEvent('restart');
  }

  showPause() {
    this.el.classList.add('active');
    this.el.innerHTML = `
      <div class="screen">
        <h1>暫 停<span class="en">Paused</span></h1>
        <div class="hint">
          <div><kbd>WASD</kbd> Move · <kbd>J</kbd>/<kbd>LMB</kbd> Melee · <kbd>K</kbd>/<kbd>RMB</kbd> Lantern</div>
          <div><kbd>Esc</kbd> Resume</div>
        </div>
        <button class="btn" id="btn-resume">繼 續 · Resume</button>
      </div>
    `;
    this.el.querySelector('#btn-resume').onclick = () => this.onEvent('resume');
  }

  /** Look up boon by id (for applying). */
  static getBoon(id) {
    return BAXIANS.find((b) => b.id === id);
  }
}
