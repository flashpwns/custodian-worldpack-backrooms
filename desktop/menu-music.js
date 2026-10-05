"use strict";

// Presentation session state belongs to the application process, never a save.
// Project Owner Override: The old four-track weighted pool is retired.
// Beat 1 uses the single implemented bossa track as main-menu music.
const BOSSA_TRACK = Object.freeze({
  id: "bossa-diary",
  title: "Bossanova, Sweet, Healing, Peaceful — Today's diary",
  file: "bossa-diary.mp3",
  src: "../assets/audio/Music/bossa-diary.mp3",
  available: true
});

const TRACKS = Object.freeze([BOSSA_TRACK]);

function selectTrack() {
  return BOSSA_TRACK;
}

const applicationTrack = selectTrack();
module.exports = { TRACKS, selectTrack, applicationTrack, BOSSA_TRACK };
