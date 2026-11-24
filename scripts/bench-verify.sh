#!/bin/bash
set -euo pipefail

# Mercury Build Pipeline Verification & A/B Benchmark Harness
# Modes:
#   --static                 Validate scripts, llvm-bolt flags, mozconfigs, and patches
#   --inspect <binary/so>    Inspect ELF/PE binary for relocs, BOLT sections, AVX2/v3 codegen
#   --bench <bin>            Measure headless startup latency & local workload timing

MERCURY_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HG_SRC_DIR="${HG_SRC_DIR:-$HOME/mozilla-unified}"
DO_STATIC=0
INSPECT_BIN=""
BENCH_BIN=""
BASELINE_BIN=""
RUNS=5

usage() {
	cat <<'EOF'
Usage: scripts/bench-verify.sh [options]

Options:
  --static               Run static verification (bash -n, llvm-bolt flags, mozconfig matrix,
                         toolchain LLVM compatibility) [default if no other mode given]
  --inspect <path>       Inspect a built binary or libxul.so for .rela.text, BOLT sections,
                         debug stripping, and x86-64-v3/AVX2 instructions
  --bench <binary>       Benchmark headless startup latency and mercury-workload.html
  --baseline <binary>    Optional baseline binary for A/B comparison with --bench
  --runs <N>             Iterations for --bench (default: 5)
  -h, --help             Show this help
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--static) DO_STATIC=1; shift ;;
		--inspect) INSPECT_BIN="$2"; shift 2 ;;
		--bench) BENCH_BIN="$2"; shift 2 ;;
		--baseline) BASELINE_BIN="$2"; shift 2 ;;
		--runs) RUNS="$2"; shift 2 ;;
		-h|--help) usage; exit 0 ;;
		*) echo "ERROR: Unknown option: $1" >&2; usage >&2; exit 2 ;;
	esac
done

if [ "${DO_STATIC}" -eq 0 ] && [ -z "${INSPECT_BIN}" ] && [ -z "${BENCH_BIN}" ]; then
	DO_STATIC=1
fi

pass() { printf '[PASS] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; EXIT_CODE=1; }
info() { printf '[INFO] %s\n' "$*"; }
EXIT_CODE=0

run_static_checks() {
	info "=== 1. Shell script syntax checks (bash -n) ==="
	for s in \
		"${MERCURY_SRC_DIR}/setup.sh" \
		"${MERCURY_SRC_DIR}/build.sh" \
		"${MERCURY_SRC_DIR}/package.sh" \
		"${MERCURY_SRC_DIR}"/scripts/*.sh; do
		if bash -n "${s}"; then
			pass "bash -n ${s#${MERCURY_SRC_DIR}/}"
		else
			fail "bash -n ${s#${MERCURY_SRC_DIR}/}"
		fi
	done

	info "=== 2. llvm-bolt flag compatibility check ==="
	local bolt_bin
	bolt_bin="$(command -v llvm-bolt || true)"
	if [ -z "${bolt_bin}" ]; then
		fail "llvm-bolt not found on PATH"
	else
		local help_txt
		help_txt="$("${bolt_bin}" --help 2>&1)"
		for pat in \
			'--reorder-blocks=' \
			'=ext-tsp' \
			'--reorder-functions=' \
			'=cdsort' \
			'--split-functions' \
			'--split-all-cold' \
			'--icf=' \
			'--use-gnu-stack' \
			'--dyno-stats' \
			'--instrument' \
			'--instrumentation-file=' \
			'--instrumentation-file-append-pid' \
			'--hugify'; do
			if printf '%s\n' "${help_txt}" | grep -q -- "${pat}"; then
				pass "llvm-bolt supports ${pat}"
			else
				fail "llvm-bolt missing expected option/value: ${pat}"
			fi
		done
	fi

	info "=== 3. Mozconfig POSIX /bin/sh & env override matrix ==="
	local fake_prof
	fake_prof="$(mktemp /tmp/mercury-fake.XXXXXX.profdata)"
	trap 'rm -f "${fake_prof}"' RETURN

	for mc in \
		mozconfigs/mozconfig-avx2 \
		mozconfigs/mozconfig-win-avx2 \
		mozconfigs/mozconfig-win-avx2-cross \
		mozconfigs/mozconfig-android-arm64; do
		local full_mc="${MERCURY_SRC_DIR}/${mc}"
		if grep -qE '^\s*ac_add_options\s+--enable-clang-plugin' "${full_mc}"; then
			fail "${mc} still enables --enable-clang-plugin"
		else
			pass "${mc} has no --enable-clang-plugin"
		fi
		if sh -n "${full_mc}"; then
			pass "sh -n ${mc}"
		else
			fail "sh -n ${mc}"
		fi

		# Test fast mode, PGO profile-use mode, and BOLT mode
		local fast_out pgo_out
		fast_out="$(env -i PATH="$PATH" HOME="$HOME" MERCURY_FAST_BUILD=1 sh -e -c '
			ac_add_options() { printf "AC:%s\n" "$*"; }
			mk_add_options() { printf "MK:%s\n" "$*"; }
			. "$1"
			printf "RUSTFLAGS=%s\nLDFLAGS=%s\n" "${RUSTFLAGS:-}" "${LDFLAGS:-}"
		' _ "${full_mc}")" || { fail "${mc} failed under MERCURY_FAST_BUILD=1"; continue; }
		if printf '%s\n' "${fast_out}" | grep -qE 'AC:--enable-lto|AC:MOZ_PGO=1|AC:--enable-profile-'; then
			fail "${mc} leaked LTO or PGO under MERCURY_FAST_BUILD=1"
		else
			pass "${mc} MERCURY_FAST_BUILD=1 cleanly disables LTO & PGO"
		fi

		pgo_out="$(env -i PATH="$PATH" HOME="$HOME" MERCURY_PGO_PROFILE="${fake_prof}" MERCURY_BOLT=1 sh -e -c '
			ac_add_options() { printf "AC:%s\n" "$*"; }
			mk_add_options() { printf "MK:%s\n" "$*"; }
			. "$1"
			printf "RUSTFLAGS=%s\nLDFLAGS=%s\n" "${RUSTFLAGS:-}" "${LDFLAGS:-}"
		' _ "${full_mc}")" || { fail "${mc} failed under MERCURY_PGO_PROFILE"; continue; }
		if printf '%s\n' "${pgo_out}" | grep -q 'AC:--with-pgo-profile-path=' && \
		   ! printf '%s\n' "${pgo_out}" | grep -q 'AC:MOZ_PGO=1'; then
			pass "${mc} MERCURY_PGO_PROFILE emits single-pass --with-pgo-profile-path without MOZ_PGO=1 conflict"
		else
			fail "${mc} MERCURY_PGO_PROFILE output invalid:\n${pgo_out}"
		fi
	done

	info "=== 4. Toolchain LLVM major version compatibility ==="
	local mb_clang="${HOME}/.mozbuild/clang/bin/clang"
	local rust_llvm
	rust_llvm="$(rustc --version --verbose 2>/dev/null | sed -n 's/^LLVM version: //p' | head -n 1 || echo 'unknown')"
	info "rustc LLVM:           ${rust_llvm}"
	if [ -x "${mb_clang}" ]; then
		info "mozbuild clang:       $("${mb_clang}" --version | head -n 1)"
	fi
	if command -v clang >/dev/null 2>&1; then
		info "system clang:         $(clang --version | head -n 1)"
	fi
}

run_inspect() {
	local target="$1"
	[ -f "${target}" ] || { fail "Binary not found: ${target}"; return; }
	info "=== Binary Inspection: ${target} ==="
	info "Size: $(stat -c%s "${target}") bytes ($(du -h "${target}" | awk '{print $1}'))"

	local readelf_bin
	readelf_bin="$(command -v llvm-readelf || command -v readelf || true)"
	if [ -n "${readelf_bin}" ] && file "${target}" 2>/dev/null | grep -q ELF; then
		local secs
		secs="$("${readelf_bin}" -S "${target}" 2>/dev/null)"
		printf '%s\n' "${secs}" | grep -q '\.rela\.text' && pass "Has .rela.text (BOLT-relocatable)" || info "No .rela.text section"
		printf '%s\n' "${secs}" | grep -qE '\.text\.cold|\.bolt\.org\.text' && pass "BOLT layout sections present" || info "No BOLT sections detected"
		printf '%s\n' "${secs}" | grep -q '\.debug_info' && info "Contains .debug_info (unstripped)" || pass "Debug info stripped"
	fi

	if command -v objdump >/dev/null 2>&1 && file "${target}" 2>/dev/null | grep -qE 'x86-64|PE32\+'; then
		local avx_hits
		avx_hits="$(objdump -d "${target}" 2>/dev/null | head -n 200000 | grep -cE '\bv(fmadd|padd|pxor|movdqu|movaps)' || true)"
		info "Sampled AVX2/FMA instruction hits (first 200k lines): ${avx_hits}"
	fi
}

bench_one() {
	local bin="$1"
	local label="$2"
	[ -x "${bin}" ] || { fail "Benchmark binary not executable: ${bin}"; return; }
	python3 - "${bin}" "${label}" "${RUNS}" <<'PY'
import statistics, subprocess, sys, tempfile, time

binary, label, runs = sys.argv[1], sys.argv[2], int(sys.argv[3])
times_ms = []
with tempfile.TemporaryDirectory(prefix="mercury-bench-") as tmp:
    # Warm-up run
    subprocess.run(
        [binary, "--headless", "--no-remote", "-profile", tmp, "--screenshot", f"{tmp}/warm.png", "data:text/html,<h1>warm</h1>"],
        env={"MOZ_HEADLESS": "1", "PATH": "/usr/bin:/bin", "HOME": tmp},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45, check=True,
    )
    for i in range(runs):
        t0 = time.perf_counter()
        subprocess.run(
            [binary, "--headless", "--no-remote", "-profile", tmp, "--screenshot", f"{tmp}/r{i}.png", "data:text/html,<h1>bench</h1>"],
            env={"MOZ_HEADLESS": "1", "PATH": "/usr/bin:/bin", "HOME": tmp},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45, check=True,
        )
        times_ms.append((time.perf_counter() - t0) * 1000.0)

times_ms.sort()
med = statistics.median(times_ms)
p95 = times_ms[min(len(times_ms) - 1, int(len(times_ms) * 0.95))]
print(f"[BENCH] {label}: runs={runs} median={med:.1f}ms p95={p95:.1f}ms min={times_ms[0]:.1f}ms max={times_ms[-1]:.1f}ms")
PY
}

[ "${DO_STATIC}" -eq 1 ] && run_static_checks
[ -n "${INSPECT_BIN}" ] && run_inspect "${INSPECT_BIN}"
if [ -n "${BENCH_BIN}" ]; then
	[ -n "${BASELINE_BIN}" ] && bench_one "${BASELINE_BIN}" "baseline"
	bench_one "${BENCH_BIN}" "candidate"
fi

exit "${EXIT_CODE}"
