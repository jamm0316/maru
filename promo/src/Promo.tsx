import React from "react";
import { Easing, AbsoluteFill } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { COPY, Lang } from "./copy";
import { SCENES, TRANSITION } from "./timing";
import { IntroScene } from "./scenes/Intro";
import { TalkScene } from "./scenes/Talk";
import { ThreadScene } from "./scenes/Thread";
import { HowScene } from "./scenes/How";
import { MorningScene } from "./scenes/Morning";
import { CloseScene } from "./scenes/Close";
import { P } from "./ui/theme";

export type PromoProps = { lang: Lang; short?: boolean };

export const Promo: React.FC<PromoProps> = ({ lang, short }) => {
  const t = COPY[lang];
  const tr = (k: string) => (
    <TransitionSeries.Transition key={k} presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION, easing: Easing.inOut(Easing.ease) })} />
  );
  const seq = (k: keyof typeof SCENES, el: React.ReactNode) => (
    <TransitionSeries.Sequence key={k} durationInFrames={SCENES[k]}>{el}</TransitionSeries.Sequence>
  );
  const parts: React.ReactNode[] = [seq("intro", <IntroScene t={t} />), tr("a"), seq("talk", <TalkScene t={t} />), tr("b")];
  if (!short) {
    parts.push(seq("thread", <ThreadScene t={t} />), tr("t"), seq("layers", <HowScene t={t} />), tr("c"), seq("morning", <MorningScene t={t} />), tr("d"));
  }
  parts.push(seq("close", <CloseScene t={t} />));
  return (
    <AbsoluteFill style={{ background: P.paper }}>
      <TransitionSeries>{parts}</TransitionSeries>
    </AbsoluteFill>
  );
};
