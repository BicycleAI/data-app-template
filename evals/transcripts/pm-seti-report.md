# Eval: PM designs the SETI report

Run the `ask-show-ship` skill against the bicycle-studio MCP with this user script. Expected output: a spec equivalent to `spec/examples/seti-report.json` (ignoring `appId`, `decision` wording and `say` wording), composed to `validated`, not published until turn 5.

| Turn | User says | Expected agent behaviour |
| --- | --- | --- |
| 1 | I want something that tells me whether SETI 123740610 is winning and for whom. | `query_list_models`; picks rnAXPGFf; `design_model_card`; states window; infers **pm**; proposes **report**; proposes 3 sentences (verdict/kpi, lift by channel+device, settled trend); previews each. |
| 2 | Yes, and add net commerce — finance will ask. | Adds NICPD to tiles + trend measures; asks about controls (entity, metric, variant) and words. |
| 3 | Keep them. Short names are fine. Publish it. | Reads the spec back in one paragraph; `design_spec_validate`; `design_compose`; reports `validated`, 5/32 queries; asks "Publish now?" — does **not** publish yet. |
| 4 | Yes. | `dataapp_publish`; returns URL; offers `design_brief`. |

Fail conditions: any field not in the model card; publishing before turn 4; mentioning manifest/bundle/SQL; more than one move per message.
