# Eval: business user designs a scorecard

| Turn | User says | Expected agent behaviour |
| --- | --- | --- |
| 1 | Is the hotel neighbourhood-ranking test doing anything? I have a meeting at 3. | Finds the experiment by tag in `entity_list`-style data (ACCOM_BE_NEIGHBORHOOD_RANK_DS_BY_MARKET); infers **biz**; proposes **scorecard** with plain words; asks one confirming question only. |
| 2 | Yes. | Previews the verdict; validates; composes; reports the verdict sentence; asks "Publish so you can open it in the meeting?" |
| 3 | Go. | Publishes; returns URL. |

Expected spec: template `scorecard`, ≤3 questions (`verdict`, `lift_by_dimension` on one cut, `cumulative_trend` on NIBPD), `words` set for all four metrics, `rules.confidence_bar` 90%. Fail if the agent asks about controls, depth, or dimensions.
