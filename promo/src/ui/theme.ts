import { Easing, interpolate } from "remotion";

// Palette from app/renderer/style.css
export const C = {
  bg: "#0B0907",
  panel: "#14100C",
  line: "#2B2119",
  ink: "#F3ECE4",
  mute: "#A89A8A",
  soft: "#CFC3B5",
  or: "#FF8A2A",
  or2: "#FFB46B",
  sel: "#2A1A0C",
  topbar: "#0F0C09",
  btnLine: "#4A3A2C",
  onOr: "#1A0F05",
  ok: "#9BE29B",
  okLine: "#2F5A2F",
  okBg: "#122012",
  mt: { user: "#FF8A2A", feedback: "#8FCB8F", project: "#6FB1E8", reference: "#C4A5E8" },
};

export const FONT = `-apple-system, "SF Pro Text", "Apple SD Gothic Neo", sans-serif`;
export const MONO = `"SF Mono", Menlo, monospace`;

export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0→1 progress between frames a..b with ease-out. */
export const prog = (frame: number, a: number, b: number, ease = easeOut) =>
  interpolate(frame, [a, b], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

// Paper palette (website match). Windows keep the app's dark palette `C`.
export const P = {
  paper: "#F6F1E8",
  ink: "#1F1B16",
  mute: "#6E655A",
  line: "#E3DACB",
  card: "#FBF8F2",
  chip: "#EFE6D6",
  or: "#FF8A2A",
};
export const SERIF = `"Iowan Old Style", "Palatino", Georgia, "AppleMyungjo", "Noto Serif KR", serif`;
export const PAPER_BG = `radial-gradient(ellipse at 50% 42%, #F9F5EE 0%, #F6F1E8 55%, #EEE6D8 100%)`;
export const WIN_SHADOW = "0 60px 140px rgba(60,40,15,0.30), 0 10px 30px rgba(60,40,15,0.14)";
