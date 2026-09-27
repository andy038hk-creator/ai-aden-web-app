/**
 * Entry — boot canvas game.
 * Serve via: python3 -m http.server 8080  (ES modules need HTTP)
 */
import { Game } from './game.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');

if (!canvas || !overlay) {
  console.error('Missing #game or #overlay');
} else {
  const game = new Game(canvas, overlay);
  window.__chenxiang = game; // debug hook
  console.log('沉香：劈山 ready — Chenxiang: Split the Mountain');
}
