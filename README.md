# data-app-kit

Design Bicycle data apps by interview, compose them from a spec, publish without writing code.

- **Interview**: `skills/ask-show-ship/SKILL.md` — what an agent asks a business user, PM or analyst, and the spec it produces.
- **Spec**: `spec/dataapp-spec.v2.schema.json` — the contract: any model, any measures, any cuts, optional entity, optional analysis family. Examples in `spec/examples/` (a hotel booking-health report on one model, three A/B-test apps on another).
- **Recipes** and **templates**: core recipes work on any model; `families/` add domain maths (today `ab_test`).
- **Profiles**: model bindings are tenant data discovered by `design_model_card` and saved per tenant — never checked into this repo.
- **Runtime**: one prebuilt bundle that reads the spec and mounts recipes.
- **Datasets**: `recipes/datasets.json` and `families/<kind>/datasets.json` declare every query, as data — there is no SQL in the code.
- **Composer**: `kit compose spec.json` → validated bundle → Bicycle Studio.

```bash
npm install
npm run build                                      # builds runtime/dist once
node compose/cli.mjs validate spec/examples/*.json
node compose/cli.mjs compose spec/examples/seti-report.json --out build/seti-report
# upload build/seti-report.zip with dataapp_upload_url / --upload-url, then dataapp_complete_upload + dataapp_publish
```

In chat (ChatGPT, Claude, Bicycle), the same flow is the `design_*` toolset on the bicycle-studio MCP: `design_model_card` → `design_recipe_preview` → `design_compose` → `dataapp_publish`.

Engineers who need something the recipes cannot express start from `template/` and upload a bundle by hand. See `AGENTS.md` before changing anything here.
