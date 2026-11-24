#!/bin/bash

# Copyright (c) 2024 Alex313031.

YEL='\033[1;33m' # Yellow
CYA='\033[1;96m' # Cyan
RED='\033[1;31m' # Red
GRE='\033[1;32m' # Green
c0='\033[0m' # Reset Text
bold='\033[1m' # Bold Text
underline='\033[4m' # Underline Text

# Error handling
yell() { echo "$0: $*" >&2; }
die() { yell "$*"; exit 111; }
try() { "$@" || die "${RED}Failed $*"; }

# --help
displayHelp () {
	printf "\n" &&
	printf "${bold}${GRE}Script to build Mercury Browser.${c0}\n" &&
	printf "${underline}${YEL}Usage:${c0} build.sh [--fast]\n" &&
	printf "  ${YEL}--fast${c0}    Set MERCURY_FAST_BUILD=1 (disables PGO, LTO, BOLT, and geckodriver; -O2; Rust cgu=16)\n" &&
	printf "\n" &&
	printf "Environment variables:\n" &&
	printf "  ${CYA}MOZ_MAKE_FLAGS=\"-j#\"${c0}          Parallel job count\n" &&
	printf "  ${CYA}MERCURY_FAST_BUILD=1${c0}          Fast developer iteration mode\n" &&
	printf "  ${CYA}MERCURY_PGO_PROFILE=/abs/path${c0} Reuse shared merged.profdata (Cross-PGO)\n" &&
	printf "  ${CYA}MERCURY_LTO_MODE=full|cross,full|thin|off${c0}\n" &&
	printf "  ${CYA}MERCURY_BOLT=1${c0}                Emit ELF relocations (-Wl,--emit-relocs) for scripts/bolt-optimize.sh\n" &&
	printf "\n" &&
	printf "For multi-platform Profile-Once Cross-PGO + Full-LTO + BOLT releases, see ${CYA}scripts/build-release.sh --help${c0}.\n" &&
	printf "\n"
}
for arg in "$@"; do
	case "$arg" in
		--help|-h) displayHelp; exit 0;;
		--fast) export MERCURY_FAST_BUILD=1;;
		*) die "${RED}Unknown option: ${arg} (use --help)${c0}";;
	esac
done

# mozilla source dir env variable
if [ -z "${HG_SRC_DIR}" ]; then 
    HG_SRC_DIR="$HOME/mozilla-unified"
    export HG_SRC_DIR
else 
    HG_SRC_DIR="${HG_SRC_DIR}"
    export HG_SRC_DIR
fi

printf "\n" &&
printf "${GRE}Building Mercury...\n" &&
printf "${CYA}\n" &&

cd "${HG_SRC_DIR}" || die "Failed to cd to ${HG_SRC_DIR}"

./mach build -v
build_status=$?
tput sgr0 2>/dev/null || true
if [ $build_status -ne 0 ]; then
	die "${RED}Build failed with exit code ${build_status}${c0}"
fi

printf "\n"
printf "${GRE}${bold}Build Completed!\n"
printf "${GRE}${bold}You can now run \`./package.sh\` to generate installation packages.\n"
tput sgr0 2>/dev/null || true
