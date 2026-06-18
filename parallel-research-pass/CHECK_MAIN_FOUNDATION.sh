#!/usr/bin/env bash
# CHECK_MAIN_FOUNDATION.sh
# Run from the repo root after the main foundation session completes.
# Outputs: PASS / WARN / FAIL per check. Exit code 0 if all PASS, 1 if any FAIL.

set -euo pipefail

PASS=0
WARN=0
FAIL=0

pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
warn() { echo "  WARN  $1"; WARN=$((WARN + 1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

check_dir()  { [ -d "$1" ] && pass "$1 exists" || fail "$1 missing"; }
check_file() { [ -f "$1" ] && pass "$1 exists" || fail "$1 missing"; }
check_grep() {
  local pattern="$1" file="$2" label="$3"
  grep -qr "$pattern" "$file" 2>/dev/null && pass "$label" || fail "$label"
}
check_grep_warn() {
  local pattern="$1" file="$2" label="$3"
  grep -qr "$pattern" "$file" 2>/dev/null && pass "$label" || warn "$label"
}

echo "================================================================"
echo "  Hum v2 Foundation Check — $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================================"

# -----------------------------------------------
echo ""
echo "-- Package structure --"
# -----------------------------------------------
check_dir "packages/@hum/audio-features"
check_dir "packages/@hum/quality-gate"
check_dir "packages/@hum/personalization-engine"
check_dir "packages/@hum/fusion-engine"
check_dir "packages/@hum/relapse-engine"
check_dir "packages/@hum/intervention-engine"
check_dir "packages/@hum/dataset-registry"
check_dir "packages/@hum/shared-types"

# -----------------------------------------------
echo ""
echo "-- ADRs --"
# -----------------------------------------------
ADR_DIR="docs/adr"
check_dir "$ADR_DIR"
check_grep_warn "TriSense\|trisense\|triSense" "$ADR_DIR" "ADR mentions TriSense"
check_grep_warn "MELD.*not.*Hum\|not.*benchmark\|reference.*figure\|MELD accuracy\|architecture.*reference" "$ADR_DIR" "ADR: MELD numbers ≠ Hum benchmarks"
check_grep_warn "FER.*drop\|drop.*FER\|no.*camera\|camera.*removed" "$ADR_DIR" "ADR: FER stream dropped"
check_grep_warn "domain.gap\|domain gap\|hum.*speech.*gap\|speech.*hum.*gap" "$ADR_DIR" "ADR: domain gap documented"
check_grep_warn "confidence.*cap\|72.*76.*82\|maturity.*cap\|cap.*maturity" "$ADR_DIR" "ADR: confidence caps documented"
check_grep_warn "raw.audio.*not.*upload\|audio.*forbidden\|forbidden.*audio\|local.first\|local first" "$ADR_DIR" "ADR: privacy/raw audio policy"

# -----------------------------------------------
echo ""
echo "-- Shared types --"
# -----------------------------------------------
TYPES_DIR="packages/@hum/shared-types"
check_grep "AudioFeatures" "$TYPES_DIR" "AudioFeatures type"
check_grep "QualityGateResult\|quality.*gate.*result\|captureQuality" "$TYPES_DIR" "QualityGateResult type"
check_grep "BaselineStats\|baseline.*stats\|robustStd" "$TYPES_DIR" "BaselineStats type"
check_grep "EmotionOutput\|emotion.*output\|valence.*arousal\|ValenceArousal" "$TYPES_DIR" "EmotionOutput type"
check_grep "FusionInput\|fusion.*input" "$TYPES_DIR" "FusionInput type"
check_grep "FusionOutput\|fusion.*output" "$TYPES_DIR" "FusionOutput type"
check_grep "TrendClass\|TrendOutput\|trend.*class\|significant_improvement\|significant_change" "$TYPES_DIR" "TrendClass / TrendOutput type"
check_grep "StateLabelOutput\|state.*label\|dimensionScores" "$TYPES_DIR" "StateLabelOutput type"
check_grep "ForbiddenAudioFields\|forbidden.*audio\|audio.*forbidden" "$TYPES_DIR" "ForbiddenAudioFields type guard"
check_grep "PersonalizationTier\|personalization.*tier\|population_prior\|baseline_active" "$TYPES_DIR" "PersonalizationTier enum"
check_grep "DatasetEntry\|dataset.*entry\|domain_gap_to_hum\|confidence_penalty" "$TYPES_DIR" "DatasetEntry type"

# -----------------------------------------------
echo ""
echo "-- Audio features --"
# -----------------------------------------------
AUDIO_DIR="packages/@hum/audio-features"
check_grep "0.82\|gain.*0\.82\|0\.82.*peak" "$AUDIO_DIR" "Gain normalization 0.82"
check_grep "0\.3.*Fs\|Fs.*0\.3\|edge.*trim\|trim.*edge" "$AUDIO_DIR" "Edge trim 0.3 × Fs"
check_grep "0\.080\|80.*ms\|frameSize.*80\|80ms" "$AUDIO_DIR" "80ms RMS frame size"
check_grep "noiseFloor\|noise.*floor\|floor.*noise" "$AUDIO_DIR" "Noise floor"
check_grep "activeThreshold\|active.*threshold\|3\.2" "$AUDIO_DIR" "Active threshold (3.2 factor)"
check_grep "2048.*hop\|hop.*1024\|1024.*hop\|pitch.*frame.*2048\|2048.*pitch" "$AUDIO_DIR" "Pitch frame 2048 / hop 1024"
check_grep "Fs.*420\|420.*Fs\|minLag\|maxLag\|75.*Fs\|Fs.*75" "$AUDIO_DIR" "Pitch lag range (Fs/420 to Fs/75)"
check_grep "jitter\|shimmer\|hnrProxy\|snrProxy" "$AUDIO_DIR" "jitter/shimmer/hnrProxy/snrProxy"
check_grep "vibratoScore\|vibrato.*score" "$AUDIO_DIR" "vibratoScore"
check_grep "glideScore\|glide.*score" "$AUDIO_DIR" "glideScore"
check_grep "webm.*opus\|audio\/webm.*codecs.*opus\|MIME.*priority\|mime.*candidate" "$AUDIO_DIR" "MIME type priority"
check_grep_warn "echoCancellation.*false\|noiseSuppression.*false\|autoGainControl.*false" "$AUDIO_DIR" "MediaConstraints all-false preferred"

# -----------------------------------------------
echo ""
echo "-- Quality gate --"
# -----------------------------------------------
GATE_DIR="packages/@hum/quality-gate"
check_grep "duration.*<.*8\|8.*duration\|min.*8.*s\|minDuration\|8 second" "$GATE_DIR" "Min duration 8s gate"
check_grep "clippedFrame.*0\.08\|0\.08.*clipped\|clipping.*threshold" "$GATE_DIR" "Clipped frame ratio 0.08 gate"
check_grep "silenceRatio.*0\.72\|0\.72.*silence\|0\.72" "$GATE_DIR" "Silence ratio 0.72 gate"
check_grep "pitchCoverage.*0\.35\|0\.35.*pitch\|0\.35" "$GATE_DIR" "Pitch coverage 0.35 gate"
check_grep "soft_usable\|softUsable" "$GATE_DIR" "soft_usable quality tier"
check_grep "borderline\|rejected\|clean" "$GATE_DIR" "QualityGate decision enum values"

# -----------------------------------------------
echo ""
echo "-- Personalization engine --"
# -----------------------------------------------
PERS_DIR="packages/@hum/personalization-engine"
check_grep "1\.4826\|MAD.*1\.4826\|robustStd" "$PERS_DIR" "robustStd = MAD × 1.4826"
check_grep "zDelta\|z.*delta\|z_delta" "$PERS_DIR" "zDelta formula"
check_grep "24.*window\|window.*24\|rolling.*24\|24.*hum" "$PERS_DIR" "Rolling 24-hum window"
check_grep "5.*eligible\|eligible.*5\|baseline.*activ\|activ.*baseline" "$PERS_DIR" "Baseline activation at 5 hums"
check_grep "outlier.*2\.5\|2\.5.*outlier\|weight.*0\.25\|0\.25.*weight" "$PERS_DIR" "Outlier adjustment 2.5× factor"
check_grep "0\.85\|neutral.*band\|neutralBand" "$PERS_DIR" "Neutral band 0.85"
check_grep "0\.34\|clearThreshold\|clear.*threshold\|threshold.*0\.34" "$PERS_DIR" "Dimension clear threshold 0.34"
check_grep "0\.12\|gap.*runner\|runner.*gap\|gap.*0\.12" "$PERS_DIR" "Gap from runner-up ≥ 0.12"

# -----------------------------------------------
echo ""
echo "-- Confidence model --"
# -----------------------------------------------
check_grep "baselineMaturity\|baseline.*maturity\|maturity.*baseline" "$PERS_DIR" "baselineMaturity component"
check_grep "0\.45\|0\.52\|0\.66\|0\.78\|0\.90" "$PERS_DIR" "Maturity level values (0.45/0.52/0.66/0.78/0.90)"
check_grep "musicalityConflict\|musicality.*conflict" "$PERS_DIR" "musicalityConflict factor"
FUSION_DIR="packages/@hum/fusion-engine"
check_grep "72\|76\|82\|88\|90\|cap\|Cap" "$FUSION_DIR" "Confidence caps in fusion engine"

# -----------------------------------------------
echo ""
echo "-- Fusion engine --"
# -----------------------------------------------
check_grep "late.*fusion\|lateFusion\|late_fusion" "$FUSION_DIR" "Late fusion architecture"
check_grep "LogisticRegression\|logistic.*regression\|logistic_regression\|meta.*learner\|metaLearner" "$FUSION_DIR" "LR meta-learner"
check_grep "FER.*null\|null.*FER\|optional.*FER\|FER.*optional" "$FUSION_DIR" "FER is optional/null"
check_grep "valence\|arousal\|ValenceArousal\|valence_arousal" "$FUSION_DIR" "V-A output in fusion"

# -----------------------------------------------
echo ""
echo "-- Relapse engine --"
# -----------------------------------------------
RELAPSE_DIR="packages/@hum/relapse-engine"
check_dir "$RELAPSE_DIR"
check_grep "20.*hum\|hum.*20\|personalized_fusion\|mature.*tier" "$RELAPSE_DIR" "Relapse activates at 20+ hums"
check_grep "significant_improvement\|significant_change\|mild_improvement\|mild_change\|unchanged" "$RELAPSE_DIR" "5-class TrendClass"
check_grep_warn "WavLM\|wavlm\|wav.*lm" "$RELAPSE_DIR" "WavLM upgrade path noted"

# -----------------------------------------------
echo ""
echo "-- Intervention engine --"
# -----------------------------------------------
INT_DIR="packages/@hum/intervention-engine"
check_dir "$INT_DIR"
check_grep "valence\|arousal\|russell\|circumplex\|ValenceArousal\|VA.*map\|map.*VA" "$INT_DIR" "V-A to music mapping"
check_grep_warn "60.*80.*bpm\|bpm.*60.*80\|slow.*tempo\|tempo.*slow" "$INT_DIR" "Slow tempo (60-80 BPM) preference"

# -----------------------------------------------
echo ""
echo "-- Privacy / security --"
# -----------------------------------------------
check_grep "ForbiddenAudioFields\|forbidden.*audio\|audio.*forbidden" "packages/@hum/shared-types" "ForbiddenAudioFields type guard"
check_grep "rawAudio\|audioBlob\|audioBuffer\|audioBase64\|waveformRaw" "packages/@hum/shared-types" "Forbidden field list in type guard"

# -----------------------------------------------
echo ""
echo "-- Dataset registry --"
# -----------------------------------------------
DS_DIR="packages/@hum/dataset-registry"
check_dir "$DS_DIR"
check_grep "meld\|MELD" "$DS_DIR" "MELD entry in registry"
check_grep "dvdsa\|DVDSA\|kim.*2026\|Kim.*2026" "$DS_DIR" "DVDSA entry in registry"
check_grep "ravdess\|RAVDESS" "$DS_DIR" "RAVDESS entry in registry"
check_grep "domain_gap_to_hum\|domain.*gap.*hum\|gap.*hum" "$DS_DIR" "domain_gap_to_hum field"
check_grep "confidence_penalty\|confidence.*penalty" "$DS_DIR" "confidence_penalty field"
check_grep "prohibited_model_uses\|prohibited.*uses\|not.*benchmark\|MELD.*not.*Hum\|benchmark.*MELD" "$DS_DIR" "MELD prohibited use (≠ Hum benchmark)"

# -----------------------------------------------
echo ""
echo "== SUMMARY =="
echo "  PASS: $PASS"
echo "  WARN: $WARN"
echo "  FAIL: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "RESULT: FAIL ($FAIL failing checks — main session has gaps to patch)"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "RESULT: WARN ($WARN warnings — review before proceeding)"
  exit 0
else
  echo "RESULT: PASS — main foundation looks complete"
  exit 0
fi
