#!/bin/bash
set -euo pipefail

# Mercury Profile-Once Cross-PGO Generator (Linux x86_64 -> shared merged.profdata)
# Produces a single LLVM IR profile usable by Linux x86_64, Windows x86_64 cross,
# and Android arm64-v8a builds via --enable-profile-use=cross + --with-pgo-profile-path.

MERCURY_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HG_SRC_DIR="${HG_SRC_DIR:-$HOME/mozilla-unified}"
OUTPUT_DIR="${MERCURY_SRC_DIR}/build-artifacts/pgo"
MOZCONFIG_SRC="${MERCURY_SRC_DIR}/mozconfigs/mozconfig-avx2"
INSTR_OBJDIR="${HG_SRC_DIR}/obj-mercury-pgo-instrumented"
EXTENDED_CORPUS=""
REUSE_INSTRUMENTED=0
SKIP_SETUP=0
DRY_RUN=0
JOBS=""

usage() {
	cat <<'EOF'
Usage: scripts/pgo-generate.sh [options]

Generates a unified LLVM IR PGO profile (merged.profdata + en-US.log + manifest.json)
using an instrumented native Linux x86_64 Mercury build and the enriched profileserver
workload (including Mercury Canvas2D/JS/Wasm/DOM stress tests).

Options:
  --output-dir <dir>        Destination for merged.profdata & manifest.json
                            (default: build-artifacts/pgo)
  --mozconfig <path>        Base Linux mozconfig to use
                            (default: mozconfigs/mozconfig-avx2)
  --objdir <dir>            Instrumented objdir path
                            (default: $HG_SRC_DIR/obj-mercury-pgo-instrumented)
  --extended-corpus <dir>   Optional JetStream3 extended corpus directory
  --reuse-instrumented      Skip compiling instrumented build; re-run profileserver only
  --skip-setup              Do not run setup.sh --avx2 before building
  --jobs <N>                Parallel build jobs (overrides MOZ_MAKE_FLAGS)
  --dry-run                 Validate toolchain, paths, and print plan without building
  -h, --help                Show this help

Environment variables:
  HG_SRC_DIR                Path to Firefox source checkout (default: $HOME/mozilla-unified)
  LLVM_PROFDATA             Explicit path to llvm-profdata (auto-prefers ~/.mozbuild/clang/bin)
  MERCURY_PGO_PORT          Primary PGO HTTP port (default: 8888)
  MERCURY_PGO_SP3_PORT      Speedometer 3 HTTP port (default: 8000)
  MERCURY_PGO_JS3_PORT      JetStream 3 HTTP port (default: 8001)
  MERCURY_PGO_AUTO_PORT     Set to 1 to automatically pick free ports if defaults are busy
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--output-dir) OUTPUT_DIR="$2"; shift 2 ;;
		--mozconfig) MOZCONFIG_SRC="$2"; shift 2 ;;
		--objdir) INSTR_OBJDIR="$2"; shift 2 ;;
		--extended-corpus) EXTENDED_CORPUS="$2"; shift 2 ;;
		--reuse-instrumented) REUSE_INSTRUMENTED=1; shift ;;
		--skip-setup) SKIP_SETUP=1; shift ;;
		--jobs) JOBS="$2"; shift 2 ;;
		--dry-run) DRY_RUN=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "ERROR: Unknown option: $1" >&2; usage >&2; exit 2 ;;
	esac
done

log() { printf '[pgo-generate] %s\n' "$*"; }
warn() { printf '[pgo-generate] WARNING: %s\n' "$*" >&2; }
die() { printf '[pgo-generate] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "${HG_SRC_DIR}/mach" ] || die "${HG_SRC_DIR} is not a Firefox source checkout (missing ./mach)."
[ -f "${MOZCONFIG_SRC}" ] || die "Mozconfig not found: ${MOZCONFIG_SRC}"
if [ -n "${EXTENDED_CORPUS}" ] && [ ! -d "${EXTENDED_CORPUS}" ]; then
	die "Extended corpus directory not found: ${EXTENDED_CORPUS}"
fi

# Resolve toolchain binaries: prefer Firefox's bootstrapped Clang/llvm-profdata
# so the profraw/profdata format version matches the compiler used in builds.
ACTIVE_CLANG="${CC:-}"
if [ -z "${ACTIVE_CLANG}" ]; then
	if [ -x "${HOME}/.mozbuild/clang/bin/clang" ]; then
		ACTIVE_CLANG="${HOME}/.mozbuild/clang/bin/clang"
	elif command -v clang >/dev/null 2>&1; then
		ACTIVE_CLANG="$(command -v clang)"
	else
		die "No clang binary found (checked \$HOME/.mozbuild/clang/bin/clang and PATH)."
	fi
fi

LLVM_PROFDATA_BIN="${LLVM_PROFDATA:-}"
if [ -z "${LLVM_PROFDATA_BIN}" ]; then
	if [ -x "${HOME}/.mozbuild/clang/bin/llvm-profdata" ]; then
		LLVM_PROFDATA_BIN="${HOME}/.mozbuild/clang/bin/llvm-profdata"
	elif command -v llvm-profdata >/dev/null 2>&1; then
		LLVM_PROFDATA_BIN="$(command -v llvm-profdata)"
	else
		die "llvm-profdata not found (checked \$HOME/.mozbuild/clang/bin/llvm-profdata and PATH)."
	fi
fi

CLANG_VER_STR="$("${ACTIVE_CLANG}" --version 2>/dev/null | head -n 1 || true)"
CLANG_LLVM_MAJOR="$(printf '%s\n' "${CLANG_VER_STR}" | sed -n 's/.*clang version \([0-9][0-9]*\).*/\1/p')"
RUSTC_VER_STR="$(rustc --version 2>/dev/null || echo 'unknown')"
RUSTC_LLVM_MAJOR="$(rustc --version --verbose 2>/dev/null | sed -n 's/^LLVM version: \([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
PROFDATA_VER_STR="$("${LLVM_PROFDATA_BIN}" --version 2>/dev/null | grep -m1 'LLVM version' | xargs || echo 'unknown')"

PGO_MODE="${MERCURY_PGO_MODE:-auto}"
if [ "${PGO_MODE}" = "auto" ]; then
	if [ -n "${CLANG_LLVM_MAJOR}" ] && [ -n "${RUSTC_LLVM_MAJOR}" ] && [ "${CLANG_LLVM_MAJOR}" = "${RUSTC_LLVM_MAJOR}" ]; then
		PGO_MODE="cross"
	else
		warn "Clang LLVM major (${CLANG_LLVM_MAJOR:-?}) != rustc LLVM major (${RUSTC_LLVM_MAJOR:-?}); falling back to C++-only PGO (MERCURY_PGO_MODE=cpp)."
		PGO_MODE="cpp"
	fi
fi

# Check or auto-select PGO HTTP ports
pick_free_port() {
	python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

port_in_use() {
	python3 - "$1" <<'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    s.bind(("127.0.0.1", port))
    sys.exit(1)
except OSError:
    sys.exit(0)
finally:
    s.close()
PY
}

PGO_PORT="${MERCURY_PGO_PORT:-8888}"
SP3_PORT="${MERCURY_PGO_SP3_PORT:-8000}"
JS3_PORT="${MERCURY_PGO_JS3_PORT:-8001}"

if [ "${MERCURY_PGO_AUTO_PORT:-0}" = "1" ]; then
	port_in_use "${PGO_PORT}" && PGO_PORT="$(pick_free_port)"
	port_in_use "${SP3_PORT}" && SP3_PORT="$(pick_free_port)"
	port_in_use "${JS3_PORT}" && JS3_PORT="$(pick_free_port)"
else
	for p_pair in "MERCURY_PGO_PORT:${PGO_PORT}" "MERCURY_PGO_SP3_PORT:${SP3_PORT}"; do
		p_name="${p_pair%%:*}"
		p_val="${p_pair##*:}"
		if port_in_use "${p_val}"; then
			warn "Port ${p_val} (${p_name}) appears to be in use. Set ${p_name} or MERCURY_PGO_AUTO_PORT=1."
		fi
	done
fi

mkdir -p "${OUTPUT_DIR}"
OUTPUT_DIR_ABS="$(cd "${OUTPUT_DIR}" && pwd)"
MERGED_OUT="${OUTPUT_DIR_ABS}/merged.profdata"
JARLOG_OUT="${OUTPUT_DIR_ABS}/en-US.log"
MANIFEST_OUT="${OUTPUT_DIR_ABS}/manifest.json"

log "Clang:         ${ACTIVE_CLANG} (${CLANG_VER_STR})"
log "rustc:         ${RUSTC_VER_STR} (LLVM major: ${RUSTC_LLVM_MAJOR:-?})"
log "llvm-profdata: ${LLVM_PROFDATA_BIN} (${PROFDATA_VER_STR})"
log "PGO mode:      ${PGO_MODE} (--enable-profile-generate$([ "${PGO_MODE}" = "cross" ] && echo '=cross' || true))"
log "Instr objdir:  ${INSTR_OBJDIR}"
log "Output dir:    ${OUTPUT_DIR_ABS}"
log "Ports:         main=${PGO_PORT}, sp3=${SP3_PORT}, js3=${JS3_PORT}"

if [ "${DRY_RUN}" -eq 1 ]; then
	log "Dry-run complete. No build or profiling executed."
	exit 0
fi

if [ "${SKIP_SETUP}" -eq 0 ]; then
	log "Syncing Mercury patches and assets via setup.sh --avx2..."
	HG_SRC_DIR="${HG_SRC_DIR}" "${MERCURY_SRC_DIR}/setup.sh" --avx2
fi

# Generate temporary instrumented mozconfig wrapping the base mozconfig
TMP_MOZCONFIG="$(mktemp "${TMPDIR:-/tmp}/mercury-pgo-gen.XXXXXX.mozconfig")"
cleanup() { rm -f "${TMP_MOZCONFIG}"; }
trap cleanup EXIT

{
	cat "${MOZCONFIG_SRC}"
	printf '\n# Added by scripts/pgo-generate.sh\n'
	printf 'mk_add_options MOZ_OBJDIR="%s"\n' "${INSTR_OBJDIR}"
	if [ -n "${JOBS}" ]; then
		printf 'mk_add_options MOZ_MAKE_FLAGS="-j%s"\n' "${JOBS}"
	fi
} > "${TMP_MOZCONFIG}"

export HG_SRC_DIR
export MOZCONFIG="${TMP_MOZCONFIG}"
export MERCURY_PGO_GENERATE=1
export MERCURY_PGO_MODE="${PGO_MODE}"
export MERCURY_FAST_BUILD=0
export MERCURY_BOLT=0
unset MERCURY_PGO_PROFILE || true
unset MERCURY_PGO_JARLOG || true
export MERCURY_PGO_PORT="${PGO_PORT}"
export MERCURY_PGO_SP3_PORT="${SP3_PORT}"
export MERCURY_PGO_JS3_PORT="${JS3_PORT}"

cd "${HG_SRC_DIR}"

if [ "${REUSE_INSTRUMENTED}" -eq 0 ]; then
	log "Building instrumented Linux x86_64 binary..."
	./mach build -v
	log "Packaging instrumented binary (required for staged-package & jarlog)..."
	./mach package -v
else
	log "Reusing existing instrumented build in ${INSTR_OBJDIR}"
	[ -d "${INSTR_OBJDIR}" ] || die "Instrumented objdir does not exist: ${INSTR_OBJDIR}"
fi

# Run profileserver inside the instrumented objdir so *.profraw land cleanly
log "Running enriched PGO training workload via build/pgo/profileserver.py..."
mkdir -p "${INSTR_OBJDIR}/jarlog"
PROFILE_ARGS=("${HG_SRC_DIR}/build/pgo/profileserver.py")
if [ -n "${EXTENDED_CORPUS}" ]; then
	PROFILE_ARGS+=("--extended-corpus" "${EXTENDED_CORPUS}")
fi

(
	cd "${INSTR_OBJDIR}"
	rm -f ./*.profraw ./merged.profdata
	LLVM_PROFDATA="${LLVM_PROFDATA_BIN}" \
	JARLOG_FILE="${INSTR_OBJDIR}/jarlog/en-US.log" \
	"${HG_SRC_DIR}/mach" python "${PROFILE_ARGS[@]}"
)

# Merge or verify merged.profdata
if [ -s "${INSTR_OBJDIR}/merged.profdata" ]; then
	cp -f "${INSTR_OBJDIR}/merged.profdata" "${MERGED_OUT}"
else
	shopt -s nullglob
	PROFRAW_FILES=("${INSTR_OBJDIR}"/*.profraw)
	shopt -u nullglob
	[ ${#PROFRAW_FILES[@]} -gt 0 ] || die "No *.profraw files or merged.profdata produced in ${INSTR_OBJDIR}."
	log "Merging ${#PROFRAW_FILES[@]} profraw file(s) with ${LLVM_PROFDATA_BIN}..."
	"${LLVM_PROFDATA_BIN}" merge -o "${MERGED_OUT}" "${PROFRAW_FILES[@]}"
fi

[ -s "${MERGED_OUT}" ] || die "Merged profdata is missing or empty: ${MERGED_OUT}"

if [ -s "${INSTR_OBJDIR}/jarlog/en-US.log" ]; then
	cp -f "${INSTR_OBJDIR}/jarlog/en-US.log" "${JARLOG_OUT}"
	log "Saved jarlog: ${JARLOG_OUT}"
else
	warn "No jarlog produced at ${INSTR_OBJDIR}/jarlog/en-US.log (continuing without jarlog)."
fi

# Inspect merged profile & emit manifest.json
PROF_SUMMARY="$("${LLVM_PROFDATA_BIN}" show --topn=10 "${MERGED_OUT}" 2>&1)" || \
	die "llvm-profdata show failed to validate ${MERGED_OUT}"

PROF_SHA256="$(sha256sum "${MERGED_OUT}" | awk '{print $1}')"
PROF_SIZE="$(stat -c%s "${MERGED_OUT}")"
FIREFOX_HEAD="$(git -C "${HG_SRC_DIR}" rev-parse HEAD 2>/dev/null || echo 'unknown')"
MERCURY_HEAD="$(git -C "${MERCURY_SRC_DIR}" rev-parse HEAD 2>/dev/null || echo 'unknown')"

python3 - "${MANIFEST_OUT}" <<PY
import datetime, json, os, platform, re, sys

manifest_path = sys.argv[1]
summary = """${PROF_SUMMARY}"""

def extract_int(pattern):
    m = re.search(pattern, summary)
    return int(m.group(1)) if m else None

manifest = {
    "schema_version": 1,
    "generated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "host_arch": platform.machine(),
    "mercury_commit": "${MERCURY_HEAD}",
    "firefox_commit": "${FIREFOX_HEAD}",
    "pgo_mode": "${PGO_MODE}",
    "clang_path": "${ACTIVE_CLANG}",
    "clang_version": "${CLANG_VER_STR}",
    "clang_llvm_major": "${CLANG_LLVM_MAJOR}",
    "rustc_version": "${RUSTC_VER_STR}",
    "rustc_llvm_major": "${RUSTC_LLVM_MAJOR}",
    "llvm_profdata_path": "${LLVM_PROFDATA_BIN}",
    "llvm_profdata_version": "${PROFDATA_VER_STR}",
    "extended_corpus": bool("${EXTENDED_CORPUS}"),
    "profdata_path": "${MERGED_OUT}",
    "profdata_sha256": "${PROF_SHA256}",
    "profdata_size_bytes": int("${PROF_SIZE}"),
    "jarlog_path": "${JARLOG_OUT}" if os.path.isfile("${JARLOG_OUT}") else None,
    "stats": {
        "total_functions": extract_int(r"Total functions:\s*(\d+)"),
        "total_blocks": extract_int(r"Total number of blocks:\s*(\d+)"),
        "max_function_count": extract_int(r"Maximum function count:\s*(\d+)"),
        "max_internal_block_count": extract_int(r"Maximum internal block count:\s*(\d+)"),
        "total_count": extract_int(r"Total count:\s*(\d+)"),
    },
}
with open(manifest_path, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")
PY

log "Profile generation complete!"
log "  merged.profdata: ${MERGED_OUT} (${PROF_SIZE} bytes, sha256=${PROF_SHA256:0:16}...)"
[ -f "${JARLOG_OUT}" ] && log "  jarlog:          ${JARLOG_OUT}"
log "  manifest:        ${MANIFEST_OUT}"
log "Next: export MERCURY_PGO_PROFILE=\"${MERGED_OUT}\" or run scripts/build-release.sh --pgo-profile \"${MERGED_OUT}\""
