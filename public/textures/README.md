# Terrain material sources

These eight diffuse material candidates were generated with OpenAI's built-in image-generation workflow for this project. Prompts requested square, top-down, neutral-lit, seamless game textures with no text, logos, perspective, focal objects, or baked directional shadows.

The renderer resizes them to a common 512×512 GPU texture array and uses mirrored world-space tiling plus macro variation to suppress residual edge seams and repetition.

Stable layer order:

1. `grassland.png`
2. `dry-earth.png`
3. `desert-sand.png`
4. `forest-floor.png`
5. `exposed-rock.png`
6. `tundra-snow.png`
7. `urban-ground.png`
8. `shoreline.png`

Replacement art should remain square, top-down diffuse albedo with neutral lighting. Source resolution may vary because the runtime normalizes every layer.
