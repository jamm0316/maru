// All scene durations (frames @30fps) live here. TRANSITION frames overlap neighbours.
export const FPS = 30;
export const TRANSITION = 24;
export const SCENES = {
  intro: 280, // questions (0-5 s) + gather (5-9 s), one continuous scene
  talk: 360,
  thread: 190,
  layers: 190,
  morning: 160,
  close: 190,
};

const total = (ds: number[]) => ds.reduce((a, b) => a + b, 0) - TRANSITION * (ds.length - 1);
export const TOTAL_FRAMES = total(Object.values(SCENES));
export const SHORT_FRAMES = total([SCENES.intro, SCENES.talk, SCENES.close]);

export const SCENE_START = (() => {
  let t = 0;
  const out: number[] = [];
  for (const d of Object.values(SCENES)) {
    out.push(t);
    t += d - TRANSITION;
  }
  return out;
})();
