#!/usr/bin/env bash
# CHECK_ACCEPTANCE_CRITERIA.sh
# Hum v2 Foundation — Read-only acceptance criteria check
# Run from the project root: bash parallel-agent-review/CHECK_ACCEPTANCE_CRITERIA.sh
#
# Exit codes: 0 = all PASS, 1 = at least one FAIL, 2 = script error
# This script does NOT modify any files.

set -euo pipefail

PASS=0
WARN=0
FAIL=0
FAIL_ITEMS=()
WARN_ITEMS=()

pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
warn() { echo "  WARN  $1"; WARN=$((WARN + 1)); WARN_ITEMS+=("$1"); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); FAIL_ITEMS+=("$1"); }

check_file_exists() {
  local label="$1"
  local path="$2"
  local min_bytes="${3:-0}"

  if [ ! -f "$path" ]; then
    fail "$label — file absent: $path"
    return
  fi

  local size
  size=$(wc -c < "$path" 2>/dev/null || echo 0)
  if [ "$min_bytes" -gt 0 ] && [ "$size" -lt "$min_bytes" ]; then
    warn "$label — file present but suspiciously small (${size} bytes < ${min_bytes} min): $path"
    return
  fi

  pass "$label"
}

check_dir_exists() {
  local label="$1"
  local path="$2"
  local min_files="${3:-0}"

  if [ ! -d "$path" ]; then
    fail "$label — directory absent: $path"
    return
  fi

  if [ "$min_files" -gt 0 ]; then
    local count
    count=$(find "$path" -maxdepth 1 -type f | wc -l 2>/dev/null || echo 0)
    if [ "$count" -lt "$min_files" ]; then
      warn "$label — directory exists but has fewer than $min_files files ($count found): $path"
      return
    fi
  fi

  pass "$label"
}

check_file_contains() {
  local label="$1"
  local path="$2"
  local pattern="$3"

  if [ ! -f "$path" ]; then
    fail "$label — file absent: $path"
    return
  fi

  if grep -qi "$pattern" "$path" 2>/dev/null; then
    pass "$label"
  else
    warn "$label — file present but missing pattern \"$pattern\": $path"
  fi
}

check_file_not_contains() {
  local label="$1"
  local path="$2"
  local pattern="$3"

  if [ ! -f "$path" ]; then
    warn "$label — cannot check (file absent): $path"
    return
  fi

  if grep -qi "$pattern" "$path" 2>/dev/null; then
    fail "$label — file contains FORBIDDEN pattern \"$pattern\": $path"
  else
    pass "$label"
  fi
}

echo "========================================================"
echo " Hum v2 Foundation — Acceptance Criteria Check"
echo " Run from project root"
echo "========================================================"
echo ""

# ── SECTION 1: Architecture Documentation ────────────────────────────────────
echo "── SECTION 1: Architecture Documentation"

check_file_exists  "A01 TRISENSE_ADAPTED_ARCHITECTURE.md" \
  "docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md" 500

check_file_contains "A02 TriSense expert separation documented" \
  "docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md" \
  "expert"

check_file_contains "A03 Late fusion documented" \
  "docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md" \
  "late fusion\|logistic regression"

check_file_contains "A04 FER slot treatment documented" \
  "docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md" \
  "FER\|facial"

check_file_exists  "A07 HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md" \
  "docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md" 500

check_file_contains "A08 Hum vs speech domain distinction" \
  "docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md" \
  "speech_leak\|domain classifier\|native_hum"

check_file_contains "A09 Domain classifier specified" \
  "docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md" \
  "domain classifier\|DomainClassifier"

check_file_contains "A10 HumDomainAdapter specified" \
  "docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md" \
  "HumDomainAdapter\|domain adapter"

check_file_contains "A11 Public datasets-as-priors policy" \
  "docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md" \
  "prior\|not.*hum.*ground truth\|MELD"

check_file_exists  "A12 PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md" \
  "docs/architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md" 500

check_file_contains "A13 Dual baseline documented" \
  "docs/architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md" \
  "rolling.*baseline\|anchored.*baseline\|dual.*baseline"

check_file_contains "A14 Calibration ladder stages documented" \
  "docs/architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md" \
  "cold_start\|BaselineStage\|calibration ladder"

echo ""

# ── SECTION 2: Claims and Validation ─────────────────────────────────────────
echo "── SECTION 2: Claims and Validation"

check_file_exists  "C01 CLAIMS_LADDER.md" \
  "docs/claims/CLAIMS_LADDER.md" 300

check_file_contains "C02 MELD accuracy prohibition" \
  "docs/claims/CLAIMS_LADDER.md" \
  "MELD\|not.*claim.*accuracy\|forbidden"

check_file_contains "C03 Clinical AUC prohibition" \
  "docs/claims/CLAIMS_LADDER.md" \
  "AUC\|not.*claim\|speech.*accuracy\|domain gap"

check_file_not_contains "C06a Claims ladder doesn't use diagnosis language" \
  "docs/claims/CLAIMS_LADDER.md" \
  "diagnoses depression\|you have depression"

check_file_not_contains "C07a Claims ladder doesn't use 'prevents relapse'" \
  "docs/claims/CLAIMS_LADDER.md" \
  "prevents relapse"

check_file_contains "C07b Claims ladder uses 'monitoring' not 'prevention'" \
  "docs/claims/CLAIMS_LADDER.md" \
  "monitoring\|risk signal\|screening"

check_file_exists  "C08 VALIDATION_PLAN.md" \
  "docs/validation/VALIDATION_PLAN.md" 200

check_file_contains "C09 Evidence limitations acknowledged" \
  "docs/validation/VALIDATION_PLAN.md" \
  "bias\|limitation\|domain gap\|not validated"

echo ""

# ── SECTION 3: Privacy and Governance ────────────────────────────────────────
echo "── SECTION 3: Privacy and Governance"

check_file_exists  "P01 DATA_GOVERNANCE.md" \
  "docs/privacy/DATA_GOVERNANCE.md" 200

check_file_contains "P02 Raw audio blocked by default" \
  "docs/privacy/DATA_GOVERNANCE.md" \
  "raw audio\|forbidden.*field\|rawAudio"

check_file_contains "P03 Research audio opt-in gate" \
  "docs/privacy/DATA_GOVERNANCE.md" \
  "researchAudioUpload\|research.*audio.*opt.in\|consent"

check_file_contains "P05 Firestore derived-data-only" \
  "docs/privacy/DATA_GOVERNANCE.md" \
  "derived.*only\|Firestore\|forbidden.*field"

echo ""

# ── SECTION 4: Package Structure ─────────────────────────────────────────────
echo "── SECTION 4: Package Structure"

check_dir_exists   "PKG01 packages/shared-types" \
  "packages/shared-types" 1

# Check for BaselineStage enum
if [ -d "packages/shared-types" ]; then
  if grep -rq "BaselineStage" packages/shared-types/ 2>/dev/null; then
    pass "PKG02 BaselineStage enum in shared-types"
  else
    fail "PKG02 BaselineStage enum missing from packages/shared-types"
  fi
else
  fail "PKG02 BaselineStage enum — packages/shared-types absent"
fi

# Check FusionOutput fields
if [ -d "packages/shared-types" ] || [ -d "packages/affect-model-contracts" ]; then
  FUSION_SEARCH_PATH=""
  [ -d "packages/shared-types" ] && FUSION_SEARCH_PATH="packages/shared-types"
  [ -d "packages/affect-model-contracts" ] && FUSION_SEARCH_PATH="${FUSION_SEARCH_PATH} packages/affect-model-contracts"
  if grep -rq "abstain" $FUSION_SEARCH_PATH 2>/dev/null; then
    pass "PKG03a FusionOutput.abstain field present"
  else
    fail "PKG03a FusionOutput.abstain field missing"
  fi
  if grep -rq "topClassMargin" $FUSION_SEARCH_PATH 2>/dev/null; then
    pass "PKG03b FusionOutput.topClassMargin field present"
  else
    fail "PKG03b FusionOutput.topClassMargin field missing"
  fi
  if grep -rq "modalityAgreement" $FUSION_SEARCH_PATH 2>/dev/null; then
    pass "PKG03c FusionOutput.modalityAgreement field present"
  else
    fail "PKG03c FusionOutput.modalityAgreement field missing"
  fi
else
  fail "PKG03 FusionOutput fields — no relevant packages found"
fi

check_dir_exists   "PKG06 packages/dataset-registry" \
  "packages/dataset-registry" 1

check_dir_exists   "PKG08 packages/affect-model-contracts" \
  "packages/affect-model-contracts" 1

# Check multi-head affect contract
if [ -d "packages/affect-model-contracts" ]; then
  if grep -rq "valence\|dimensional" packages/affect-model-contracts/ 2>/dev/null; then
    pass "PKG09 Multi-head affect contract (dimensional) present"
  else
    warn "PKG09 Multi-head affect contract — no dimensional/valence fields found"
  fi
else
  fail "PKG09 Multi-head affect contract — packages/affect-model-contracts absent"
fi

check_dir_exists   "PKG10 packages/fusion-engine" \
  "packages/fusion-engine" 1

check_dir_exists   "PKG11 packages/personalization-engine" \
  "packages/personalization-engine" 1

check_dir_exists   "PKG12 packages/relapse-engine" \
  "packages/relapse-engine" 1

check_dir_exists   "PKG13 packages/safety-language" \
  "packages/safety-language" 1

# Check safety-language has checkSafetyLanguage function
if [ -d "packages/safety-language" ]; then
  if grep -rq "checkSafetyLanguage\|safetyLanguage" packages/safety-language/ 2>/dev/null; then
    pass "PKG13b checkSafetyLanguage function present in safety-language"
  else
    fail "PKG13b checkSafetyLanguage function missing from packages/safety-language"
  fi
else
  fail "PKG13b checkSafetyLanguage — packages/safety-language absent"
fi

check_dir_exists   "PKG14 packages/quality-gate" \
  "packages/quality-gate" 1

echo ""

# ── SECTION 5: ADRs ───────────────────────────────────────────────────────────
echo "── SECTION 5: ADRs"

check_dir_exists   "ADR01 docs/adr/ directory" \
  "docs/adr" 1

ADR_COUNT=$(find docs/adr -name "*.md" 2>/dev/null | wc -l || echo 0)
if [ "$ADR_COUNT" -ge 3 ]; then
  pass "ADR01b docs/adr/ has ≥3 ADR files ($ADR_COUNT found)"
elif [ "$ADR_COUNT" -ge 1 ]; then
  warn "ADR01b docs/adr/ has only $ADR_COUNT ADR file(s), expected ≥3"
else
  fail "ADR01b docs/adr/ has no ADR files"
fi

# Check for domain adaptation ADR
if grep -rql "domain\|hum.*speech\|HumDomainAdapter" docs/adr/ 2>/dev/null; then
  pass "ADR02 Domain adaptation ADR present"
else
  warn "ADR02 No ADR found for hum domain adaptation in docs/adr/"
fi

echo ""

# ── SECTION 6: Test Coverage ──────────────────────────────────────────────────
echo "── SECTION 6: Test Coverage"

# Search for test files anywhere in packages/ or tests/
find_test_pattern() {
  local label="$1"
  local pattern="$2"
  if grep -rql "$pattern" packages/ tests/ 2>/dev/null; then
    pass "$label"
  else
    fail "$label — no test found matching pattern: $pattern"
  fi
}

find_test_pattern "T01 Confidence cap schedule tests" \
  "confidence.*cap\|cap.*72\|cap.*76\|cap.*82\|cap.*88"

find_test_pattern "T02 Relapse hard cap test (88%)" \
  "relapse.*88\|88.*relapse\|hard.*cap.*relapse\|relapse.*confidence.*cap"

find_test_pattern "T04 Raw audio privacy throw-on-violation tests" \
  "rawAudio\|audioBlob\|forbidden.*field\|privacy.*throw"

find_test_pattern "T05 Safety language forbidden phrase tests" \
  "safety.*language\|forbidden.*phrase\|checkSafetyLanguage"

find_test_pattern "T06 Missing-modality fusion tests" \
  "missing.*modality\|null.*vector\|absent.*expert\|audio.*only.*fusion"

find_test_pattern "T07 Domain classifier tests" \
  "domain.*classif\|native_hum\|speech_leak"

echo ""

# ── SUMMARY ───────────────────────────────────────────────────────────────────
echo "========================================================"
echo " SUMMARY"
echo "========================================================"
echo "  PASS: $PASS"
echo "  WARN: $WARN"
echo "  FAIL: $FAIL"
echo ""

if [ ${#FAIL_ITEMS[@]} -gt 0 ]; then
  echo "FAIL items:"
  for item in "${FAIL_ITEMS[@]}"; do
    echo "  ✗ $item"
  done
  echo ""
fi

if [ ${#WARN_ITEMS[@]} -gt 0 ]; then
  echo "WARN items:"
  for item in "${WARN_ITEMS[@]}"; do
    echo "  ⚠ $item"
  done
  echo ""
fi

if [ "$FAIL" -eq 0 ]; then
  echo "STATUS: PASS — all acceptance criteria met (WARN items may still need attention)"
  exit 0
elif [ "$FAIL" -le 3 ]; then
  echo "STATUS: WARN — $FAIL FAIL item(s), within demo-ready threshold (≤3 FAILs)"
  echo "         Review FAIL items before demo. See RISK_REGISTER.md for mitigations."
  exit 1
else
  echo "STATUS: FAIL — $FAIL FAIL items exceed demo-ready threshold of 3"
  echo "         DO NOT proceed to demo. Run POST_FOUNDATION_INTEGRATION_PROMPT.md."
  exit 1
fi
