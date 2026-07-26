// The shared WebAudio renderer. Needs DOM lib (AudioContext) but no document/window,
// so it sits outside the DOM-free engine and is vendored into munch alongside it.
export * from './flatten.js';
export * from './voice.js';
