# Karachi Traffic 3D

Low-poly 3D browser driving game: get a 660cc Suzuki Alto from Saddar, over the Lyari Expressway, to Clifton before the checkpoint timer runs out.

```bash
npm install
npm run dev      # http://localhost:5173 and your LAN IP (for phones on the same Wi-Fi)
npm run build    # type-check + production bundle in dist/
npm run preview  # serve the production build (also on LAN)
```

URL options: `?seed=123` (world seed), `?low` / `?high` (force graphics tier), `?z=1500` (debug: start further along the route).

See `CLAUDE.md` for architecture rules (`src/sim/` is pure, deterministic TypeScript; `src/render/` only reads it).
