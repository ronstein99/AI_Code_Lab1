# Solar System Gravity

The real solar system, simulated in the browser with Newton's law of gravity in SI units.
Change a planet's mass and watch how it affects every other orbit.

**Live:** https://ronstein99.github.io/AI_Code_Lab1/

- Sun, 8 planets, 5 dwarf planets, 11 moons and 5 comets with real masses, radii and orbits (NASA / JPL data)
- Velocity Verlet integration with a 1-hour step; energy drift is shown on screen
- 500 main-belt asteroids, 150 Jupiter Trojans and three meteor-shower debris streams
- 2D (top-down) and 3D views, built with three.js
- Runs entirely in the browser: plain HTML, CSS and JavaScript, no server

Open `index.html` directly, or serve the folder (`python3 -m http.server`) to see the photo textures.
Texture and data credits are in [CREDITS.md](CREDITS.md).
