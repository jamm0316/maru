import React from "react";
import { Composition } from "remotion";
import { Promo, PromoProps } from "./Promo";
import { FPS, SHORT_FRAMES, TOTAL_FRAMES } from "./timing";

const common = { width: 1920, height: 1080, fps: FPS };

export const Root: React.FC = () => (
  <>
    <Composition id="MaruPromo" component={Promo} durationInFrames={TOTAL_FRAMES} {...common} defaultProps={{ lang: "en" } as PromoProps} />
    <Composition id="MaruPromoKo" component={Promo} durationInFrames={TOTAL_FRAMES} {...common} defaultProps={{ lang: "ko" } as PromoProps} />
    <Composition id="MaruPromoShort" component={Promo} durationInFrames={SHORT_FRAMES} {...common} defaultProps={{ lang: "en", short: true } as PromoProps} />
  </>
);
