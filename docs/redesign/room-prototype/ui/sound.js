/* FORGE room prototype: sound, synthesized with Web Audio (no files). Muted by default.
 *
 * ROOM.sound.tink(n): soft glass tink, E6 plus one semitone per completion today, capped at one octave
 *   (same recipe as the app's src/lib/sound.ts playTink).
 * ROOM.sound.pour(): quiet liquid pour (filtered noise sweep), for saving a number.
 * ROOM.sound.crack(): low stone crack, for a broken streak.
 * ROOM.sound.bell(): deep struck bell, for a tier-up.
 * Every call is a no-op while ROOM.state.muted is true or where audio is unavailable.
 */
(function () {
  'use strict';
  var ROOM = (window.ROOM = window.ROOM || {});
  ROOM.state = ROOM.state || {};
  // Muted by default; a viewer's choice is remembered in this browser only.
  var saved = null;
  try {
    saved = window.localStorage.getItem('forge-room-sound');
  } catch (e) {
    /* storage blocked: stay muted */
  }
  ROOM.state.muted = saved !== 'on';

  var ctx = null;
  function audio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) {
      return null;
    }
  }
  function live() {
    return !ROOM.state.muted ? audio() : null;
  }

  function tone(a, freq, start, duration, gain, type) {
    var t = a.currentTime + start;
    var osc = a.createOscillator();
    var g = a.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(a.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function noise(a, seconds, shape) {
    var len = Math.floor(a.sampleRate * seconds);
    var buf = a.createBuffer(1, len, a.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * shape(i, len);
    var src = a.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function tink(n) {
    var a = live();
    if (!a) return;
    var k = Math.max(0, Math.min(12, Math.floor(n) || 0));
    var base = 1318.5 * Math.pow(2, k / 12); // E6 upward, one semitone per completion
    tone(a, base, 0, 0.35, 0.05);
    tone(a, base * 2.76, 0, 0.18, 0.015); // glassy partial
  }

  function pour() {
    var a = live();
    if (!a) return;
    var src = noise(a, 0.6, function (i, len) {
      return 1 - i / len;
    });
    var filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, a.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1400, a.currentTime + 0.6);
    var g = a.createGain();
    g.gain.value = 0.03;
    src.connect(filter);
    filter.connect(g);
    g.connect(a.destination);
    src.start();
  }

  function crack() {
    var a = live();
    if (!a) return;
    var src = noise(a, 0.25, function (i, len) {
      return Math.exp(-i / (len / 6));
    });
    var filter = a.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    var g = a.createGain();
    g.gain.value = 0.12;
    src.connect(filter);
    filter.connect(g);
    g.connect(a.destination);
    src.start();
    tone(a, 70, 0, 0.3, 0.06, 'triangle');
  }

  function bell() {
    var a = live();
    if (!a) return;
    [110, 220, 276.8, 330, 440].forEach(function (f, i) {
      tone(a, f, 0, 0.95 - i * 0.1, i === 0 ? 0.08 : 0.03);
    });
  }

  /** Mute or unmute (remembered per browser) and tell everyone. */
  function setMuted(on) {
    ROOM.state.muted = !!on;
    try {
      window.localStorage.setItem('forge-room-sound', on ? 'off' : 'on');
    } catch (e) {
      /* not remembered: fine */
    }
    if (!on) tink(0); // a quiet confirmation, and it unlocks audio inside the click
    if (typeof ROOM.emit === 'function') ROOM.emit('state', {});
  }

  ROOM.sound = ROOM.sound || {};
  ROOM.sound.tink = tink;
  ROOM.sound.pour = pour;
  ROOM.sound.crack = crack;
  ROOM.sound.bell = bell;
  ROOM.sound.setMuted = setMuted;
})();
