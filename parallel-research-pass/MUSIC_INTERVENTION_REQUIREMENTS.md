# Music Intervention Requirements

**Source:** de Witte et al., "Effects of Music Interventions on Stress-Related Outcomes" — 104-RCT meta-analysis, JMIR Ment Health (2020/2025)  
**Extraction status:** ✅ EXTRACTED (first 826 of 2309 lines — prose sections containing all effect sizes and moderators)

---

## 1. What the meta-analysis supports (do use)

| Claim | Effect size | N | Evidence grade |
|-------|-------------|---|----------------|
| Music reduces physiological stress markers | d=0.380 | 9,617 participants, 104 RCTs | **Strong — 104 RCTs** |
| Music reduces heart rate | d=0.456 | subset of above | Strong |
| Music reduces blood pressure | d=0.343 | subset | Strong |
| Music reduces hormonal stress markers | d=0.349 | subset | Strong |
| Music reduces psychological stress | d=0.545 | subset | Strong |
| Slow tempo (60–80 bpm) → larger psychological effects | trend, p not given | subset | Moderate (trending) |
| Music listening AND music making/singing both effective | no significant difference | across RCTs | Strong |
| Live vs prerecorded: no significant difference | ns | across RCTs | Strong |
| Self-selected vs researcher-selected: no significant difference | ns | across RCTs | Strong |
| With lyrics vs without: no significant difference | ns | across RCTs | Strong |

---

## 2. What the meta-analysis does NOT support (do not use)

| Forbidden inference | Why it's not supported |
|--------------------|----------------------|
| "Music treats depression" | RCTs measured acute stress reduction, not depression treatment; stress ≠ depression |
| "Music diagnoses mental health" | Intervention research only; no diagnostic component |
| "Music therapy outcomes = Hum intervention outcomes" | Hum's protocol is not a replication of RCT protocols; effect sizes are from structured research settings |
| "Music reduces your depression score by X%" | No dose-response curve established for individualized recommendation |
| "Hum recommends the scientifically optimal track" | Track selection algorithm is feature-matched, not RCT-validated |
| "This music will lower your cortisol" | Hormone effects require measurement; Hum does not measure cortisol |

---

## 3. How music evidence feeds the Hum intervention engine

### 3.1 Valence-Arousal → music mapping (from TriSense + meta-analysis)

The intervention pipeline:
1. `@hum-ai/fusion-engine` → outputs `(valence, arousal)` coordinates for current session
2. `@hum-ai/intervention-engine` → maps VA coordinates to a music region using Russell's circumplex
3. Music track catalog → filter by BPM, energy, valence tag, arousal tag
4. Recommender → select track(s) meeting therapeutic alignment

### 3.2 Supported therapeutic alignment rules

| Detected state | Target VA region | Music approach |
|---------------|-----------------|----------------|
| High arousal / negative valence (stressed, tense) | Low arousal / positive valence | Slow tempo (60–80 bpm), major key, calming |
| Low energy / low arousal / negative valence (fatigued, flat) | Moderate arousal / positive valence | Gentle uplift; avoid sudden high-energy |
| Calm / positive valence | Maintain or explore | Ambient, neutral-to-positive |
| Distressed / unstable | Low arousal / positive valence | Grounding; slow, predictable structure |

**Source:** TriSense paper (TriSense maps emotion → VA → music); effect of slow tempo (60–80 bpm) supported by de Witte et al.

### 3.3 BPM guidance (supported)
- 60–80 BPM → trend toward larger psychological stress effect in de Witte 2025
- Not a hard rule; no RCT specifically validated 60–80 vs other ranges with statistical rigor
- Apply as soft preference in catalog filtering, not as a claim

---

## 4. Allowed user-facing intervention language

| Allowed | Not allowed |
|---------|------------|
| "Music that may help you unwind" | "Music that will reduce your stress" |
| "We've selected calming tracks based on your hum pattern" | "Your hum indicates you need stress reduction" |
| "Slow-tempo music has been associated with relaxation in research" | "This music is clinically proven to help your condition" |
| "Music can support your mood" | "Music treats depression" |
| "Take a moment with this" | "This is a therapeutic intervention" |

---

## 5. Key design constraints for `@hum-ai/intervention-engine`

| Constraint | Implementation |
|------------|---------------|
| Music recommendation is triggered ONLY when fusion confidence is sufficient | Confidence gate: minimum 72% (first-hum threshold); below this, do not recommend |
| Recommendation is for "moments of calm", not therapy | User-facing copy never implies treatment |
| Track catalog must have valence/arousal/BPM metadata | Catalog schema: `{ id, title, artist, valence: -1..1, arousal: 0..1, bpm, genre }` |
| VA-to-music mapping must be documented and auditable | Internal mapping table in ADR or code comment |
| No A/B testing of "therapeutic vs control" music without ethics review | Standard product testing only |
| Music is not personalized to the user's diagnosis | No clinical condition used in recommendation; only current VA state |
| Recommendation is always optional | User can skip; no push notification requiring music engagement |

---

## 6. Music intervention as non-diagnostic use (governance statement)

The de Witte et al. meta-analysis establishes that music intervention reduces stress-related outcomes across diverse settings (medical procedures, daily life, mental health contexts). This is **strong evidence for the intervention layer**.

It does NOT provide:
- Diagnostic accuracy for any condition
- A dose-response relationship for individualized recommendation
- Evidence that music-listening apps replicate RCT-quality outcomes

The `@hum-ai/intervention-engine` should be documented as a "wellness support feature" informed by stress-reduction evidence, not a clinical intervention. This framing is consistent with the music meta-analysis evidence scope and Hum's non-diagnostic posture.
