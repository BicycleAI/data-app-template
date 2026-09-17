# Recipes

One folder per recipe. `recipe.json` is the catalogue entry the interview reads (question shape, data need, persona fit, caveat copy). The renderer lives in `Render.tsx` next to it and is bundled into `runtime/`.

All recipes draw from the five canonical datasets the composer derives from a spec: `entity_list`, `experiment_meta`, `arm_totals`, `segments`, `daily_trend`. A recipe's `slots` is the number of extra manifest queries it needs beyond those five (today: zero for all).
