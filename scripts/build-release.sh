#!/bin/bash
set -euo pipefail

# Mercury Unified Multi-Platform Release Orchestrator (Approach A)
# Coordinates Profile-Once Cross-PGO + Full/Cross-LTO + BOLT + Packaging
# across Linux x86_64, Windows x86_64 cross-compile, and Android arm64-v8a.

MERCURY_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HG_SRC_DIR="${HG_SRC_DIR:-$HOME/mozilla-unified}"
TARGETS_CSV="linux,win,android"
PGO_PROFILE="${MERCURY_PGO_PROFILE:-}"
PGO_JARLOG="${MERCURY_PGO_JARLOG:-}"
NO_PGO=0
NO_BOLT=0
BOLT_MODE="instrument"
BOLT_HUGIFY=0
BOLT_ALLOW_FALLBACK=1
LTO_MODE="${MERCURY_LTO_MODE:-auto}"
FAST_BUILD=0
ANDROID_BOLT_ADB=0
SKIP_PACKAGE=0
JOBS=""
EXTENDED_CORPUS=""
DRY_RUN=0

usage() {
	cat <<'EOF'
Usage: scripts/build-release.sh [options]

Unified release builder for Mercury Browser across Linux x86_64, Windows x86_64
(cross-compiled from Linux), and Android arm64-v8a.

Options:
  --targets <csv>           Comma-separated target list: linux,win,android
                            (default: linux,win,android)
  --pgo-profile <path>      Reuse an existing merged.profdata (absolute or relative path)
  --pgo-jarlog <path>       Reuse an existing en-US.log jarlog (auto-detected next to profdata)
  --extended-corpus <dir>   Optional JetStream3 extended corpus for PGO profile generation
  --no-pgo                  Skip PGO generation and profile-use (keeps LTO)
  --no-bolt                 Skip post-link BOLT pass on Linux
  --bolt-mode <mode>        BOLT mode: instrument (default) | perf
  --bolt-hugify             Enable llvm-bolt --hugify on Linux libxul.so
  --bolt-strict             Fail entire release if BOLT fails (default: roll back & continue)
  --lto <mode>              LTO mode: auto (default) | cross,full | full | thin | off
  --fast                    Fast dev mode (MERCURY_FAST_BUILD=1; implies --no-pgo --no-bolt)
  --android-bolt-adb        Enable -Wl,--emit-relocs + optional adb BOLT pass on Android
  --skip-package            Build without running ./package.sh
  --jobs <N>                Parallel build jobs (MOZ_MAKE_FLAGS=-j<N>)
  --dry-run                 Validate configuration and print exact build plan
  -h, --help                Show this help
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--targets) TARGETS_CSV="$2"; shift 2 ;;
		--pgo-profile) PGO_PROFILE="$2"; shift 2 ;;
		--pgo-jarlog) PGO_JARLOG="$2"; shift 2 ;;
		--extended-corpus) EXTENDED_CORPUS="$2"; shift 2 ;;
		--no-pgo) NO_PGO=1; shift ;;
		--no-bolt) NO_BOLT=1; shift ;;
		--bolt-mode) BOLT_MODE="$2"; shift 2 ;;
		--bolt-hugify) BOLT_HUGIFY=1; shift ;;
		--bolt-strict) BOLT_ALLOW_FALLBACK=0; shift ;;
		--lto) LTO_MODE="$2"; shift 2 ;;
		--fast) FAST_BUILD=1; NO_PGO=1; NO_BOLT=1; shift ;;
		--android-bolt-adb) ANDROID_BOLT_ADB=1; shift ;;
		--skip-package) SKIP_PACKAGE=1; shift ;;
		--jobs) JOBS="$2"; shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "ERROR: Unknown option: $1" >&2; usage >&2; exit 2 ;;
	esac
done

log() { printf '[build-release] %s\n' "$*"; }
warn() { printf '[build-release] WARNING: %s\n' "$*" >&2; }
die() { printf '[build-release] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "${HG_SRC_DIR}/mach" ] || die "${HG_SRC_DIR} is not a Firefox source checkout (missing ./mach)."
export HG_SRC_DIR

if [ -n "${JOBS}" ]; then
	export MOZ_MAKE_FLAGS="-j${JOBS}"
fi

# Parse and validate requested targets
IFS=',' read -r -a RAW_TARGETS <<< "${TARGETS_CSV}"
TARGETS=()
for t in "${RAW_TARGETS[@]}"; do
	case "${t}" in
		linux|linux-avx2) TARGETS+=("linux") ;;
		win|windows|win-cross|win-avx2-cross) TARGETS+=("win") ;;
		android|android-arm64) TARGETS+=("android") ;;
		"") ;;
		*) die "Unknown target '${t}'. Supported: linux, win, android." ;;
	esac
done
[ ${#TARGETS[@]} -gt 0 ] || die "No valid targets specified."

# Resolve PGO profile (generate once if not provided and PGO is enabled)
if [ "${FAST_BUILD}" -eq 1 ]; then
	export MERCURY_FAST_BUILD=1
	unset MERCURY_PGO_PROFILE || true
	unset MERCURY_PGO_JARLOG || true
else
	export MERCURY_FAST_BUILD=0
	if [ "${LTO_MODE}" != "auto" ]; then
		export MERCURY_LTO_MODE="${LTO_MODE}"
	else
		unset MERCURY_LTO_MODE || true
	fi

	if [ "${NO_PGO}" -eq 0 ]; then
		if [ -z "${PGO_PROFILE}" ]; then
			DEFAULT_PGO="${MERCURY_SRC_DIR}/build-artifacts/pgo/merged.profdata"
			log "No --pgo-profile specified; Stage 1 will generate ${DEFAULT_PGO}."
			if [ "${DRY_RUN}" -eq 1 ]; then
				"${MERCURY_SRC_DIR}/scripts/pgo-generate.sh" --dry-run \
					${EXTENDED_CORPUS:+--extended-corpus "${EXTENDED_CORPUS}"} \
					${JOBS:+--jobs "${JOBS}"}
				PGO_PROFILE="${DEFAULT_PGO}"
			else
				"${MERCURY_SRC_DIR}/scripts/pgo-generate.sh" \
					${EXTENDED_CORPUS:+--extended-corpus "${EXTENDED_CORPUS}"} \
					${JOBS:+--jobs "${JOBS}"}
				PGO_PROFILE="${DEFAULT_PGO}"
			fi
		fi

		if [ "${DRY_RUN}" -eq 0 ]; then
			[ -f "${PGO_PROFILE}" ] || die "PGO profile not found: ${PGO_PROFILE}"
			PGO_PROFILE="$(realpath "${PGO_PROFILE}")"
		else
			case "${PGO_PROFILE}" in
				/*) ;;
				*) PGO_PROFILE="$(pwd)/${PGO_PROFILE}" ;;
			esac
		fi
		export MERCURY_PGO_PROFILE="${PGO_PROFILE}"

		if [ -z "${PGO_JARLOG}" ]; then
			CAND_JARLOG="$(dirname "${PGO_PROFILE}")/en-US.log"
			[ -f "${CAND_JARLOG}" ] && PGO_JARLOG="${CAND_JARLOG}"
		fi
		if [ -n "${PGO_JARLOG}" ] && [ -f "${PGO_JARLOG}" ]; then
			export MERCURY_PGO_JARLOG="$(realpath "${PGO_JARLOG}")"
		fi
	else
		unset MERCURY_PGO_PROFILE || true
		unset MERCURY_PGO_JARLOG || true
	fi
fi

log "=== Mercury Release Plan ==="
log "Targets:      ${TARGETS[*]}"
log "Fast build:   ${FAST_BUILD}"
log "LTO mode:     ${MERCURY_LTO_MODE:-auto (cross,full -> full fallback)}"
log "PGO profile:  ${MERCURY_PGO_PROFILE:-<disabled>}"
log "PGO jarlog:   ${MERCURY_PGO_JARLOG:-<none>}"
log "Linux BOLT:   $([ "${NO_BOLT}" -eq 0 ] && echo "enabled (${BOLT_MODE})" || echo "disabled")"
log "Android BOLT: $([ "${ANDROID_BOLT_ADB}" -eq 1 ] && echo "optional via adb" || echo "disabled")"
log "Package:      $([ "${SKIP_PACKAGE}" -eq 0 ] && echo "yes" || echo "no")"

if [ "${DRY_RUN}" -eq 1 ]; then
	if [ "${NO_BOLT}" -eq 0 ]; then
		for t in "${TARGETS[@]}"; do
			if [ "${t}" = "linux" ]; then
				"${MERCURY_SRC_DIR}/scripts/bolt-optimize.sh" --mode "${BOLT_MODE}" --dry-run
			fi
		done
	fi
	log "Dry-run complete. No builds executed."
	exit 0
fi

ensure_rust_target() {
	local triple="$1"
	if command -v rustup >/dev/null 2>&1; then
		if ! rustup target list --installed 2>/dev/null | grep -qx "${triple}"; then
			log "Installing missing Rust target ${triple}..."
			rustup target add "${triple}"
		fi
	fi
}

BUILT_ARTIFACTS=()

build_linux() {
	log "=== [1/Linux] Building Mercury Linux x86_64 (x86-64-v3) ==="
	"${MERCURY_SRC_DIR}/setup.sh" --avx2
	local bolt_env=0
	[ "${NO_BOLT}" -eq 0 ] && bolt_env=1

	MERCURY_BOLT="${bolt_env}" "${MERCURY_SRC_DIR}/build.sh"

	if [ "${NO_BOLT}" -eq 0 ]; then
		local bolt_args=(
			--dist-bin "${HG_SRC_DIR}/obj-x86_64-pc-linux-gnu/dist/bin"
			--mode "${BOLT_MODE}"
		)
		[ "${BOLT_HUGIFY}" -eq 1 ] && bolt_args+=(--hugify)
		[ "${BOLT_ALLOW_FALLBACK}" -eq 1 ] && bolt_args+=(--allow-fallback)
		"${MERCURY_SRC_DIR}/scripts/bolt-optimize.sh" "${bolt_args[@]}"
	fi

	if [ "${SKIP_PACKAGE}" -eq 0 ]; then
		MERCURY_BOLT="${bolt_env}" "${MERCURY_SRC_DIR}/package.sh"
		for f in "${HG_SRC_DIR}"/obj-x86_64-pc-linux-gnu/dist/mercury-*.tar.xz; do
			[ -f "$f" ] && BUILT_ARTIFACTS+=("$f")
		done
	fi
}

build_win() {
	log "=== [2/Windows] Cross-compiling Mercury Windows x86_64 (x86-64-v3) ==="
	ensure_rust_target "x86_64-pc-windows-msvc"
	"${MERCURY_SRC_DIR}/setup.sh" --cross-avx2
	MERCURY_BOLT=0 "${MERCURY_SRC_DIR}/build.sh"

	if [ "${SKIP_PACKAGE}" -eq 0 ]; then
		MERCURY_BOLT=0 "${MERCURY_SRC_DIR}/package.sh"
		for f in \
			"${HG_SRC_DIR}"/obj-x86_64-pc-windows-msvc/dist/install/sea/mercury-*.installer.exe \
			"${HG_SRC_DIR}"/obj-x86_64-pc-windows-msvc/dist/mercury-*.win64.zip; do
			[ -f "$f" ] && BUILT_ARTIFACTS+=("$f")
		done
	fi
}

build_android() {
	log "=== [3/Android] Cross-compiling Mercury Android arm64-v8a ==="
	ensure_rust_target "aarch64-linux-android"
	"${MERCURY_SRC_DIR}/setup.sh" --android
	local android_bolt_env=0
	[ "${ANDROID_BOLT_ADB}" -eq 1 ] && [ "${FAST_BUILD}" -eq 0 ] && android_bolt_env=1

	MERCURY_BOLT="${android_bolt_env}" "${MERCURY_SRC_DIR}/build.sh"

	if [ "${android_bolt_env}" -eq 1 ]; then
		"${MERCURY_SRC_DIR}/scripts/bolt-optimize.sh" --android-adb --allow-fallback
	fi

	if [ "${SKIP_PACKAGE}" -eq 0 ]; then
		MERCURY_BOLT="${android_bolt_env}" "${MERCURY_SRC_DIR}/package.sh"
		for f in \
			"${HG_SRC_DIR}"/obj-aarch64-linux-android/gradle/build/mobile/android/fenix/app/outputs/apk/*/*.apk \
			"${HG_SRC_DIR}"/obj-aarch64-linux-android/dist/*.apk; do
			[ -f "$f" ] && BUILT_ARTIFACTS+=("$f")
		done
	fi
}

for t in "${TARGETS[@]}"; do
	case "${t}" in
		linux) build_linux ;;
		win) build_win ;;
		android) build_android ;;
	esac
done

log "=== Mercury Release Summary ==="
if [ ${#BUILT_ARTIFACTS[@]} -gt 0 ]; then
	for art in "${BUILT_ARTIFACTS[@]}"; do
		printf '  - %s (%s)\n' "${art}" "$(du -h "${art}" | awk '{print $1}')"
	done
else
	log "No packaged artifacts collected (check --skip-package or ${HG_SRC_DIR}/obj-*/dist/)."
fi
