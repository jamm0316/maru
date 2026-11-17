# Maru site

Static page. Plain HTML, CSS and JS. No build step, no network requests.

## Preview

    cd site
    python3 -m http.server

Open the address it prints (port 8000 by default).

## Set the links

Edit `copy.js`, the `MARU_LINKS` object at the top:

    window.MARU_LINKS = { download: "", github: "" };

While a link is empty, its button shows the quiet "Coming soon" style and has no href.

## Video and posters

Copy these from `promo/out` into `site/assets/`:

- `maru-promo.mp4` and `poster.png` (English)
- `maru-promo-ko.mp4` and `poster-ko.png` (Korean)

Until they exist, the page shows a placeholder with the logo. The first paint of the page depends on JavaScript, because all text lives in `copy.js`.

## Copy check

    node check-copy.js

Verifies that every `data-i18n` key exists in both languages and that no key is unused.
