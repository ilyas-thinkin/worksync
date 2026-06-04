# OT Setup and Material Tracking Discussion

Date: 2026-05-13

## Purpose

This file captures the OT setup and OT material-tracking discussion so work can continue later without rebuilding context from chat history.

## Current Context

Recent OT-related implementation already completed:

- OT workstations now default to inactive.
- IE can activate OT workstations as required.
- Backend OT creation/rebuild paths were updated to default `is_active = false`.
- OT DB default for `line_ot_workstations.is_active` was changed to `FALSE`.

Relevant completed code changes:

- [backend/src/routes/api.routes.js](/home/worksync/worksync/backend/src/routes/api.routes.js)
- [backend/src/public/js/admin.js](/home/worksync/worksync/backend/src/public/js/admin.js)
- [backend/src/public/js/supervisor.js](/home/worksync/worksync/backend/src/public/js/supervisor.js)
- [backend/src/migrations/039_ot_workstations_default_inactive.sql](/home/worksync/worksync/backend/src/migrations/039_ot_workstations_default_inactive.sql)

## Topic Under Discussion

Need to design OT material tracking and combined regular + OT tracking before implementation.

Main uncertainty discovered during discussion:

- OT material may need to be tracked separately per workstation, not only as group-based flow.

Because of that, implementation was intentionally paused until the client confirms the business rules.

## Current Technical Understanding

Regular shift currently has:

- feed entry
- group-level WIP
- regular material tracking screen/report

OT currently has:

- OT workstation plan
- OT activation/inactivation
- OT employee assignment
- OT output entry
- workstation-level OT progress/WIP snapshot

OT does not yet have:

- finalized OT feed design
- finalized OT WIP model
- finalized combined regular + OT material report model

## Core Design Question

The most important business decision is:

Should OT material flow be:

- group-based flow, where feed starts once and moves through workstations

or

- workstation-based flow, where each OT workstation can receive and manage its own feed independently

This decision affects:

- data model
- APIs
- validations
- UI design
- reports

## Client Message Draft

Use the following message with the client to confirm the full OT setup and OT material-tracking rules.

---

Hi, before we finalize the full OT setup and OT material tracking, we need to confirm the below points. Please review and reply point by point.

## A. OT Setup - Basic Flow

1. Who should be allowed to create the OT plan?
IE only / Admin only / both

2. Who should be allowed to activate OT for a line?
IE only / Admin only / both

3. Should OT remain locked until IE authorizes it?

4. After IE authorization, who can operate OT?
Supervisor only / Admin + Supervisor / others also

5. Should OT workstations always default as inactive, and IE activate only the required ones?

6. Can Supervisor activate/deactivate OT workstations after IE authorization, or should only IE/Admin do that?

7. Should OT be allowed only for workstations that exist in the regular plan, or can OT have a different workstation layout?

8. If needed, can OT layout be edited separately from regular layout?

9. When OT is created, should employee assignment be copied from regular shift automatically?

10. If copied from regular shift, should employee assignment still be editable for OT separately?

11. If no employee is assigned to an OT workstation, should OT output still be allowed?

12. If no employee is assigned, should OT feed still be allowed?

13. Should OT be possible only for active workstations, or can inactive OT workstations also keep data temporarily?

14. Should OT product always be the same as the regular shift product, or can OT run a different product?

15. If changeover is involved, should OT use:
primary product / incoming product / whichever product is active at OT time?

## B. OT Timing and Targets

16. Should OT minutes be set:
globally for the line / separately for each workstation / both allowed

17. Who can change OT minutes?
IE / Admin / Supervisor / combination

18. Should OT target be auto-calculated from OT minutes, or entered manually?

19. If auto-calculated, should it use:
regular hourly target / workstation hourly target / product target basis

20. If OT starts late, should OT calculations start from actual OT start time or from planned OT minutes only?

21. If OT duration changes after work has started, should target and workload auto-recalculate?

22. Should inactive OT workstations be excluded from OT target automatically?

## C. OT Employee Handling

23. Should OT employee assignment be completely separate from regular assignment?

24. If employee changes during OT, should OT history stay under workstation or follow employee?

25. Should QR scan assignment in OT be allowed?

26. Who can change OT employee assignment?
IE / Admin / Supervisor / combination

27. Should employee reassignment during OT keep full audit history?

28. If regular employee is absent in OT, can another worker be assigned only for OT without affecting regular records?

## D. OT Material Tracking

29. In OT, should feed be entered separately for each workstation, or only once at the first workstation of the group?

30. If feed is separate per workstation in OT, should each workstation be treated as an independent material point?

31. If multiple OT workstations are active in the same group, should material flow from one workstation to the next, or should each workstation have its own separate feed and WIP?

32. For OT opening balance, should each workstation start with regular-shift leftover WIP, or should OT start from zero unless feed is added?

33. If regular shift ends with WIP, should that WIP automatically carry into OT?

34. If regular shift has no WIP, should OT still allow fresh feed entry?

35. Should OT feed be allowed only on active OT workstations?

36. If a workstation is inactive in OT, should it always show zero OT feed, zero OT output, and zero OT WIP?

37. Should OT feed be tracked per workstation, per group, or both?

38. Should OT WIP be tracked per workstation, per group, or both?

39. Should OT output be tracked per workstation only, or should the system also calculate OT group output automatically?

40. If OT is workstation-based, should combined reporting still show group totals?

## E. Combined Regular + OT Tracking

41. In the report, do you want:
Regular only / OT only / Combined only / all three

42. In the combined report, should totals be shown at:
workstation level / group level / line level / all levels

43. Should regular and OT values appear in separate columns, or only final combined totals?

44. For combined totals, should this be correct:
Combined Feed = Regular Feed + OT Feed

45. Combined Output = Regular Output + OT Output

46. Combined WIP = Regular Closing WIP + OT Feed - OT Output

47. If regular shift data is corrected later, should combined OT numbers auto-update?

48. Should OT material affect the product cumulative feed summary also, or should OT have a separate cumulative total?

## F. Validation and Control

49. If OT feed exceeds remaining order quantity, should system:
block it / allow with warning / allow only with mandatory reason

50. If OT output exceeds available OT material, should system:
block it / allow with warning / allow only with mandatory reason

51. Should inactive OT workstations be prevented from saving output?

52. Should inactive OT workstations be prevented from saving feed?

53. Should OT be locked once the production day/shift is closed, same as regular?

54. After OT is saved, who can edit it?
Supervisor / Admin / IE / no one after lock

55. Should OT feed and OT output both keep full audit history with user, time, old value, new value, and reason?

56. Do you want delete/correction control for OT entries, or only edit with audit trail?

## G. OT Screens and Portals

57. In which portals should OT plan be visible?
IE / Admin / Management / Supervisor / all

58. In which portals should OT material entry be available?
Supervisor only / Admin + Supervisor / Admin + Management + Supervisor / all 4 portals

59. Should IE only activate OT workstations, or should IE also be able to enter OT feed/output?

60. Do you want a separate OT Material Tracking screen, or should this be added inside the existing Material Tracking screen?

61. On screen, should OT material entry be:
inside the OT workstation table / in a separate OT feed section

62. Should reports/export show OT feed, OT output, OT WIP, and combined totals separately?

63. Do you want date-wise OT history by line?

64. Do you want OT history searchable by workstation, employee, line, and product?

## H. Final Key Confirmations

65. Should OT setup be workstation-based or group-based overall?

66. Should OT material be fully independent per workstation, instead of group-flow based?

67. Should regular shift WIP carry into OT automatically?

68. Should report show Regular, OT, and Combined separately?

69. What should happen if OT feed/output exceeds limits?

70. Which roles/portals should create, authorize, edit, and operate OT?

---

## Client Answers Received

Date received: 2026-05-20

The below records the client answers received so far for sections A-C. Where the original question was yes/no but the reply came back as roles, the response is preserved as-is and marked for normalization before implementation.

### A. OT Setup - Basic Flow

1. Who should be allowed to create the OT plan?
Answer: Supervisor / IE

2. Who should be allowed to activate OT for a line?
Answer: Supervisor / IE

3. Should OT remain locked until IE authorizes it?
Recorded answer: `Supervisor / IE`
Note: needs normalization because the original question is yes/no.

4. After IE authorization, who can operate OT?
Answer: Supervisor / IE

5. Should OT workstations always default as inactive, and IE activate only the required ones?
Recorded answer: `Supervisor / IE`
Note: needs normalization because the original question is yes/no / role-based.

6. Can Supervisor activate/deactivate OT workstations after IE authorization, or should only IE/Admin do that?
Answer: Supervisor / IE

7. Should OT be allowed only for workstations that exist in the regular plan, or can OT have a different workstation layout?
Answer: Same plan; only needed workstation and operator will change.

8. If needed, can OT layout be edited separately from regular layout?
Answer: No need.

9. When OT is created, should employee assignment be copied from regular shift automatically?
Answer: No need.

10. If copied from regular shift, should employee assignment still be editable for OT separately?
Answer: No need.

11. If no employee is assigned to an OT workstation, should OT output still be allowed?
Answer: Allowed.

12. If no employee is assigned, should OT feed still be allowed?
Answer: Allowed.

13. Should OT be possible only for active workstations, or can inactive OT workstations also keep data temporarily?
Answer: Only for active stations.

14. Should OT product always be the same as the regular shift product, or can OT run a different product?
Answer: Same product.

15. If changeover is involved, should OT use primary product / incoming product / whichever product is active at OT time?
Answer: Whichever product is active at OT time.

### B. OT Timing and Targets

16. Should OT minutes be set globally for the line / separately for each workstation / both allowed?
Answer: Both allowed.

17. Who can change OT minutes?
Answer: Supervisor / IE

18. Should OT target be auto-calculated from OT minutes, or entered manually?
Answer: Auto calculated.

19. If auto-calculated, should it use regular hourly target / workstation hourly target / product target basis?
Answer: Workstation hourly target.

20. If OT starts late, should OT calculations start from actual OT start time or from planned OT minutes only?
Answer: Actual OT start time.

21. If OT duration changes after work has started, should target and workload auto-recalculate?
Answer: No need.

22. Should inactive OT workstations be excluded from OT target automatically?
Answer: Yes.

### C. OT Employee Handling

23. Should OT employee assignment be completely separate from regular assignment?
Answer: Yes.

24. If employee changes during OT, should OT history stay under workstation or follow employee?
Answer: Follow employee.

25. Should QR scan assignment in OT be allowed?
Answer: Yes.

26. Who can change OT employee assignment?
Answer: Supervisor / IE

27. Should employee reassignment during OT keep full audit history?
Answer: Yes.

28. If regular employee is absent in OT, can another worker be assigned only for OT without affecting regular records?
Answer: Yes.

## Working Interpretation So Far

- OT planning, OT activation, OT minutes, and OT employee assignment appear intended to be handled by both Supervisor and IE.
- OT should use the same workstation layout as the regular plan; only the active OT workstations and assigned OT operators change.
- OT should allow feed and output even when no employee is assigned, but only on active OT workstations.
- OT product should remain aligned to the regular shift product context, with changeover using whichever product is active at OT time.
- OT targets should be auto-calculated from workstation hourly targets using actual OT start time.
- OT employee handling should stay separate from regular assignment, support QR assignment, and keep employee-based history plus audit trail.
- Questions A3 and A5 still need clean yes/no normalization from the client before the rules are treated as final.

## Next Step After Partial Client Reply

Now that sections A-C are answered:

1. Normalize ambiguous answers in A3 and A5.
2. Collect client answers for sections D-H.
3. Freeze final business rules for A-C.
4. Complete OT material-tracking design.
5. Then write the implementation plan.

## Suggested Tomorrow Starting Point

When resuming:

1. Read the recorded A-C client answers.
2. Normalize ambiguous answers in A3 and A5.
3. Get final responses for D-H, especially OT material flow.
4. Classify OT as workstation-based or group-based.
5. Decide whether regular WIP carries into OT automatically.
6. Decide whether OT feed is per workstation or per group.
7. Finalize combined reporting rules.
8. Then create the implementation plan.
