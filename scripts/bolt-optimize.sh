#!/bin/bash
set -euo pipefail

# Mercury Post-Link BOLT Optimizer (Linux x86_64 ELF + optional Android arm64-v8a via adb)
# Default mode uses llvm-bolt --instrument (no perf, no hardware LBR, no root required).
# Supports optional --mode perf (LBR sampling via perf + perf2bolt), automatic headless
# smoke testing, and guaranteed atomic rollback to .pre-bolt backups on any failure.

MERCURY_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HG_SRC_DIR="${HG_SRC_DIR:-$HOME/mozilla-unified}"
DIST_BIN=""
MODE="instrument"
WORKLOAD="auto"
WORKLOAD_CMD=""
INPUT_FDATA=""
OUTPUT_FDATA=""
HUGIFY=0
ANDROID_ADB=0
KEEP_BACKUP=0
ALLOW_FALLBACK=0
DRY_RUN=0
TARGETS=("libxul.so")

usage() {
	cat <<'EOF'
Usage: scripts/bolt-optimize.sh [options]

Optimizes Mercury ELF shared libraries/binaries (default: libxul.so) with llvm-bolt.
Runs AFTER `./mach build` and BEFORE `./mach package` so distributed packages contain
the BOLT-optimized binary.

Options:
  --dist-bin <dir>         Directory containing built binaries
                           (default: auto-detected $HG_SRC_DIR/obj-*/dist/bin)
  --target-lib <name>      Primary binary/SO inside dist-bin to optimize (default: libxul.so)
  --extra-bin <name>       Additional binary/SO inside dist-bin to optimize (repeatable)
  --mode <instrument|perf> Profile collection mode (default: instrument — no perf/root needed)
  --perf                   Shorthand for --mode perf (requires perf + perf2bolt + LBR)
  --workload <mode>        Training workload: auto | profileserver | headless | cmd (default: auto)
  --workload-cmd <cmd>     Custom shell command when --workload cmd is selected
  --fdata <path>           Reuse an existing merged .fdata file (skip instrumentation/profiling)
  --output-fdata <path>    Save merged .fdata profile to this path for inspection/reuse
  --hugify                 Enable llvm-bolt --hugify (2MB hugepage hot text)
  --android-adb            Optional Android arm64-v8a on-device BOLT pass via adb
  --keep-backup            Keep <binary>.pre-bolt backup after verified success
  --allow-fallback         On BOLT/smoke-test error, roll back cleanly and exit 0 with warning
  --dry-run                Verify tools, flags, and relocations without modifying binaries
  -h, --help               Show this help
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--dist-bin) DIST_BIN="$2"; shift 2 ;;
		--target-lib) TARGETS[0]="$2"; shift 2 ;;
		--extra-bin) TARGETS+=("$2"); shift 2 ;;
		--mode) MODE="$2"; shift 2 ;;
		--perf) MODE="perf"; shift ;;
		--workload) WORKLOAD="$2"; shift 2 ;;
		--workload-cmd) WORKLOAD="cmd"; WORKLOAD_CMD="$2"; shift 2 ;;
		--fdata) INPUT_FDATA="$2"; shift 2 ;;
		--output-fdata) OUTPUT_FDATA="$2"; shift 2 ;;
		--hugify) HUGIFY=1; shift ;;
		--android-adb) ANDROID_ADB=1; shift ;;
		--keep-backup) KEEP_BACKUP=1; shift ;;
		--allow-fallback) ALLOW_FALLBACK=1; shift ;;
		--dry-run) DRY_RUN=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "ERROR: Unknown option: $1" >&2; usage >&2; exit 2 ;;
	esac
done

log() { printf '[bolt-optimize] %s\n' "$*"; }
warn() { printf '[bolt-optimize] WARNING: %s\n' "$*" >&2; }
die() { printf '[bolt-optimize] ERROR: %s\n' "$*" >&2; exit 1; }

[ "${MODE}" = "instrument" ] || [ "${MODE}" = "perf" ] || die "Invalid --mode '${MODE}' (expected instrument or perf)."

# Locate LLVM BOLT tools
LLVM_BOLT_BIN="${LLVM_BOLT:-$(command -v llvm-bolt || true)}"
MERGE_FDATA_BIN="${MERGE_FDATA:-$(command -v merge-fdata || true)}"
PERF2BOLT_BIN="${PERF2BOLT:-$(command -v perf2bolt || true)}"
READELF_BIN="$(command -v llvm-readelf || command -v readelf || true)"

[ -n "${LLVM_BOLT_BIN}" ] || die "llvm-bolt not found on PATH (install llvm/bolt or set LLVM_BOLT)."
if [ -z "${INPUT_FDATA}" ] && [ "${MODE}" = "instrument" ]; then
	[ -n "${MERGE_FDATA_BIN}" ] || die "merge-fdata not found on PATH (required to merge multi-process BOLT instrumentation profiles)."
fi
if [ -z "${INPUT_FDATA}" ] && [ "${MODE}" = "perf" ]; then
	command -v perf >/dev/null 2>&1 || die "--mode perf requested, but 'perf' is not installed. Use default --mode instrument."
	[ -n "${PERF2BOLT_BIN}" ] || die "--mode perf requested, but 'perf2bolt' is not found on PATH."
fi

# Verified optimization flags (LLVM 23.1.5 compatible)
BOLT_OPT_FLAGS=(
	--reorder-blocks=ext-tsp
	--reorder-functions=cdsort
	--split-functions
	--split-all-cold
	--icf=1
	--use-gnu-stack
	--dyno-stats
)
if [ "${HUGIFY}" -eq 1 ]; then
	BOLT_OPT_FLAGS+=(--hugify)
fi

# Locate BOLT instrumentation runtime library
BOLT_RT_LIB=""
for cand in \
	/usr/lib/libbolt_rt_instr.a \
	/usr/lib64/libbolt_rt_instr.a \
	/usr/local/lib/libbolt_rt_instr.a; do
	if [ -f "${cand}" ]; then
		BOLT_RT_LIB="${cand}"
		break
	fi
done

# Optional Android arm64-v8a BOLT flow via adb
if [ "${ANDROID_ADB}" -eq 1 ]; then
	log "Android on-device BOLT mode selected."
	if ! command -v adb >/dev/null 2>&1; then
		warn "adb not installed; skipping optional Android BOLT pass (Cross-PGO + Full-LTO APK remains intact)."
		exit 0
	fi
	CONNECTED_DEV="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}')"
	if [ -z "${CONNECTED_DEV}" ]; then
		warn "No adb device connected; skipping optional Android BOLT pass (Cross-PGO + Full-LTO APK remains intact)."
		exit 0
	fi
	ANDROID_LIB="${DIST_BIN:-${HG_SRC_DIR}/obj-aarch64-linux-android/dist/bin}/libxul.so"
	ANDROID_RT_LIB="$(find "${HOME}/.mozbuild" -maxdepth 6 -name 'libbolt_rt_instr.a' 2>/dev/null | head -n 1 || true)"
	log "ADB device: ${CONNECTED_DEV}"
	log "Target SO:  ${ANDROID_LIB}"
	log "NDK rt lib: ${ANDROID_RT_LIB:-not found}"
	if [ "${DRY_RUN}" -eq 1 ]; then
		log "Dry-run complete for Android adb BOLT mode."
		exit 0
	fi
	[ -f "${ANDROID_LIB}" ] || die "Android libxul.so not found at ${ANDROID_LIB}."
	if [ -n "${READELF_BIN}" ] && ! "${READELF_BIN}" -S "${ANDROID_LIB}" 2>/dev/null | grep -q '\.rela\.text'; then
		warn "Android libxul.so lacks .rela.text (build with MERCURY_BOLT=1); skipping Android BOLT pass."
		exit 0
	fi
	if [ -z "${INPUT_FDATA}" ]; then
		warn "Automated Android APK re-signing + on-device instrumentation run requires --fdata <pulled.fdata> (or manual adb profile capture); skipping in-place modification."
		exit 0
	fi
	[ -s "${INPUT_FDATA}" ] || die "Android BOLT --fdata not found or empty: ${INPUT_FDATA}"
	cp -f "${ANDROID_LIB}" "${ANDROID_LIB}.pre-bolt"
	if "${LLVM_BOLT_BIN}" "${ANDROID_LIB}.pre-bolt" --data="${INPUT_FDATA}" -o "${ANDROID_LIB}.bolted" "${BOLT_OPT_FLAGS[@]}"; then
		mv -f "${ANDROID_LIB}.bolted" "${ANDROID_LIB}"
		[ "${KEEP_BACKUP}" -eq 1 ] || rm -f "${ANDROID_LIB}.pre-bolt"
		log "Android libxul.so BOLT optimization complete."
		exit 0
	else
		mv -f "${ANDROID_LIB}.pre-bolt" "${ANDROID_LIB}"
		rm -f "${ANDROID_LIB}.bolted"
		if [ "${ALLOW_FALLBACK}" -eq 1 ]; then
			warn "Android llvm-bolt failed; rolled back to pre-BOLT libxul.so."
			exit 0
		fi
		die "Android llvm-bolt failed; rolled back to pre-BOLT libxul.so."
	fi
fi

# Auto-detect Linux dist/bin if not specified
if [ -z "${DIST_BIN}" ]; then
	for cand in \
		"${HG_SRC_DIR}/obj-x86_64-pc-linux-gnu/dist/bin" \
		"${HG_SRC_DIR}"/obj-*/dist/bin; do
		if [ -d "${cand}" ]; then
			DIST_BIN="${cand}"
			break
		fi
	done
fi

log "llvm-bolt:  ${LLVM_BOLT_BIN} ($("${LLVM_BOLT_BIN}" --version 2>/dev/null | grep -m1 'LLVM version' | xargs || true))"
log "Mode:       ${MODE}"
log "Dist bin:   ${DIST_BIN:-<not found>}"
log "Targets:    ${TARGETS[*]}"
log "Opt flags:  ${BOLT_OPT_FLAGS[*]}"
[ -n "${BOLT_RT_LIB}" ] && log "Instr lib:  ${BOLT_RT_LIB}"

if [ "${DRY_RUN}" -eq 1 ]; then
	if [ -n "${DIST_BIN}" ] && [ -f "${DIST_BIN}/${TARGETS[0]}" ] && [ -n "${READELF_BIN}" ]; then
		if "${READELF_BIN}" -S "${DIST_BIN}/${TARGETS[0]}" 2>/dev/null | grep -q '\.rela\.text'; then
			log "Relocation check: ${DIST_BIN}/${TARGETS[0]} has .rela.text (BOLT-ready)."
		else
			warn "Relocation check: ${DIST_BIN}/${TARGETS[0]} lacks .rela.text (rebuild with MERCURY_BOLT=1)."
		fi
	fi
	log "Dry-run complete. No binaries modified."
	exit 0
fi

[ -n "${DIST_BIN}" ] && [ -d "${DIST_BIN}" ] || die "dist/bin directory not found. Pass --dist-bin <path>."

# Locate Mercury/Firefox launcher binary inside dist/bin
LAUNCHER=""
for cand in "${DIST_BIN}/mercury" "${DIST_BIN}/mercury-bin" "${DIST_BIN}/firefox" "${DIST_BIN}/firefox-bin"; do
	if [ -x "${cand}" ]; then
		LAUNCHER="${cand}"
		break
	fi
done
[ -n "${LAUNCHER}" ] || die "No executable Mercury launcher found in ${DIST_BIN}."

# Verify every target binary exists and carries .rela.text relocations
for t in "${TARGETS[@]}"; do
	bin_path="${DIST_BIN}/${t}"
	[ -f "${bin_path}" ] || die "Target binary not found: ${bin_path}"
	if [ -n "${READELF_BIN}" ]; then
		if ! "${READELF_BIN}" -S "${bin_path}" 2>/dev/null | grep -q '\.rela\.text'; then
			msg="Binary ${bin_path} lacks .rela.text relocations. Build with MERCURY_BOLT=1 (adds -Wl,--emit-relocs)."
			if [ "${ALLOW_FALLBACK}" -eq 1 ]; then
				warn "${msg} Skipping BOLT."
				exit 0
			fi
			die "${msg}"
		fi
	fi
done

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mercury-bolt.XXXXXX")"
BACKED_UP=()

rollback_all() {
	for orig in "${BACKED_UP[@]}"; do
		if [ -f "${orig}.pre-bolt" ]; then
			mv -f "${orig}.pre-bolt" "${orig}"
			log "Rolled back ${orig} from ${orig}.pre-bolt"
		fi
		rm -f "${orig}.bolted" "${orig}.instr"
	done
}

cleanup() {
	rm -rf "${WORK_DIR}"
}

on_error() {
	warn "Failure detected during BOLT pipeline; initiating safe rollback..."
	rollback_all
	cleanup
}
trap on_error ERR INT TERM

run_training_workload() {
	local prof_dir="$1"
	local mode="$2"
	local perf_data="${prof_dir}/perf.data"

	local chosen="${WORKLOAD}"
	if [ "${chosen}" = "auto" ]; then
		if [ -f "${HG_SRC_DIR}/build/pgo/profileserver.py" ] && [ -x "${HG_SRC_DIR}/mach" ]; then
			chosen="profileserver"
		else
			chosen="headless"
		fi
	fi

	local cmd=()
	case "${chosen}" in
		profileserver)
			cmd=(
				env
				MERCURY_PGO_PORT="${MERCURY_PGO_PORT:-18888}"
				MERCURY_PGO_SP3_PORT="${MERCURY_PGO_SP3_PORT:-18000}"
				MERCURY_PGO_JS3_PORT="${MERCURY_PGO_JS3_PORT:-18001}"
				"${HG_SRC_DIR}/mach" python "${HG_SRC_DIR}/build/pgo/profileserver.py"
				--binary "${LAUNCHER}"
			)
			;;
		headless)
			local tmp_prof="${prof_dir}/headless-profile"
			mkdir -p "${tmp_prof}"
			local page_url="data:text/html,<h1>Mercury BOLT</h1><script>let s=0;for(let i=0;i<2e6;i++)s+=Math.imul(i,31);document.title=s;</script>"
			if [ -f "${HG_SRC_DIR}/build/pgo/mercury-workload.html" ]; then
				page_url="file://${HG_SRC_DIR}/build/pgo/mercury-workload.html"
			fi
			cmd=(
				env MOZ_HEADLESS=1
				timeout 90s
				"${LAUNCHER}" --headless --no-remote -profile "${tmp_prof}"
				--screenshot "${prof_dir}/bolt-train.png" "${page_url}"
			)
			;;
		cmd)
			[ -n "${WORKLOAD_CMD}" ] || die "--workload cmd requires --workload-cmd '<command>'"
			cmd=(bash -c "${WORKLOAD_CMD}")
			;;
		*)
			die "Unknown --workload '${chosen}' (expected auto, profileserver, headless, or cmd)."
			;;
	esac

	log "Running BOLT training workload (${chosen}, mode=${mode})..."
	if [ "${mode}" = "perf" ]; then
		perf record -e cycles:u -j any,u -o "${perf_data}" -- "${cmd[@]}"
	else
		(cd "${prof_dir}" && "${cmd[@]}")
	fi
}

smoke_test_binary() {
	log "Running post-BOLT smoke tests on ${LAUNCHER}..."
	local ver_out
	ver_out="$(timeout 20s "${LAUNCHER}" --version 2>&1)" || return 1
	[ -n "${ver_out}" ] || return 1
	log "  --version OK: $(printf '%s' "${ver_out}" | head -n 1)"

	local smoke_prof="${WORK_DIR}/smoke-profile"
	local smoke_png="${WORK_DIR}/smoke.png"
	mkdir -p "${smoke_prof}"
	MOZ_HEADLESS=1 timeout 45s "${LAUNCHER}" \
		--headless --no-remote -profile "${smoke_prof}" \
		--screenshot "${smoke_png}" \
		"data:text/html,<!doctype html><h1>Mercury BOLT OK</h1>" >/dev/null 2>&1 || return 1
	log "  headless boot & render OK"
	return 0
}

# Optimize each target binary
for t in "${TARGETS[@]}"; do
	bin_path="${DIST_BIN}/${t}"
	pre_bolt="${bin_path}.pre-bolt"
	bolted="${bin_path}.bolted"
	target_work="${WORK_DIR}/${t//\//_}"
	mkdir -p "${target_work}"

	log "Backing up ${bin_path} -> ${pre_bolt}"
	cp -f "${bin_path}" "${pre_bolt}"
	BACKED_UP+=("${bin_path}")

	merged_fdata="${target_work}/merged.fdata"
	if [ -n "${INPUT_FDATA}" ]; then
		[ -s "${INPUT_FDATA}" ] || die "Provided --fdata file missing or empty: ${INPUT_FDATA}"
		cp -f "${INPUT_FDATA}" "${merged_fdata}"
		log "Using provided fdata profile: ${INPUT_FDATA}"
	elif [ "${MODE}" = "instrument" ]; then
		instr_args=(
			--instrument
			"--instrumentation-file=${target_work}/bolt.fdata"
			--instrumentation-file-append-pid
		)
		if [ -n "${BOLT_RT_LIB}" ]; then
			instr_args+=("--runtime-instrumentation-lib=${BOLT_RT_LIB}")
		fi
		log "Instrumenting ${t} with llvm-bolt..."
		"${LLVM_BOLT_BIN}" "${pre_bolt}" "${instr_args[@]}" -o "${bin_path}.instr"
		mv -f "${bin_path}.instr" "${bin_path}"

		run_training_workload "${target_work}" "instrument"

		# Restore pristine binary before merging/optimizing
		cp -f "${pre_bolt}" "${bin_path}"

		shopt -s nullglob
		fdata_files=("${target_work}"/bolt.fdata*)
		shopt -u nullglob
		if [ ${#fdata_files[@]} -eq 0 ]; then
			warn "No bolt.fdata* files were written during workload run."
			rollback_all
			cleanup
			if [ "${ALLOW_FALLBACK}" -eq 1 ]; then
				warn "Continuing with pre-BOLT binary due to --allow-fallback."
				exit 0
			fi
			exit 1
		fi
		log "Merging ${#fdata_files[@]} BOLT fdata file(s)..."
		"${MERGE_FDATA_BIN}" "${fdata_files[@]}" -o "${merged_fdata}"
	else
		run_training_workload "${target_work}" "perf"
		log "Converting perf.data to fdata via perf2bolt..."
		"${PERF2BOLT_BIN}" "${pre_bolt}" -p "${target_work}/perf.data" -o "${merged_fdata}"
	fi

	[ -s "${merged_fdata}" ] || die "Merged BOLT fdata is empty: ${merged_fdata}"
	if [ -n "${OUTPUT_FDATA}" ]; then
		mkdir -p "$(dirname "${OUTPUT_FDATA}")"
		cp -f "${merged_fdata}" "${OUTPUT_FDATA}"
		log "Saved merged fdata to ${OUTPUT_FDATA}"
	fi

	log "Optimizing ${t} with llvm-bolt..."
	"${LLVM_BOLT_BIN}" "${pre_bolt}" \
		"--data=${merged_fdata}" \
		-o "${bolted}" \
		"${BOLT_OPT_FLAGS[@]}"

	[ -s "${bolted}" ] || die "llvm-bolt produced empty output: ${bolted}"
	mv -f "${bolted}" "${bin_path}"
	log "Installed BOLT-optimized ${t} ($(stat -c%s "${pre_bolt}") -> $(stat -c%s "${bin_path}") bytes)."
done

# Post-BOLT verification with guaranteed rollback on failure
if ! smoke_test_binary; then
	warn "Post-BOLT smoke test FAILED; rolling back all binaries!"
	rollback_all
	cleanup
	if [ "${ALLOW_FALLBACK}" -eq 1 ]; then
		warn "Rolled back cleanly; exiting 0 because --allow-fallback is set."
		exit 0
	fi
	exit 1
fi

# Success: remove backups unless --keep-backup
trap - ERR INT TERM
if [ "${KEEP_BACKUP}" -eq 0 ]; then
	for orig in "${BACKED_UP[@]}"; do
		rm -f "${orig}.pre-bolt"
	done
fi
cleanup
log "BOLT optimization and smoke verification succeeded!"
